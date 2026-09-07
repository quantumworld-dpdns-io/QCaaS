"""Rule-based analysis of measurement results and backend noise."""

from __future__ import annotations

import csv
import io
import json
import math
from dataclasses import dataclass, field
from typing import Any

from ...schemas.common import ResultFormat
from ...schemas.optimize import NoiseConcern
from ..errors import InvalidCircuit

READOUT_ERROR_WARN = 0.02
TWO_QUBIT_ERROR_WARN = 0.01
COHERENCE_FRACTION_WARN = 0.2  # circuit duration / min(T1,T2) above this is a concern


@dataclass
class CountsAnalysis:
    shots: int
    num_outcomes: int
    top_bitstring: str
    top_probability: float
    top3_mass: float
    entropy_bits: float
    max_entropy_bits: float
    success_probability: float | None
    target_bitstrings: list[str] | None
    concentration: str  # peaked | moderate | flat

    def as_metrics(self) -> dict[str, Any]:
        return {
            "shots": self.shots,
            "distinct_outcomes": self.num_outcomes,
            "best_bitstring": self.top_bitstring,
            "best_probability": round(self.top_probability, 4),
            "top3_probability_mass": round(self.top3_mass, 4),
            "entropy_bits": round(self.entropy_bits, 3),
            "max_entropy_bits": round(self.max_entropy_bits, 3),
            "success_probability": None if self.success_probability is None else round(self.success_probability, 4),
            "target_bitstrings": self.target_bitstrings,
            "distribution": self.concentration,
        }


def parse_counts(fmt: ResultFormat, payload: dict[str, Any] | str) -> dict[str, int]:
    if fmt == ResultFormat.counts_dict:
        obj = json.loads(payload) if isinstance(payload, str) else payload
        if not isinstance(obj, dict):
            raise InvalidCircuit("counts_dict payload must be an object of bitstring -> count")
        return _clean_counts(obj)
    if fmt == ResultFormat.csv:
        text = payload if isinstance(payload, str) else json.dumps(payload)
        counts: dict[str, int] = {}
        for row in csv.reader(io.StringIO(text)):
            if len(row) < 2 or row[0].strip().lower() in {"bitstring", "outcome", "state"}:
                continue
            counts[row[0].strip()] = counts.get(row[0].strip(), 0) + int(float(row[1]))
        if not counts:
            raise InvalidCircuit("csv payload contained no 'bitstring,count' rows")
        return _clean_counts(counts)
    if fmt == ResultFormat.ibm_job_result_json:
        obj = json.loads(payload) if isinstance(payload, str) else payload
        found = _find_counts(obj)
        if not found:
            raise InvalidCircuit("could not locate counts in IBM job result JSON")
        return _clean_counts(found)
    raise InvalidCircuit(f"unsupported result_format {fmt}")


def _clean_counts(obj: dict) -> dict[str, int]:
    out: dict[str, int] = {}
    for k, v in obj.items():
        key = str(k).replace(" ", "")
        if key.startswith("0x"):
            key = bin(int(key, 16))[2:]
        try:
            n = int(round(float(v)))
        except (TypeError, ValueError) as exc:
            raise InvalidCircuit(f"count for '{k}' is not numeric") from exc
        if n < 0:
            raise InvalidCircuit(f"count for '{k}' is negative")
        out[key] = out.get(key, 0) + n
    if not out or sum(out.values()) == 0:
        raise InvalidCircuit("counts are empty")
    return out


def _find_counts(obj: Any) -> dict | None:
    """Best-effort search for a counts-like dict inside an IBM job result structure."""
    if isinstance(obj, dict):
        if obj and all(isinstance(k, str) and set(k) <= set("01x0123456789abcdef") for k in obj) and all(
            isinstance(v, (int, float)) for v in obj.values()
        ):
            return obj
        for key in ("counts", "meas", "c", "data", "results", "samples"):
            if key in obj:
                r = _find_counts(obj[key])
                if r:
                    return r
        for v in obj.values():
            r = _find_counts(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find_counts(v)
            if r:
                return r
    return None


def analyze_counts(counts: dict[str, int], target_bitstrings: list[str] | None = None) -> CountsAnalysis:
    shots = sum(counts.values())
    probs = {k: v / shots for k, v in counts.items()}
    ranked = sorted(probs.items(), key=lambda kv: -kv[1])
    top, top_p = ranked[0]
    top3 = sum(p for _, p in ranked[:3])
    entropy = -sum(p * math.log2(p) for p in probs.values() if p > 0)
    nbits = len(top)
    max_entropy = float(nbits)
    success = None
    targets = None
    if target_bitstrings:
        targets = [t.replace(" ", "") for t in target_bitstrings]
        success = sum(probs.get(t, 0.0) for t in targets)
    if top_p >= 0.5 or (max_entropy > 0 and entropy / max_entropy < 0.4):
        conc = "peaked"
    elif max_entropy > 0 and entropy / max_entropy > 0.85:
        conc = "flat"
    else:
        conc = "moderate"
    return CountsAnalysis(
        shots=shots,
        num_outcomes=len(counts),
        top_bitstring=top,
        top_probability=top_p,
        top3_mass=top3,
        entropy_bits=entropy,
        max_entropy_bits=max_entropy,
        success_probability=success,
        target_bitstrings=targets,
        concentration=conc,
    )


@dataclass
class NoiseAnalysis:
    concerns: list[NoiseConcern] = field(default_factory=list)
    worst_readout_error: float | None = None
    worst_two_qubit_error: float | None = None
    min_t1_sec: float | None = None
    min_t2_sec: float | None = None
    duration_over_coherence: float | None = None

    @property
    def messages(self) -> list[str]:
        return [c.message for c in self.concerns]


def analyze_backend_noise(backend, physical_qubits: list[int], circuit=None, circuit_duration_sec: float | None = None) -> NoiseAnalysis:
    """Read error rates for the qubits/edges actually used from the backend Target."""
    na = NoiseAnalysis()
    if backend is None or not physical_qubits:
        return na
    target = getattr(backend, "target", None)
    if target is None:
        return na

    # Readout errors
    if "measure" in target:
        for q in physical_qubits:
            props = target["measure"].get((q,))
            err = getattr(props, "error", None) if props else None
            if err is None:
                continue
            na.worst_readout_error = max(na.worst_readout_error or 0.0, err)
            if err > READOUT_ERROR_WARN:
                na.concerns.append(
                    NoiseConcern(kind="readout_error", location=f"qubit {q}", value=round(err, 4),
                                 message=f"readout error {err:.1%} on qubit {q}")
                )

    # Two-qubit gate errors on used edges
    edges: set[tuple[int, ...]] = set()
    if circuit is not None:
        for inst in circuit.data:
            if len(inst.qubits) == 2 and inst.operation.name not in {"barrier"}:
                edges.add(tuple(circuit.find_bit(q).index for q in inst.qubits))
    for name in ("ecr", "cz", "cx"):
        if name not in target:
            continue
        for edge in edges:
            props = target[name].get(edge)
            err = getattr(props, "error", None) if props else None
            if err is None:
                continue
            na.worst_two_qubit_error = max(na.worst_two_qubit_error or 0.0, err)
            if err > TWO_QUBIT_ERROR_WARN:
                na.concerns.append(
                    NoiseConcern(kind="two_qubit_gate_error", location=f"edge {edge}", value=round(err, 4),
                                 message=f"{name.upper()} error rate {err:.2%} on edge {edge}")
                )

    # Coherence vs duration
    t1s, t2s = [], []
    for q in physical_qubits:
        try:
            qp = backend.qubit_properties(q)
        except Exception:  # noqa: BLE001
            qp = None
        if qp is None:
            continue
        if getattr(qp, "t1", None):
            t1s.append(qp.t1)
        if getattr(qp, "t2", None):
            t2s.append(qp.t2)
    if t1s:
        na.min_t1_sec = min(t1s)
    if t2s:
        na.min_t2_sec = min(t2s)
    coh = min([x for x in (na.min_t1_sec, na.min_t2_sec) if x], default=None)
    if coh and circuit_duration_sec:
        na.duration_over_coherence = circuit_duration_sec / coh
        if na.duration_over_coherence > COHERENCE_FRACTION_WARN:
            na.concerns.append(
                NoiseConcern(kind="coherence", location="circuit", value=round(na.duration_over_coherence, 3),
                             message=f"circuit duration is {na.duration_over_coherence:.0%} of the shortest coherence time")
            )
    return na
