"use client";

import { useEffect, useState } from "react";
import { useComplexContext } from "@/components/complex-context";

export function CopyComplexUuidButton({
  label,
  copiedLabel,
}: {
  label: string;
  copiedLabel: string;
}) {
  const { complexId } = useComplexContext();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    if (!complexId) return;
    try {
      await navigator.clipboard.writeText(complexId);
      setCopied(true);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — nothing to do.
    }
  }

  return (
    <button
      type="button"
      disabled={!complexId}
      onClick={handleCopy}
      title={complexId || undefined}
      className="btn btn-secondary mb-2 w-full"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
