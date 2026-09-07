import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BillingCard } from "@/components/BillingCard";
import { I18nProvider } from "@/i18n/context";

describe("BillingCard", () => {
  it("renders plan, fees and total (zh-TW default)", () => {
    render(
      <BillingCard
        billing={{ plan: "flex", qpu_cost_usd: 6, service_fee_usd: 0.03, classiq_platform_fee_usd: 2.08, total_usd: 8.11 }}
      />,
    );
    expect(screen.getByText("帳單")).toBeInTheDocument();
    expect(screen.getByText("Flex")).toBeInTheDocument();
    expect(screen.getByText("$6.00")).toBeInTheDocument();
    expect(screen.getByText("$0.03")).toBeInTheDocument();
    expect(screen.getByText("Classiq 平台費")).toBeInTheDocument();
    expect(screen.getByText("$2.08")).toBeInTheDocument();
    expect(screen.getByTestId("billing-total")).toHaveTextContent("$8.11");
  });

  it("omits the Classiq row when not itemised and honours the en locale", () => {
    render(
      <I18nProvider initialLocale="en">
        <BillingCard billing={{ plan: "payg", qpu_cost_usd: 8, service_fee_usd: 0.05, total_usd: 8.05 }} />
      </I18nProvider>,
    );
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText("Pay-as-you-go")).toBeInTheDocument();
    expect(screen.queryByText("Classiq platform fee")).not.toBeInTheDocument();
    expect(screen.getByTestId("billing-total")).toHaveTextContent("$8.05");
  });

  it("renders nothing without billing", () => {
    const { container } = render(<BillingCard billing={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
