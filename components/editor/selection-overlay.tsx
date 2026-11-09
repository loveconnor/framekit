"use client";

import type { Rect } from "@/lib/client/bridge";
import { cn } from "@/lib/utils";

type Props = {
  hovered: { rect: Rect; label: string } | null;
  selected: { rect: Rect; label: string } | null;
  frame: { width: number; height: number };
};

/**
 * Editor-side outlines drawn over the iframe. Nothing here touches the website's own CSS.
 * The selection carries the dimension readout, like a drafting dimension line.
 */
export function SelectionOverlay({ hovered, selected, frame }: Props) {
  const showHover = hovered && selected ? !sameRect(hovered.rect, selected.rect) : Boolean(hovered);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {showHover && hovered && <Outline rect={hovered.rect} frame={frame} label={hovered.label} kind="hover" />}
      {selected && <Outline rect={selected.rect} frame={frame} label={selected.label} kind="selected" />}
    </div>
  );
}

function Outline({ rect, frame, label, kind }: { rect: Rect; frame: Props["frame"]; label: string; kind: "hover" | "selected" }) {
  const visible = rect.width > 0 || rect.height > 0;
  if (!visible) return null;
  const clamped = clampRect(rect, frame);
  if (!clamped) return null;
  const labelAbove = rect.y >= 18;
  return (
    <>
      <div
        className={cn("absolute box-border", kind === "hover" ? "border border-fk-accent/70" : "border-[1.5px] border-fk-accent")}
        style={{ left: clamped.x, top: clamped.y, width: clamped.width, height: clamped.height }}
      />
      <span
        className={cn(
          "absolute flex h-4 items-center whitespace-nowrap rounded-[2px] px-1 text-[10px] font-medium leading-none tracking-[0.01em] text-white",
          kind === "hover" ? "bg-fk-accent/85" : "bg-fk-accent",
          labelAbove ? "rounded-b-none" : "rounded-tl-none",
        )}
        style={{ left: Math.max(0, Math.min(clamped.x, frame.width - 60)), top: labelAbove ? clamped.y - 16 : clamped.y }}
      >
        {label}
      </span>
      {kind === "selected" && (
        <span
          className="fk-num absolute flex h-4 items-center whitespace-nowrap rounded-[2px] bg-fk-accent px-1 font-mono text-[10px] leading-none text-white"
          style={{
            left: Math.max(0, Math.min(clamped.x + clamped.width - 2, frame.width - 70)),
            top: clamped.y + clamped.height + 18 <= frame.height ? clamped.y + clamped.height + 2 : clamped.y + clamped.height - 18,
            transform: "translateX(-100%)",
          }}
        >
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
      )}
    </>
  );
}

function clampRect(rect: Rect, frame: Props["frame"]): Rect | null {
  const x = Math.max(-1, rect.x);
  const y = Math.max(-1, rect.y);
  const right = Math.min(frame.width + 1, rect.x + rect.width);
  const bottom = Math.min(frame.height + 1, rect.y + rect.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function sameRect(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}
