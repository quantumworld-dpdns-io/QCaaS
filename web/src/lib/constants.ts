import type {
  CircuitFormat,
  OptimizationBackend,
  RedundancyModeName,
  ResultFormat,
  SelectionMetric,
} from "@/lib/api/types";

export const TARGET_BACKENDS = [
  "ibm_sherbrooke",
  "ibm_brisbane",
  "ibm_torino",
  "ibm_fez",
  "ibm_kyiv",
  "ibm_marrakesh",
] as const;

/** Formats the server accepts (qiskit_python is rejected server-side). */
export type AcceptedCircuitFormat = Exclude<CircuitFormat, "qiskit_python">;
export const CIRCUIT_FORMATS: readonly AcceptedCircuitFormat[] = ["openqasm2", "openqasm3", "json", "qmod"];

export const OPTIMIZATION_BACKENDS: readonly OptimizationBackend[] = ["auto", "ibm_composer", "classiq"];
export const PRIMARY_BACKENDS: readonly Exclude<OptimizationBackend, "auto">[] = ["ibm_composer", "classiq"];
export const REDUNDANCY_MODES: readonly RedundancyModeName[] = ["fallback", "parallel", "single"];
export const SELECTION_METRICS: readonly SelectionMetric[] = ["qpu_cost", "depth", "gate_count"];
export const RESULT_FORMATS: readonly ResultFormat[] = ["counts_dict", "csv", "ibm_job_result_json"];

export const EXAMPLE_BELL_QASM2 =
  'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;';

export const EXAMPLE_COUNTS_JSON = '{"00": 480, "11": 496, "01": 24, "10": 24}';
