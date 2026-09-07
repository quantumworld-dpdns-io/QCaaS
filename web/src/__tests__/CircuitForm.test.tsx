import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CircuitForm, DEFAULT_FORM_VALUES, buildQuoteRequest, detectCircuitFormatMismatch, type CircuitFormValues } from "@/components/CircuitForm";
import { I18nProvider } from "@/i18n/context";
import { EXAMPLE_BELL_QASM2 } from "@/lib/constants";

function Harness({ onSubmit }: { onSubmit: (v: CircuitFormValues) => void }) {
  const [values, setValues] = useState<CircuitFormValues>({ ...DEFAULT_FORM_VALUES, circuitFormat: "qmod" });
  return (
    <I18nProvider initialLocale="en">
      <CircuitForm mode="quote" values={values} onChange={setValues} onSubmit={() => onSubmit(values)} />
    </I18nProvider>
  );
}

describe("CircuitForm", () => {
  it("fills the Bell-state example and switches format to openqasm2", async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={() => undefined} />);

    const textarea = screen.getByLabelText("Circuit source") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");

    await user.click(screen.getByRole("button", { name: "Load example" }));

    expect(textarea.value).toBe(EXAMPLE_BELL_QASM2);
    expect(textarea.value).toContain('include "qelib1.inc";');
    expect((screen.getByLabelText("Circuit format") as HTMLSelectElement).value).toBe("openqasm2");
  });

  it("builds a QuoteRequest from the example values", () => {
    const req = buildQuoteRequest({ ...DEFAULT_FORM_VALUES, circuitSource: EXAMPLE_BELL_QASM2 });
    expect(req.circuit_format).toBe("openqasm2");
    expect(req.circuit_payload).toBe(EXAMPLE_BELL_QASM2);
    expect(req.target_backend).toBe("ibm_sherbrooke");
    expect(req.shots).toBe(1024);
    expect(req.redundancy_mode).toEqual({ mode: "fallback", primary: "ibm_composer", selection_metric: "qpu_cost" });
    expect(req).not.toHaveProperty("constraints");
  });

  it("rejects an empty circuit and invalid JSON payloads", () => {
    expect(() => buildQuoteRequest(DEFAULT_FORM_VALUES)).toThrow("form.errCircuitRequired");
    expect(() => buildQuoteRequest({ ...DEFAULT_FORM_VALUES, circuitFormat: "json", circuitSource: "[1,2]" })).toThrow("form.errInvalidJson");
    const ok = buildQuoteRequest({ ...DEFAULT_FORM_VALUES, circuitFormat: "json", circuitSource: '{"gates": []}' });
    expect(ok.circuit_payload).toEqual({ gates: [] });
  });

  it("detects a circuit-format / payload mismatch", () => {
    const qasm2 = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\n';
    const qasm3 = 'OPENQASM 3;\ninclude "stdgates.inc";\nqubit[2] q;\nh q[0];\n';
    // Consistent selections → no warning.
    expect(detectCircuitFormatMismatch("openqasm2", qasm2)).toBeNull();
    expect(detectCircuitFormatMismatch("openqasm3", qasm3)).toBeNull();
    // The exact case from the report: v2 source selected as OpenQASM 3.
    expect(detectCircuitFormatMismatch("openqasm3", qasm2)).toBe("openqasm2");
    expect(detectCircuitFormatMismatch("openqasm2", qasm3)).toBe("openqasm3");
    // qelib1.inc without a version header still flags a v3 selection.
    expect(detectCircuitFormatMismatch("openqasm3", 'include "qelib1.inc";\nqreg q[1];')).toBe("openqasm2");
    // Non-QASM formats and empty input are never flagged.
    expect(detectCircuitFormatMismatch("json", qasm2)).toBeNull();
    expect(detectCircuitFormatMismatch("openqasm3", "")).toBeNull();
  });

  it("shows the mismatch warning and switches format on click", async () => {
    const user = userEvent.setup();
    function MismatchHarness() {
      const [values, setValues] = useState<CircuitFormValues>({
        ...DEFAULT_FORM_VALUES,
        circuitFormat: "openqasm3",
        circuitSource: EXAMPLE_BELL_QASM2,
      });
      return (
        <I18nProvider initialLocale="en">
          <CircuitForm mode="quote" values={values} onChange={setValues} onSubmit={() => undefined} />
        </I18nProvider>
      );
    }
    render(<MismatchHarness />);
    expect(screen.getByText(/this looks like openqasm 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /switch to openqasm 2/i }));
    // After switching, the warning is gone.
    expect(screen.queryByText(/this looks like openqasm 2/i)).not.toBeInTheDocument();
  });

  it("submits via the form button", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Get quote" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
