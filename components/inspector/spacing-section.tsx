"use client";

import * as React from "react";
import { Link, Unlink } from "honestui/icons";
import type { ElementInfo } from "@/types/elements";
import { useStyleEditor } from "./use-style-editor";
import { InspectorSection, FreeLengthInput } from "./controls";
import { Tooltip, TooltipTrigger, TooltipPopup } from "@/components/ui/tooltip";
import { parseLength } from "@/lib/client/style-utils";
import { cn } from "@/lib/utils";

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];
type Kind = "margin" | "padding";

/**
 * Box model: a margin ring around a padding ring around the content box. Values read as plain
 * text until focused; blue means a Framekit override, grey is the measured value.
 */
export function SpacingSection({ info }: { info: ElementInfo }) {
  const s = useStyleEditor(info);
  const [linked, setLinked] = React.useState<Record<Kind, boolean>>({ margin: false, padding: false });
  const hasOverride = SIDES.some((side) => s.override(`margin-${side}`).kind === "here" || s.override(`padding-${side}`).kind === "here");

  const setSide = (kind: Kind, side: Side, value: string | null) => {
    if (linked[kind]) for (const other of SIDES) s.set(`${kind}-${other}`, value);
    else s.set(`${kind}-${side}`, value);
  };

  const resetAll = () => {
    for (const side of SIDES) {
      if (s.override(`margin-${side}`).kind === "here") s.set(`margin-${side}`, null);
      if (s.override(`padding-${side}`).kind === "here") s.set(`padding-${side}`, null);
    }
  };

  const toggle = (kind: Kind) => setLinked((l) => ({ ...l, [kind]: !l[kind] }));

  return (
    <InspectorSection
      title="Spacing"
      badge={
        hasOverride ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              resetAll();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                resetAll();
              }
            }}
            className="text-[11px] font-normal text-fk-text-muted hover:text-fk-text"
          >
            Reset
          </span>
        ) : undefined
      }
    >
      <div className="relative rounded-md bg-fk-raised px-2 pb-2 pt-1.5">
        <Ring kind="margin" linked={linked.margin} onToggle={() => toggle("margin")} />
        <Row>
          <Cell kind="margin" side="top" editor={s} onCommit={setSide} />
        </Row>
        <div className="mt-1 flex items-center gap-1">
          <Cell kind="margin" side="left" editor={s} onCommit={setSide} />
          <div className="relative min-w-0 flex-1 rounded-[4px] border border-fk-border bg-fk-panel px-2 pb-2 pt-1.5">
            <Ring kind="padding" linked={linked.padding} onToggle={() => toggle("padding")} />
            <Row>
              <Cell kind="padding" side="top" editor={s} onCommit={setSide} />
            </Row>
            <div className="mt-1 flex items-center gap-1">
              <Cell kind="padding" side="left" editor={s} onCommit={setSide} />
              <div className="fk-num flex h-6 min-w-0 flex-1 items-center justify-center truncate rounded-[3px] bg-fk-selected font-mono text-[10px] text-fk-accent">
                {s.computed ? `${pxNumber(s.computed.width)} × ${pxNumber(s.computed.height)}` : "–"}
              </div>
              <Cell kind="padding" side="right" editor={s} onCommit={setSide} />
            </div>
            <Row className="mt-1">
              <Cell kind="padding" side="bottom" editor={s} onCommit={setSide} />
            </Row>
          </div>
          <Cell kind="margin" side="right" editor={s} onCommit={setSide} />
        </div>
        <Row className="mt-1">
          <Cell kind="margin" side="bottom" editor={s} onCommit={setSide} />
        </Row>
      </div>
    </InspectorSection>
  );
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex justify-center", className)}>{children}</div>;
}

function pxNumber(raw: string | undefined): string {
  const parsed = parseLength(raw);
  return parsed && "number" in parsed ? String(Math.round(parsed.number)) : "–";
}

function Ring({ kind, linked, onToggle }: { kind: Kind; linked: boolean; onToggle: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-2 top-1 flex items-center justify-between text-[9.5px] leading-3 text-fk-text-muted">
      <span>{kind === "margin" ? "Margin" : "Padding"}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onToggle}
              aria-pressed={linked}
              aria-label={linked ? `Edit ${kind} sides separately` : `Edit all ${kind} sides together`}
              className={cn("pointer-events-auto -mr-0.5 flex size-4 items-center justify-center rounded transition-colors", linked ? "text-fk-accent" : "text-fk-text-faint hover:text-fk-text")}
            />
          }
        >
          {linked ? <Link className="size-2.5" strokeWidth={1.5} /> : <Unlink className="size-2.5" strokeWidth={1.5} />}
        </TooltipTrigger>
        <TooltipPopup>{linked ? "All sides linked" : "Link all sides"}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function Cell({
  kind,
  side,
  editor,
  onCommit,
}: {
  kind: Kind;
  side: Side;
  editor: ReturnType<typeof useStyleEditor>;
  onCommit: (kind: Kind, side: Side, value: string | null) => void;
}) {
  const property = `${kind}-${side}`;
  const conflict = editor.conflict(property);
  return (
    <div className="relative w-10 shrink-0" title={conflict ? "This style is overridden by existing CSS." : undefined}>
      <FreeLengthInput
        ariaLabel={`${kind} ${side}`}
        value={editor.value(property)}
        computed={editor.computed?.[property]}
        allowAuto={kind === "margin"}
        allowNegative={kind === "margin"}
        onCommit={(v) => onCommit(kind, side, v)}
      />
      {conflict && <span aria-hidden="true" className="absolute -right-0.5 top-0.5 size-1.5 rounded-full bg-fk-warning" />}
    </div>
  );
}
