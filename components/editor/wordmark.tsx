import { cn } from "@/lib/utils";

/** The Framekit mark: a corner bracket, the way a drafting sheet is registered on the table. */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-fk-text", className)}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M1.5 5.5v-4h4M14.5 10.5v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="var(--fk-accent)" strokeWidth="1.5" />
      </svg>
      {!compact && <span className="text-[13px] font-medium tracking-[-0.01em]">Framekit</span>}
    </span>
  );
}
