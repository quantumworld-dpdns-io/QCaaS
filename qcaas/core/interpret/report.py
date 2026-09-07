"""Turn analyses into the business-facing Interpretation block."""

from __future__ import annotations

from ...schemas.optimize import CircuitMetrics, Interpretation, InterpretContext
from .rules import CountsAnalysis, NoiseAnalysis

ALGO_NEXT_STEPS = {
    "qaoa": [
        "Sweep p (layers) 1→3 and compare the low-energy probability mass per QPU second.",
        "Warm-start parameters from a classical relaxation to cut optimizer iterations.",
    ],
    "vqe": [
        "Compare the estimated energy against the classical reference (e.g. Hartree-Fock).",
        "Group commuting Pauli terms to reduce the number of circuit executions.",
    ],
    "grover": ["Check the marked-state probability against the theoretical (2k+1)θ bound."],
}
GENERIC_NEXT_STEPS = [
    "Validate on the noisy Aer simulation before spending QPU minutes.",
    "Increase shots (e.g. 4096) once the circuit is final to tighten confidence intervals.",
]


def _confidence(ca: CountsAnalysis | None, na: NoiseAnalysis | None) -> str:
    score = 0
    if ca:
        if ca.shots >= 4000:
            score += 1
        if ca.top_probability >= 0.5 or (ca.success_probability or 0) >= 0.6:
            score += 1
    if na and not na.concerns:
        score += 1
    return ["low", "medium", "high", "high"][score]


def build_interpretation(
    ca: CountsAnalysis | None,
    na: NoiseAnalysis | None,
    metrics: CircuitMetrics | None = None,
    context: InterpretContext | None = None,
    backend_name: str | None = None,
) -> Interpretation:
    recs: list[str] = []
    concerns = na.messages if na else []
    algo = (context.algorithm or "").lower() if context and context.algorithm else ""

    # --- summary ---
    if ca is None:
        summary = "Circuit optimised; no measurement data available for interpretation."
    elif ca.success_probability is not None:
        summary = (
            f"{ca.success_probability:.0%} of {ca.shots} shots landed on the target outcome(s); "
            f"the most frequent bitstring was {ca.top_bitstring} ({ca.top_probability:.0%})."
        )
    else:
        summary = (
            f"Most frequent outcome {ca.top_bitstring} at {ca.top_probability:.0%} of {ca.shots} shots; "
            f"distribution is {ca.concentration}."
        )

    # --- recommendations from noise ---
    if na:
        if any(c.kind == "readout_error" for c in na.concerns):
            recs.append(
                "Enable measurement error mitigation (twirled readout / TREX) for this qubit set."
            )
        if any(c.kind == "two_qubit_gate_error" for c in na.concerns):
            recs.append(
                "Try an alternative qubit mapping or a backend with lower two-qubit error on the used edges."
            )
        if any(c.kind == "coherence" for c in na.concerns):
            recs.append(
                "Reduce depth (higher optimization_level or approximate synthesis); dynamical decoupling may help."
            )
    if ca and ca.concentration == "flat" and ca.success_probability is None:
        recs.append(
            "Result distribution is near-uniform: the circuit may be too deep for this device or parameters are untrained."
        )
    if metrics and metrics.constraint_violations:
        recs.append(
            "Requested constraints were not met: " + "; ".join(metrics.constraint_violations)
        )
    if not recs:
        recs.append(
            "No mitigation required at this shot count; proceed to hardware execution when budget allows."
        )

    # --- business interpretation ---
    if ca is None:
        biz = "The circuit is ready for execution; costs below are estimates until measurement data is available."
    else:
        quality = {
            "peaked": "a clear, actionable answer",
            "moderate": "a usable but noisy answer that should be confirmed with more shots",
            "flat": "no reliable signal yet",
        }[ca.concentration]
        biz = f"For the stated problem this run gives {quality}."
        if ca.success_probability is not None:
            if ca.success_probability >= 0.6:
                biz += " Success probability is high enough to act on the result."
            elif ca.success_probability >= 0.3:
                biz += " Success probability is marginal; treat the result as a candidate, not a decision."
            else:
                biz += " Success probability is too low to rely on; do not act on this result yet."
        if context and context.problem_description:
            biz += f" Context: {context.problem_description}."
        if concerns:
            biz += f" Main risk: {concerns[0]}."

    next_steps = list(ALGO_NEXT_STEPS.get(algo, [])) + GENERIC_NEXT_STEPS
    if backend_name:
        next_steps.append(
            f"Re-run on {backend_name} after mitigation and compare estimated vs actual QPU seconds."
        )

    key_metrics = ca.as_metrics() if ca else {}
    if metrics:
        key_metrics.update(
            {
                "depth": metrics.depth,
                "gate_count": metrics.gate_count,
                "two_qubit_gates": metrics.two_qubit_gate_count,
            }
        )
    if na:
        key_metrics.update(
            {
                "worst_readout_error": na.worst_readout_error,
                "worst_two_qubit_error": na.worst_two_qubit_error,
                "min_t1_sec": na.min_t1_sec,
                "min_t2_sec": na.min_t2_sec,
            }
        )

    return Interpretation(
        summary=summary,
        success_probability=ca.success_probability if ca else None,
        key_metrics={k: v for k, v in key_metrics.items() if v is not None},
        noise_concerns=concerns,
        noise_analysis=na.concerns if na else [],
        business_interpretation=biz,
        recommendations=recs,
        next_steps=next_steps,
        confidence=_confidence(ca, na),
    )
