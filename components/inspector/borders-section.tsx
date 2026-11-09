"use client";

import * as React from "react";
import { Square, PanelTop, PanelRight, PanelBottom, PanelLeft, Link, Unlink } from "honestui/icons";
import type { ElementInfo } from "@/types/elements";
import { useStyleEditor } from "./use-style-editor";
import { InspectorSection, LengthInput, Segmented, SelectControl, ColorField } from "./controls";
import { StyleRow, MiniField } from "./style-row";
import { Tooltip, TooltipTrigger, TooltipPopup } from "@/components/ui/tooltip";
import { toHex } from "@/lib/client/style-utils";
import { cn } from "@/lib/utils";

const STYLES = [
  { value: "none", label: "None" },
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

type Side = "all" | "top" | "right" | "bottom" | "left";
const SIDES: Array<{ value: Side; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }> = [
  { value: "all", label: "All sides", icon: Square },
  { value: "top", label: "Top", icon: PanelTop },
  { value: "right", label: "Right", icon: PanelRight },
  { value: "bottom", label: "Bottom", icon: PanelBottom },
  { value: "left", label: "Left", icon: PanelLeft },
];
const ALL_BORDER_PROPS = ["border-width", "border-style", "border-color"].concat(
  ["top", "right", "bottom", "left"].flatMap((side) => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`]),
);
const CORNERS = [
  { property: "border-top-left-radius", label: "Top left" },
  { property: "border-top-right-radius", label: "Top right" },
  { property: "border-bottom-left-radius", label: "Bottom left" },
  { property: "border-bottom-right-radius", label: "Bottom right" },
];

export function BordersSection({ info }: { info: ElementInfo }) {
  const s = useStyleEditor(info);
  const [side, setSide] = React.useState<Side>("all");
  const prop = (kind: "width" | "style" | "color") => (side === "all" ? `border-${kind}` : `border-${side}-${kind}`);
  const computedSide = side === "all" ? "top" : side;
  // Reading a side falls back to the shorthand Framekit may have written for all sides.
  const read = (kind: "width" | "style" | "color") => s.value(prop(kind)) ?? (side === "all" ? null : s.value(`border-${kind}`));
  const computed = (kind: "width" | "style" | "color") => s.computed?.[`border-${computedSide}-${kind}`];

  const anyCornerSet = CORNERS.some((c) => s.value(c.property) !== null);
  const [cornersOpen, setCornersOpen] = React.useState(anyCornerSet);
  const radiusComputed = s.computed?.["border-top-left-radius"];

  return (
    <InspectorSection title="Borders" defaultOpen={false}>
      <StyleRow s={s} property={prop("width")} label="Sides" resets={ALL_BORDER_PROPS}>
        <Segmented<Side> ariaLabel="Border side" value={side} options={SIDES.map((x) => ({ value: x.value, label: x.label, icon: <x.icon className="size-3.5" strokeWidth={1.5} /> }))} onChange={setSide} />
      </StyleRow>
      <StyleRow s={s} property={prop("width")} label="Width">
        <LengthInput ariaLabel="Border width" value={read("width")} computed={computed("width")} units={["px", "rem"]} onCommit={(v) => s.set(prop("width"), v)} />
      </StyleRow>
      <StyleRow s={s} property={prop("style")} label="Style">
        <SelectControl ariaLabel="Border style" value={read("style")} placeholder={computed("style") ?? "none"} options={STYLES} onChange={(v) => s.set(prop("style"), v)} />
      </StyleRow>
      <StyleRow s={s} property={prop("color")} label="Color">
        <ColorField ariaLabel="Border color" value={read("color")} computed={toHex(computed("color"))} onCommit={(v) => s.set(prop("color"), v)} />
      </StyleRow>

      <div className="pt-1" />
      <div className="group/row grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2">
        <div className="flex h-6 items-center gap-1.5">
          <span className={cn("truncate text-[11px] leading-4", s.override("border-radius").kind === "none" && !anyCornerSet ? "text-fk-text-secondary" : "text-fk-text")}>Radius</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-pressed={cornersOpen}
                  aria-label={cornersOpen ? "Use one radius for all corners" : "Set each corner separately"}
                  onClick={() => setCornersOpen((o) => !o)}
                  className={cn("ml-auto flex size-4 items-center justify-center rounded transition-colors hover:text-fk-text", cornersOpen ? "text-fk-accent" : "text-fk-text-faint")}
                />
              }
            >
              {cornersOpen ? <Unlink className="size-3" strokeWidth={1.5} /> : <Link className="size-3" strokeWidth={1.5} />}
            </TooltipTrigger>
            <TooltipPopup>{cornersOpen ? "Use one radius for all corners" : "Set each corner separately"}</TooltipPopup>
          </Tooltip>
        </div>
        {!cornersOpen && (
          <LengthInput ariaLabel="Border radius" value={s.value("border-radius")} computed={radiusComputed} units={["px", "rem", "%"]} onCommit={(v) => s.set("border-radius", v)} />
        )}
      </div>
      {cornersOpen && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {CORNERS.map((corner) => (
            <MiniField key={corner.property} s={s} property={corner.property} label={corner.label}>
              <LengthInput
                ariaLabel={`${corner.label} radius`}
                value={s.value(corner.property) ?? s.value("border-radius")}
                computed={s.computed?.[corner.property]}
                units={["px", "rem", "%"]}
                onCommit={(v) => s.set(corner.property, v)}
              />
            </MiniField>
          ))}
        </div>
      )}
    </InspectorSection>
  );
}
