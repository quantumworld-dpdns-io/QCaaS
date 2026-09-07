"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/context";

/** Inline confirm dialog (no window.confirm). Rendered as a fixed overlay when `open`. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: ReactNode;
  message: ReactNode;
  confirmLabel?: ReactNode;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-base font-semibold text-slate-900">
          {title ?? t("admin.confirm.title")}
        </h2>
        <div className="mt-2 text-sm text-slate-600">{message}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t("admin.confirm.cancel")}
          </Button>
          <Button ref={confirmRef} variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {confirmLabel ?? t("admin.confirm.ok")}
          </Button>
        </div>
      </div>
    </div>
  );
}
