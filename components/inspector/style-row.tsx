"use client";

import * as React from "react";
import { RotateCcw } from "honestui/icons";
import { Tooltip, TooltipTrigger, TooltipPopup } from "@/components/ui/tooltip";
import { PropertyRow } from "./controls";
import type { useStyleEditor } from "./use-style-editor";
import { cn } from "@/lib/utils";

export type StyleEditor = ReturnType<typeof useStyleEditor>;

/** A property row wired to the style editor: override dot, conflict warning and reset come for free. */
export function StyleRow({
  s,
  property,
  label,
  htmlFor,
  resets,
  children,
}: {
  s: StyleEditor;
  property: string;
  label: string;
  htmlFor?: string;
  /** Properties cleared by the reset button; defaults to `property`. */
  resets?: string[];
  children: React.ReactNode;
}) {
  const props = resets ?? [property];
  return (
    <PropertyRow label={label} htmlFor={htmlFor} override={s.override(property)} conflict={s.conflict(property)} onReset={() => props.forEach((p) => s.set(p, null))}>
      {children}
    </PropertyRow>
  );
}

/** Two or three of these sit side by side when a group of related lengths reads better as a grid than as rows. */
export function MiniField({ s, property, label, children }: { s: StyleEditor; property: string; label: string; children: React.ReactNode }) {
  const override = s.override(property);
  return (
    <div className="group/mini flex min-w-0 flex-col gap-1">
      <div className="flex h-4 items-center gap-1.5">
        {override.kind !== "none" && <span className={cn("inline-block size-1.5 shrink-0 rounded-full", override.kind === "here" ? "bg-fk-accent" : "border border-fk-accent")} aria-hidden="true" />}
        <span className={cn("truncate text-[10.5px] leading-4", override.kind === "none" ? "text-fk-text-muted" : "text-fk-text")}>{label}</span>
        {override.kind === "here" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => s.set(property, null)}
                  aria-label={`Reset ${label}`}
                  className="ml-auto flex size-4 items-center justify-center rounded text-fk-text-faint opacity-0 transition-[opacity,color] hover:text-fk-text group-hover/mini:opacity-100 focus-visible:opacity-100"
                />
              }
            >
              <RotateCcw className="size-3" strokeWidth={1.5} />
            </TooltipTrigger>
            <TooltipPopup>Remove the Framekit override</TooltipPopup>
          </Tooltip>
        )}
      </div>
      {children}
    </div>
  );
}

/** A quiet inline action used where a sub-editor can be added or removed (shadow, gradient). */
export function InlineAction({ onClick, children, icon }: { onClick: () => void; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-6 w-full items-center justify-center gap-1.5 rounded-[4px] border border-dashed border-fk-border-strong text-[11px] text-fk-text-secondary transition-colors hover:border-fk-text-muted hover:text-fk-text"
    >
      {icon}
      {children}
    </button>
  );
}
