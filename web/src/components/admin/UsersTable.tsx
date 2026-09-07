"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/context";
import { accounts } from "@/lib/auth/client";
import { accountsErrorMessage } from "@/lib/auth/messages";
import type { Role, User } from "@/lib/auth/types";
import { cn, formatDate } from "@/lib/utils";

type Pending = { user: User; patch: { role?: Role; active?: boolean } };

export function UsersTable({ users, currentUserId, onUpdated }: { users: User[]; currentUserId: string; onUpdated: (user: User) => void }) {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
  const td = "px-3 py-2 text-sm text-slate-800 whitespace-nowrap";

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await accounts.admin.patchUser(pending.user.id, pending.patch);
      onUpdated(updated);
      setPending(null);
    } catch (err) {
      setError(accountsErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const message = pending
    ? pending.patch.role !== undefined
      ? t("admin.confirm.role", { email: pending.user.email, role: t(`role.${pending.patch.role}`) })
      : pending.patch.active === false
        ? t("admin.confirm.disable", { email: pending.user.email })
        : t("admin.confirm.enable", { email: pending.user.email })
    : "";

  if (users.length === 0) return <p className="text-sm text-slate-500">{t("admin.empty")}</p>;

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>{t("admin.users.email")}</th>
              <th className={th}>{t("admin.users.name")}</th>
              <th className={th}>{t("admin.users.role")}</th>
              <th className={th}>{t("admin.users.status")}</th>
              <th className={th}>{t("admin.users.keyPrefix")}</th>
              <th className={th}>{t("admin.users.created")}</th>
              <th className={th}>{t("admin.users.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {users.map((u) => {
              const self = u.id === currentUserId;
              return (
                <tr key={u.id} data-testid={`user-row-${u.id}`} className={cn(!u.active && "opacity-60")}>
                  <td className={td}>
                    {u.email}
                    {self && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t("admin.users.you")}</span>}
                  </td>
                  <td className={td}>{u.name || "—"}</td>
                  <td className={td}>{t(`role.${u.role}`)}</td>
                  <td className={td}>
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", u.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200")}>
                      {u.active ? t("admin.users.active") : t("admin.users.disabled")}
                    </span>
                  </td>
                  <td className={cn(td, "font-mono text-xs")}>{u.api_key_prefix ? `${u.api_key_prefix}…` : "—"}</td>
                  <td className={td}>{formatDate(u.created_at, locale)}</td>
                  <td className={td}>
                    <div className="flex gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={self || busy}
                        onClick={() => setPending({ user: u, patch: { role: u.role === "admin" ? "customer" : "admin" } })}
                      >
                        {u.role === "admin" ? t("admin.users.makeCustomer") : t("admin.users.makeAdmin")}
                      </Button>
                      <Button
                        variant={u.active ? "danger" : "secondary"}
                        size="sm"
                        disabled={self || busy}
                        onClick={() => setPending({ user: u, patch: { active: !u.active } })}
                      >
                        {u.active ? t("admin.users.disable") : t("admin.users.enable")}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={pending !== null}
        message={message}
        danger={pending?.patch.active === false}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => {
          if (!busy) setPending(null);
        }}
      />
    </>
  );
}
