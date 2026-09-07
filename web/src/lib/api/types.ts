import type { components, paths } from "./schema";

type Schemas = components["schemas"];

export type BudgetPlan = Schemas["BudgetPlan"];
export type CircuitFormat = Schemas["CircuitFormat"];
export type OptimizationBackend = Schemas["OptimizationBackend"];
export type RedundancyModeName = Schemas["RedundancyModeName"];
export type SelectionMetric = Schemas["SelectionMetric"];
export type ResultFormat = Schemas["ResultFormat"];

/** openapi-typescript marks fields with server defaults as required; make them optional on the request side. */
type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type QuoteDefaults = "target_backend" | "optimization_level" | "shots" | "budget_mode" | "optimization_backend";

export type QuoteRequest = WithOptional<Schemas["QuoteRequest"], QuoteDefaults>;
export type OptimizeRequest = WithOptional<
  Schemas["OptimizeRequest"],
  QuoteDefaults | "include_simulation" | "noisy_simulation" | "execute_on_qpu"
>;
export type InterpretRequest = WithOptional<Schemas["InterpretRequest"], "budget_mode">;
export type OptimizeResponse = Schemas["OptimizeResponse"];
export type QuoteResponse = Schemas["QuoteResponse"];
export type InterpretResponse = Schemas["InterpretResponse"];
export type Interpretation = Schemas["Interpretation"];
export type Billing = Schemas["Billing"];
export type BackendResult = Schemas["BackendResult"];
export type BackendEstimate = Schemas["BackendEstimate"];
export type SelectedResult = Schemas["SelectedResult"];
export type SimulationResult = Schemas["SimulationResult"];
export type TranspiledCircuit = Schemas["TranspiledCircuit"];
export type JobList = Schemas["JobList"];
export type JobSummary = Schemas["JobSummary"];
export type JobDetail = Schemas["JobDetail"];
export type ErrorResponse = Schemas["ErrorResponse"];
export type RedundancyMode = Schemas["RedundancyMode"];
export type Constraints = Schemas["Constraints"];

export type JobsQuery = NonNullable<paths["/v2/jobs"]["get"]["parameters"]["query"]>;
