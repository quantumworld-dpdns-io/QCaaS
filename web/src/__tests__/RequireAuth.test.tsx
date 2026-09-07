import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/RequireAuth";
import { I18nProvider } from "@/i18n/context";
import { setSession } from "@/lib/auth/store";
import type { User } from "@/lib/auth/types";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/admin",
}));

const customer: User = { id: "u1", email: "c@example.com", name: "C", role: "customer", active: true, created_at: "2026-01-01T00:00:00Z" };
const admin: User = { ...customer, id: "u2", email: "admin@example.com", role: "admin" };

function meResponse(user: User) {
  return new Response(JSON.stringify({ user, has_api_key: false }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("RequireAuth", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    localStorage.clear();
    replace.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("redirects anonymous visitors to /login with a next param", async () => {
    render(
      <I18nProvider initialLocale="en">
        <RequireAuth>
          <p>secret</p>
        </RequireAuth>
      </I18nProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fadmin"));
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(screen.getByTestId("auth-guard-pending")).toHaveTextContent("Redirecting to login…");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a 403 page for customers on admin-only routes", async () => {
    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user: customer, has_api_key: false });
    fetchMock.mockResolvedValue(meResponse(customer));
    render(
      <I18nProvider initialLocale="en">
        <RequireAuth role="admin">
          <p>secret</p>
        </RequireAuth>
      </I18nProvider>,
    );
    expect(await screen.findByTestId("auth-guard-forbidden")).toHaveTextContent("403");
    expect(screen.getByText("Admins only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("renders children for an authorised admin and for any logged-in user without a role requirement", async () => {
    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user: admin, has_api_key: true });
    fetchMock.mockResolvedValue(meResponse(admin));
    const { unmount } = render(
      <RequireAuth role="admin">
        <p>admin secret</p>
      </RequireAuth>,
    );
    expect(await screen.findByText("admin secret")).toBeInTheDocument();
    unmount();

    setSession({ token: "jwt2", expires_at: "2099-01-01T00:00:00Z", user: customer, has_api_key: true });
    fetchMock.mockResolvedValue(meResponse(customer));
    render(
      <RequireAuth>
        <p>customer secret</p>
      </RequireAuth>,
    );
    expect(await screen.findByText("customer secret")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects once the session is invalidated by a 401 from GET /me", async () => {
    setSession({ token: "stale", expires_at: "2000-01-01T00:00:00Z", user: customer, has_api_key: false });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "expired", code: "unauthorized" }), { status: 401 }));
    render(
      <RequireAuth>
        <p>secret</p>
      </RequireAuth>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fadmin"));
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});
