import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsersTable } from "@/components/admin/UsersTable";
import { I18nProvider } from "@/i18n/context";
import { setSession } from "@/lib/auth/store";
import type { User } from "@/lib/auth/types";

const me: User = { id: "u1", email: "admin@example.com", name: "Admin", role: "admin", active: true, created_at: "2026-01-01T00:00:00Z" };
const other: User = { id: "u2", email: "bob@example.com", name: "Bob", role: "customer", active: true, created_at: "2026-02-01T00:00:00Z", api_key_prefix: "qc_live_ab" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderTable(onUpdated = vi.fn()) {
  render(
    <I18nProvider initialLocale="en">
      <UsersTable users={[me, other]} currentUserId={me.id} onUpdated={onUpdated} />
    </I18nProvider>,
  );
  return onUpdated;
}

describe("admin UsersTable", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    localStorage.clear();
    setSession({ token: "jwt", expires_at: "2099-01-01T00:00:00Z", user: me, has_api_key: false });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("disables actions on the admin's own row and shows key prefixes", () => {
    renderTable();
    const mine = within(screen.getByTestId("user-row-u1"));
    expect(mine.getByText("you")).toBeInTheDocument();
    expect(mine.getByRole("button", { name: "Make customer" })).toBeDisabled();
    expect(mine.getByRole("button", { name: "Disable" })).toBeDisabled();
    const theirs = within(screen.getByTestId("user-row-u2"));
    expect(theirs.getByRole("button", { name: "Make admin" })).toBeEnabled();
    expect(theirs.getByText("qc_live_ab…")).toBeInTheDocument();
  });

  it("toggles the role after an inline confirm and reports the updated user", async () => {
    const user = userEvent.setup();
    const onUpdated = renderTable();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...other, role: "admin" }));

    await user.click(within(screen.getByTestId("user-row-u2")).getByRole("button", { name: "Make admin" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Change the role of bob@example.com to Admin?");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: "u2", role: "admin" })));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:8080/admin/users/u2");
    expect(init!.method).toBe("PATCH");
    expect((init!.headers as Headers).get("Authorization")).toBe("Bearer jwt");
    expect(JSON.parse(String(init!.body))).toEqual({ role: "admin" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables a user with a danger confirm, and cancelling sends nothing", async () => {
    const user = userEvent.setup();
    const onUpdated = renderTable();

    await user.click(within(screen.getByTestId("user-row-u2")).getByRole("button", { name: "Disable" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Disable bob@example.com?");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ...other, active: false }));
    await user.click(within(screen.getByTestId("user-row-u2")).getByRole("button", { name: "Disable" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: "u2", active: false })));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ active: false });
  });

  it("shows the mapped error message when the service refuses (self_lockout)", async () => {
    const user = userEvent.setup();
    const onUpdated = renderTable();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "cannot lock yourself out", code: "self_lockout" }, 422));
    await user.click(within(screen.getByTestId("user-row-u2")).getByRole("button", { name: "Make admin" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cannot demote or disable your own account.");
    expect(onUpdated).not.toHaveBeenCalled();
  });
});
