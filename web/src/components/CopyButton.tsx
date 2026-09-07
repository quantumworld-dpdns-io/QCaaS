"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/context";
import { copyText } from "@/lib/utils";

export function CopyButton({ text, size = "sm" }: { text: string; size?: "sm" | "md" }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <Button variant="secondary" size={size} onClick={onCopy}>
      {copied ? t("common.copied") : t("common.copy")}
    </Button>
  );
}
