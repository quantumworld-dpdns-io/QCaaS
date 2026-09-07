# Engineer Deep-Interpretation Report (paid add-on template)

> Billing: `engineer_review_per_min` (pricing.yaml, default USD 0.50/min) × minutes logged, or a
> fixed per-report price agreed in the order. Delivered as Markdown + the reproducible notebook.

| Field | Value |
|---|---|
| Customer | |
| Job ID(s) | `job_id` from `/v2/optimize` or `/v2/interpret` |
| Target backend | e.g. `ibm_sherbrooke` |
| Algorithm / use case | QAOA portfolio optimisation, VQE H2, … |
| Engineer | |
| Review minutes | |
| Report date | |

## 1. Executive summary (2–3 sentences, business language)
What question was asked, what the quantum run says, and whether the customer can act on it.

## 2. What was run
- Input circuit: format, width, depth, gate count **before** optimisation.
- Optimisation path: `selected_result.backend`, `selected_result.reason`, both backends' metrics
  (`results.ibm_composer`, `results.classiq`).
- Shots, plan, estimated vs actual QPU seconds and cost (`billing`).

## 3. Result quality
- Success probability / best bitstring / top-3 probability mass (`interpretation.key_metrics`).
- Distribution shape (peaked / moderate / flat) and what it means for confidence.
- Comparison with the noiseless Aer simulation (if available).

## 4. Noise analysis
| Source | Observed | Threshold | Impact |
|---|---|---|---|
| Readout error (qubits …) | | 2 % | |
| Two-qubit gate error (edges …) | | 1 % | |
| Circuit duration vs T1/T2 | | 20 % | |

Engineer commentary: which effect dominates and why.

## 5. Recommendations (ranked)
1. Mitigation (measurement error mitigation, dynamical decoupling, twirling).
2. Circuit-level (alternative mapping, lower `optimization_level` trade-offs, approximate synthesis
   via Classiq constraints).
3. Backend-level (Heron-class backend with lower CX error, different region/plan).

## 6. Cost view
| Option | Est. QPU s | Est. cost (plan) | Expected quality gain |
|---|---|---|---|
| As run | | | – |
| Recommended | | | |

## 7. Next steps & reproducibility
- Concrete next experiment (shots, parameters, backend) and its quote (`/v2/quote` id).
- Attached: notebook / request JSON to reproduce every number in this report.
