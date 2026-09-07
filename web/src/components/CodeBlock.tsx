"use client";

import { useState } from "react";
import { useT } from "@/i18n/context";
import { copyText, downloadText } from "@/lib/utils";
import { Button } from "./ui";

export function CodeBlock({
  code,
  filename,
  mime = "text/plain",
  collapsible = false,
  defaultOpen = true,
  title,
  maxHeight = "24rem",
}: {
  code: string;
  filename?: string;
  mime?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  title?: string;
  maxHeight?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="truncate text-xs font-medium text-slate-600">{title ?? filename ?? ""}</span>
        <div className="flex items-center gap-1">
          {collapsible && (
            <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? t("common.hide") : t("common.show")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCopy}>
            {copied ? t("common.copied") : t("common.copy")}
          </Button>
          {filename && (
            <Button variant="ghost" size="sm" onClick={() => downloadText(filename, code, mime)}>
              {t("common.download")}
            </Button>
          )}
        </div>
      </div>
      {open && (
        <pre className="overflow-auto bg-slate-900 p-3 text-xs leading-relaxed text-slate-100" style={{ maxHeight }}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
