"use client";

import * as React from "react";
import { ChevronRight, ChevronDown, RotateCcw, TriangleAlert } from "honestui/icons";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { Tooltip, TooltipTrigger, TooltipPopup } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";
import { ColorPickerRoot, ColorPickerArea, ColorPickerHue, ColorPickerAlpha } from "@/components/ui/color-picker";
import type { Breakpoint } from "@/types/elements";
import { parseLength, formatLength } from "@/lib/client/style-utils";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Shared field styling: flat fills, 24px tall, accent only on focus    */
/* ------------------------------------------------------------------ */

export const fieldClass =
  "h-6 min-w-0 rounded-[4px] border border-transparent bg-fk-raised text-[11px] leading-4 text-fk-text outline-none transition-colors placeholder:text-fk-text-faint hover:bg-[#ececec] focus:border-fk-accent focus:bg-fk-panel disabled:cursor-not-allowed disabled:text-fk-text-muted";

const fieldWrapClass =
  "flex h-6 min-w-0 items-stretch overflow-hidden rounded-[4px] border border-transparent bg-fk-raised transition-colors hover:bg-[#ececec] focus-within:border-fk-accent focus-within:bg-fk-panel focus-within:hover:bg-fk-panel";

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

export function InspectorSection({ title, children, defaultOpen = true, badge }: { title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-fk-border">
      <CollapsibleTrigger className="group/section flex h-8 w-full items-center gap-1.5 px-3 text-left text-[11px] font-medium text-fk-text">
        <ChevronRight className={cn("size-3 text-fk-text-faint transition-transform duration-150 ease-fk group-hover/section:text-fk-text-muted", open && "rotate-90")} strokeWidth={1.5} />
        <span className="flex-1">{title}</span>
        {badge}
      </CollapsibleTrigger>
      <CollapsiblePanel className="px-3 pb-3">
        <div className="flex flex-col gap-1.5">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/* ------------------------------------------------------------------ */
/* Property row                                                        */
/* ------------------------------------------------------------------ */

export type OverrideState =
  | { kind: "none" }
  | { kind: "here"; breakpoint: Breakpoint }
  | { kind: "inherited"; breakpoint: Breakpoint };

export function PropertyRow({
  label,
  htmlFor,
  override = { kind: "none" },
  conflict = false,
  onReset,
  children,
  stacked = false,
}: {
  label: string;
  htmlFor?: string;
  override?: OverrideState;
  conflict?: boolean;
  onReset?: () => void;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={cn("group/row grid gap-2", stacked ? "grid-cols-1 gap-1" : "grid-cols-[76px_minmax(0,1fr)] items-center")}>
      <div className="flex h-6 min-w-0 items-center gap-1.5">
        <label
          htmlFor={htmlFor}
          className={cn("flex min-w-0 items-center gap-1.5 truncate text-[11px] leading-4", override.kind === "none" ? "text-fk-text-secondary" : "text-fk-text")}
        >
          <OverrideDot state={override} />
          <span className="truncate">{label}</span>
        </label>
        {conflict && (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex text-fk-warning" />}>
              <TriangleAlert className="size-3" strokeWidth={1.5} />
            </TooltipTrigger>
            <TooltipPopup>This style is overridden by existing CSS.</TooltipPopup>
          </Tooltip>
        )}
        {override.kind === "here" && onReset && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onReset}
                  aria-label={`Reset ${label}`}
                  className="ml-auto flex size-4 items-center justify-center rounded text-fk-text-faint opacity-0 transition-[opacity,color] hover:text-fk-text group-hover/row:opacity-100 focus-visible:opacity-100"
                />
              }
            >
              <RotateCcw className="size-3" strokeWidth={1.5} />
            </TooltipTrigger>
            <TooltipPopup>Remove the Framekit override</TooltipPopup>
          </Tooltip>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function OverrideDot({ state }: { state: OverrideState }) {
  if (state.kind === "none") return null;
  const title = state.kind === "here" ? `Framekit override on ${state.breakpoint}` : `Inherits a Framekit override from ${state.breakpoint}`;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("inline-block size-1.5 shrink-0 rounded-full", state.kind === "here" ? "bg-fk-accent" : "border border-fk-accent")} aria-label={title} />} />
      <TooltipPopup>{title}</TooltipPopup>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/**
 * A local draft that re-syncs from the external value whenever it changes and the field is not
 * focused. Adjusting state during render avoids an extra effect-driven render.
 */
function useDraft<T>(external: T, focused: boolean, onExternalChange?: () => void): [T, (next: T) => void] {
  const [draft, setDraft] = React.useState(external);
  const [previous, setPrevious] = React.useState(external);
  if (external !== previous) {
    setPrevious(external);
    if (!focused) {
      setDraft(external);
      onExternalChange?.();
    }
  }
  return [draft, setDraft];
}

export function TextField(props: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  const { className, mono, ...rest } = props;
  return <input {...rest} className={cn(fieldClass, "w-full px-2", mono && "font-mono text-[10.5px]", className)} />;
}

/**
 * Text input that commits on Enter or blur and reverts on Escape. The parent owns the value,
 * so typing never fires a command until the user is done.
 */
export function CommitInput({
  value,
  onCommit,
  onLiveChange,
  placeholder,
  disabled,
  mono,
  id,
  className,
  multiline = false,
}: {
  value: string;
  onCommit: (value: string) => void;
  onLiveChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  id?: string;
  className?: string;
  multiline?: boolean;
}) {
  const [focused, setFocused] = React.useState(false);
  const [draft, setDraft] = useDraft(value, focused);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const common = {
    id,
    value: draft,
    placeholder,
    disabled,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      commit();
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(e.target.value);
      onLiveChange?.(e.target.value);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setDraft(value);
        onLiveChange?.(value);
        (e.target as HTMLElement).blur();
      }
      e.stopPropagation();
    },
  };
  if (multiline) {
    return (
      <textarea
        {...common}
        rows={Math.min(8, Math.max(2, draft.split("\n").length + Math.floor(draft.length / 40)))}
        className={cn(fieldClass, "h-auto w-full resize-none px-2 py-1.5 leading-4", className)}
      />
    );
  }
  return <input {...common} type="text" className={cn(fieldClass, "w-full px-2", mono && "font-mono text-[10.5px]", className)} />;
}

/**
 * CSS length input with a unit menu. Empty means "no override" and shows the computed value as
 * a placeholder, so an empty field never turns into 0.
 */
export function LengthInput({
  value,
  computed,
  units,
  onCommit,
  allowNegative = false,
  keywords = [],
  disabled,
  id,
  ariaLabel,
}: {
  value: string | null;
  computed?: string;
  units: string[];
  onCommit: (value: string | null) => void;
  allowNegative?: boolean;
  keywords?: string[];
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  const parsed = parseLength(value);
  const computedParsed = parseLength(computed);
  const defaultUnit = (parsed && "unit" in parsed ? parsed.unit : computedParsed && "unit" in computedParsed ? computedParsed.unit : units[0]) || units[0];
  const externalText = parsed ? ("unit" in parsed ? String(parsed.number) : parsed.keyword) : "";
  const [focused, setFocused] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  const [unit, setUnit] = React.useState(defaultUnit);
  const [draft, setDraft] = useDraft(externalText, focused, () => {
    setUnit(defaultUnit);
    setInvalid(false);
  });
  const [previousDefaultUnit, setPreviousDefaultUnit] = React.useState(defaultUnit);
  if (defaultUnit !== previousDefaultUnit) {
    setPreviousDefaultUnit(defaultUnit);
    if (!focused) setUnit(defaultUnit);
  }

  const isKeyword = parsed && "keyword" in parsed;
  const allUnits = [...units, ...keywords];
  const placeholder = computedParsed ? ("unit" in computedParsed ? formatLength(computedParsed.number, computedParsed.unit) : computedParsed.keyword) : "";

  const commitDraft = (text: string, nextUnit = unit) => {
    const trimmed = text.trim();
    if (trimmed === "") {
      if (value !== null) onCommit(null);
      setInvalid(false);
      return;
    }
    if (keywords.includes(trimmed)) {
      setInvalid(false);
      if (trimmed !== value) onCommit(trimmed);
      return;
    }
    const n = Number(trimmed);
    if (Number.isNaN(n) || (!allowNegative && n < 0) || keywords.includes(nextUnit)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const next = formatLength(n, nextUnit);
    if (next !== value) onCommit(next);
  };

  const step = (direction: 1 | -1, big: boolean) => {
    const base = draft.trim() === "" ? (computedParsed && "unit" in computedParsed ? computedParsed.number : 0) : Number(draft);
    if (Number.isNaN(base)) return;
    const amount = (big ? 10 : 1) * (unit === "rem" || unit === "em" ? 0.1 : 1);
    let next = Math.round((base + direction * amount) * 100) / 100;
    if (!allowNegative && next < 0) next = 0;
    setDraft(String(next));
    commitDraft(String(next));
  };

  return (
    <div className={cn(fieldWrapClass, invalid && "border-fk-error", disabled && "opacity-60")}>
      <input
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={isKeyword && !focused ? "" : draft}
        placeholder={isKeyword ? parsed.keyword : placeholder || "–"}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitDraft(draft);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft(draft);
            (e.target as HTMLElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setFocused(false);
            (e.target as HTMLElement).blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            step(1, e.shiftKey);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            step(-1, e.shiftKey);
          }
        }}
        className={cn("fk-num min-w-0 flex-1 bg-transparent px-2 text-[11px] text-fk-text outline-none placeholder:text-fk-text-faint", isKeyword && "placeholder:text-fk-text")}
      />
      {allUnits.length === 1 && units[0] && (
        <span className="fk-num pointer-events-none flex w-7 shrink-0 items-center justify-end pr-2 text-[10px] text-fk-text-muted" aria-hidden="true">
          {units[0]}
        </span>
      )}
      {allUnits.length > 1 && (
        <select
          aria-label={`${ariaLabel ?? "Value"} unit`}
          disabled={disabled}
          value={isKeyword ? parsed.keyword : unit}
          onChange={(e) => {
            const next = e.target.value;
            if (keywords.includes(next)) {
              setDraft("");
              onCommit(next);
              return;
            }
            setUnit(next);
            if (draft.trim() !== "" && !Number.isNaN(Number(draft))) commitDraft(draft, next);
            else if (isKeyword) {
              setDraft("");
              onCommit(null);
            }
          }}
          className="fk-num w-9 shrink-0 cursor-pointer appearance-none bg-transparent pr-1.5 text-right text-[10px] text-fk-text-muted outline-none hover:text-fk-text"
        >
          {units.map((u) => (
            <option key={u || "unitless"} value={u}>
              {u || "–"}
            </option>
          ))}
          {keywords.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * Plain value for the box model: looks like text until you focus it. Accepts `16`, `16px`,
 * `1rem`, `50%`, `auto` and negative values where allowed; a bare number means px.
 */
export function FreeLengthInput({
  value,
  computed,
  onCommit,
  allowAuto,
  allowNegative,
  ariaLabel,
}: {
  value: string | null;
  computed?: string;
  onCommit: (value: string | null) => void;
  allowAuto?: boolean;
  allowNegative?: boolean;
  ariaLabel: string;
}) {
  const [focused, setFocused] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  const [draft, setDraft] = useDraft(value ?? "", focused, () => setInvalid(false));

  const commit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") {
      setInvalid(false);
      if (value !== null) onCommit(null);
      return;
    }
    if (trimmed === "auto") {
      if (!allowAuto) return setInvalid(true);
      setInvalid(false);
      if (value !== "auto") onCommit("auto");
      return;
    }
    const m = trimmed.match(/^(-?\d*\.?\d+)(px|rem|em|%|vw|vh)?$/);
    if (!m || (!allowNegative && Number(m[1]) < 0)) return setInvalid(true);
    setInvalid(false);
    const next = `${m[1]}${m[2] ?? "px"}`;
    if (next !== value) onCommit(next);
  };

  const step = (direction: 1 | -1, big: boolean) => {
    const current = parseLength(draft.trim() === "" ? computed : draft);
    const base = current && "number" in current ? current.number : 0;
    const unit = current && "unit" in current ? current.unit || "px" : "px";
    let next = Math.round((base + direction * (big ? 10 : 1)) * 100) / 100;
    if (!allowNegative && next < 0) next = 0;
    const text = `${next}${unit}`;
    setDraft(text);
    commit(text);
  };

  const placeholder = (() => {
    const parsed = parseLength(computed);
    if (!parsed) return "–";
    return "number" in parsed ? formatLength(parsed.number, parsed.unit).replace(/px$/, "") : parsed.keyword;
  })();

  return (
    <input
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      type="text"
      inputMode="decimal"
      value={draft.replace(/px$/, "")}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit(draft);
          (e.target as HTMLElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(value ?? "");
          (e.target as HTMLElement).blur();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          step(1, e.shiftKey);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          step(-1, e.shiftKey);
        }
      }}
      className={cn(
        "fk-num h-5 w-full min-w-0 rounded-[3px] border border-transparent bg-transparent px-0.5 text-center text-[10.5px] leading-4 outline-none transition-colors placeholder:text-fk-text-muted hover:bg-black/[0.05] focus:border-fk-accent focus:bg-fk-panel",
        invalid ? "border-fk-error" : "",
        value !== null ? "text-fk-accent" : "text-fk-text",
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                   */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T | null;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid h-6 auto-cols-fr grid-flow-col gap-px rounded-[4px] bg-fk-raised p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={option.label}
                  onClick={() => onChange(option.value)}
                  className={cn(
                    "flex min-w-0 items-center justify-center rounded-[3px] px-1 text-[11px] transition-colors",
                    active ? "bg-fk-panel text-fk-text shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-fk-text-muted hover:text-fk-text",
                  )}
                />
              }
            >
              {option.icon ?? <span className="truncate">{option.label}</span>}
            </TooltipTrigger>
            <TooltipPopup>{option.label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

export function SelectControl({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  disabled,
}: {
  value: string | null;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  /** Shown as the current (measured) value when nothing is set. */
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const hasValue = value !== null && options.some((o) => o.value === value);
  return (
    <div className="relative">
      <select
        aria-label={ariaLabel}
        disabled={disabled}
        value={hasValue ? value : "__computed"}
        onChange={(e) => e.target.value !== "__computed" && onChange(e.target.value)}
        className={cn(fieldClass, "w-full cursor-pointer appearance-none pl-2 pr-6", !hasValue && "text-fk-text-faint")}
      >
        {!hasValue && (
          <option value="__computed" disabled>
            {placeholder ?? "–"}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-fk-text-muted" strokeWidth={1.5} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Color                                                               */
/* ------------------------------------------------------------------ */

export function ColorField({ value, computed, onCommit, ariaLabel }: { value: string | null; computed?: string; onCommit: (value: string | null) => void; ariaLabel: string }) {
  const shown = value ?? computed ?? "";
  const [focused, setFocused] = React.useState(false);
  const [draft, setDraft] = useDraft(shown, focused);

  const commitText = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") {
      if (value !== null) onCommit(null);
      return;
    }
    if (trimmed !== value) onCommit(trimmed);
  };

  return (
    <div className={fieldWrapClass}>
      <Popover>
        <PopoverTrigger
          render={<button type="button" aria-label={`Pick ${ariaLabel}`} className="flex w-6 shrink-0 items-center justify-center" />}
        >
          <span
            className="size-3.5 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
            style={{ background: shown && shown !== "transparent" ? shown : "repeating-conic-gradient(#d4d4d4 0 25%, #fff 0 50%) 0 0 / 6px 6px" }}
          />
        </PopoverTrigger>
        <PopoverPopup side="left" align="start" className="w-56 p-3">
          <ColorPickerRoot value={shown && shown !== "transparent" ? shown : "#000000"} mode="hex" onValueChange={(next) => onCommit(next)}>
            <div className="flex flex-col gap-3">
              <ColorPickerArea className="h-32 w-full rounded-md" />
              <ColorPickerHue className="w-full" />
              <ColorPickerAlpha className="w-full" />
            </div>
          </ColorPickerRoot>
        </PopoverPopup>
      </Popover>
      <input
        aria-label={ariaLabel}
        type="text"
        spellCheck={false}
        value={draft}
        placeholder={computed ?? "–"}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitText(draft);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLElement).blur();
          if (e.key === "Escape") {
            setDraft(shown);
            (e.target as HTMLElement).blur();
          }
        }}
        className={cn("min-w-0 flex-1 bg-transparent pr-2 font-mono text-[10.5px] outline-none placeholder:text-fk-text-faint", value === null ? "text-fk-text-secondary" : "text-fk-text")}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

export function Notice({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warning" }) {
  return (
    <p className={cn("rounded-[4px] px-2 py-1.5 text-[11px] leading-4", tone === "muted" ? "bg-fk-raised text-fk-text-secondary" : "bg-amber-50 text-fk-warning")}>{children}</p>
  );
}
