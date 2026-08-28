"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Evidence that is available without being in the way.
 *
 * The page leads with a decision; everything that supports it lives behind one
 * of these. Nothing is removed — a claim you cannot check is worth less than
 * one you can — it just stops competing for attention with the answer.
 */
export function Disclosure({
  title,
  hint,
  children,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-[var(--line)] first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-2.5 text-left transition hover:text-[var(--text)]"
      >
        <ChevronRight
          size={13}
          className="shrink-0 text-[var(--muted)] transition-transform"
          style={{ transform: open ? "rotate(90deg)" : undefined }}
        />
        <span className="text-[12px] font-medium">{title}</span>
        {hint && <span className="ml-auto text-[10px] text-[var(--muted)]">{hint}</span>}
      </button>
      {open && <div className="pb-4 pl-[21px]">{children}</div>}
    </div>
  );
}
