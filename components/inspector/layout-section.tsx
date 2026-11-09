"use client";

import {
  ArrowRight, ArrowDown, AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalSpaceBetween, AlignHorizontalSpaceAround,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, StretchVertical,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
} from "honestui/icons";
import type { ElementInfo } from "@/types/elements";
import { useStyleEditor } from "./use-style-editor";
import { InspectorSection, Segmented, SelectControl, LengthInput } from "./controls";
import { StyleRow, MiniField } from "./style-row";

const DISPLAY = [
  { value: "block", label: "Block" },
  { value: "flex", label: "Flex" },
  { value: "grid", label: "Grid" },
  { value: "inline", label: "Inline" },
  { value: "inline-block", label: "Inline block" },
  { value: "inline-flex", label: "Inline flex" },
  { value: "none", label: "None" },
];

const icon = (I: React.ComponentType<{ className?: string; strokeWidth?: number }>) => <I className="size-3.5" strokeWidth={1.5} />;

type FlexPreset = "shrink" | "fixed" | "grow";
const FLEX_PRESETS: Record<FlexPreset, string> = { shrink: "0 1 auto", fixed: "0 0 auto", grow: "1 1 0%" };

function trackCount(raw: string | undefined): string {
  if (!raw) return "";
  const repeat = raw.match(/^repeat\((\d+),/);
  if (repeat) return repeat[1];
  const parts = raw.trim() === "" || raw === "none" ? [] : raw.split(/\s+/);
  return parts.length ? String(parts.length) : "";
}

export function LayoutSection({ info }: { info: ElementInfo }) {
  const s = useStyleEditor(info);
  const display = s.value("display") ?? s.computed?.display ?? "block";
  const isFlex = display.includes("flex");
  const isGrid = display.includes("grid");
  const direction = s.value("flex-direction") ?? s.computed?.["flex-direction"] ?? "row";
  const wrap = (s.value("flex-wrap") ?? s.computed?.["flex-wrap"] ?? "nowrap") !== "nowrap";
  const columns = trackCount(s.value("grid-template-columns") ?? s.computed?.["grid-template-columns"]);
  const rows = trackCount(s.value("grid-template-rows") ?? s.computed?.["grid-template-rows"]);

  const parentDisplay = s.computed?.["__parent-display"] ?? "";
  const inFlex = parentDisplay.includes("flex");
  const inGrid = parentDisplay.includes("grid");

  const flexPreset: FlexPreset | null = (() => {
    const own = s.value("flex");
    if (own) return (Object.keys(FLEX_PRESETS) as FlexPreset[]).find((k) => FLEX_PRESETS[k] === own) ?? null;
    const grow = Number(s.computed?.["flex-grow"] ?? 0);
    const shrink = Number(s.computed?.["flex-shrink"] ?? 1);
    if (grow > 0) return "grow";
    if (shrink === 0) return "fixed";
    return "shrink";
  })();

  const span = (() => {
    const own = s.value("grid-column");
    const m = (own ?? s.computed?.["grid-column-end"] ?? "").match(/span\s+(\d+)/);
    return m ? m[1] : "1";
  })();

  return (
    <InspectorSection title="Layout">
      <StyleRow s={s} property="display" label="Display">
        <SelectControl ariaLabel="Display" value={s.value("display")} placeholder={display} options={DISPLAY} onChange={(v) => s.set("display", v)} />
      </StyleRow>
      {isFlex && (
        <>
          <StyleRow s={s} property="flex-direction" label="Direction">
            <Segmented
              ariaLabel="Flex direction"
              value={direction as "row" | "column" | "row-reverse" | "column-reverse"}
              options={[
                { value: "row", label: "Row", icon: icon(ArrowRight) },
                { value: "column", label: "Column", icon: icon(ArrowDown) },
              ]}
              onChange={(v) => s.set("flex-direction", v)}
            />
          </StyleRow>
          <StyleRow s={s} property="justify-content" label="Justify">
            <Segmented
              ariaLabel="Justify content"
              value={normalizeAlign(s.value("justify-content") ?? s.computed?.["justify-content"])}
              options={[
                { value: "flex-start", label: "Start", icon: icon(AlignHorizontalJustifyStart) },
                { value: "center", label: "Center", icon: icon(AlignHorizontalJustifyCenter) },
                { value: "flex-end", label: "End", icon: icon(AlignHorizontalJustifyEnd) },
                { value: "space-between", label: "Space between", icon: icon(AlignHorizontalSpaceBetween) },
                { value: "space-around", label: "Space around", icon: icon(AlignHorizontalSpaceAround) },
              ]}
              onChange={(v) => s.set("justify-content", v)}
            />
          </StyleRow>
          <StyleRow s={s} property="align-items" label="Align">
            <Segmented
              ariaLabel="Align items"
              value={normalizeAlign(s.value("align-items") ?? s.computed?.["align-items"])}
              options={[
                { value: "flex-start", label: "Start", icon: icon(AlignVerticalJustifyStart) },
                { value: "center", label: "Center", icon: icon(AlignVerticalJustifyCenter) },
                { value: "flex-end", label: "End", icon: icon(AlignVerticalJustifyEnd) },
                { value: "stretch", label: "Stretch", icon: icon(StretchVertical) },
              ]}
              onChange={(v) => s.set("align-items", v)}
            />
          </StyleRow>
          <StyleRow s={s} property="flex-wrap" label="Wrap">
            <Segmented
              ariaLabel="Flex wrap"
              value={wrap ? "wrap" : "nowrap"}
              options={[
                { value: "nowrap", label: "No wrap" },
                { value: "wrap", label: "Wrap" },
              ]}
              onChange={(v) => s.set("flex-wrap", v)}
            />
          </StyleRow>
          {wrap && (
            <StyleRow s={s} property="align-content" label="Lines">
              <Segmented
                ariaLabel="Align content"
                value={normalizeAlign(s.value("align-content") ?? s.computed?.["align-content"])}
                options={[
                  { value: "flex-start", label: "Start", icon: icon(AlignVerticalJustifyStart) },
                  { value: "center", label: "Center", icon: icon(AlignVerticalJustifyCenter) },
                  { value: "flex-end", label: "End", icon: icon(AlignVerticalJustifyEnd) },
                  { value: "space-between", label: "Space between", icon: icon(AlignHorizontalSpaceBetween) },
                  { value: "stretch", label: "Stretch", icon: icon(StretchVertical) },
                ]}
                onChange={(v) => s.set("align-content", v)}
              />
            </StyleRow>
          )}
        </>
      )}
      {isGrid && (
        <>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            <MiniField s={s} property="grid-template-columns" label="Columns">
              <LengthInput
                ariaLabel="Grid columns"
                value={s.value("grid-template-columns") ? columns : null}
                computed={columns}
                units={[""]}
                onCommit={(v) => s.set("grid-template-columns", v === null ? null : `repeat(${Math.max(1, Math.round(Number(v)))}, minmax(0, 1fr))`)}
              />
            </MiniField>
            <MiniField s={s} property="grid-template-rows" label="Rows">
              <LengthInput
                ariaLabel="Grid rows"
                value={s.value("grid-template-rows") ? rows : null}
                computed={rows || "auto"}
                units={[""]}
                keywords={["auto"]}
                onCommit={(v) => s.set("grid-template-rows", v === null || v === "auto" ? null : `repeat(${Math.max(1, Math.round(Number(v)))}, auto)`)}
              />
            </MiniField>
          </div>
          <StyleRow s={s} property="align-items" label="Align">
            <Segmented
              ariaLabel="Align items"
              value={normalizeAlign(s.value("align-items") ?? s.computed?.["align-items"])}
              options={[
                { value: "flex-start", label: "Start", icon: icon(AlignVerticalJustifyStart) },
                { value: "center", label: "Center", icon: icon(AlignVerticalJustifyCenter) },
                { value: "flex-end", label: "End", icon: icon(AlignVerticalJustifyEnd) },
                { value: "stretch", label: "Stretch", icon: icon(StretchVertical) },
              ]}
              onChange={(v) => s.set("align-items", v)}
            />
          </StyleRow>
        </>
      )}
      {(isFlex || isGrid) && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <MiniField s={s} property="column-gap" label="Column gap">
            <LengthInput
              ariaLabel="Column gap"
              value={s.value("column-gap") ?? s.value("gap")}
              computed={s.computed?.["column-gap"] === "normal" ? "0px" : s.computed?.["column-gap"]}
              units={["px", "rem", "%"]}
              onCommit={(v) => s.set("column-gap", v)}
            />
          </MiniField>
          <MiniField s={s} property="row-gap" label="Row gap">
            <LengthInput
              ariaLabel="Row gap"
              value={s.value("row-gap") ?? s.value("gap")}
              computed={s.computed?.["row-gap"] === "normal" ? "0px" : s.computed?.["row-gap"]}
              units={["px", "rem", "%"]}
              onCommit={(v) => s.set("row-gap", v)}
            />
          </MiniField>
        </div>
      )}

      {(inFlex || inGrid) && !info.isRoot && (
        <>
          <p className="pt-2 text-[10.5px] font-medium leading-4 text-fk-text-muted">{inFlex ? "Flex child" : "Grid child"}</p>
          {inFlex && (
            <StyleRow s={s} property="flex" label="Sizing">
              <Segmented
                ariaLabel="Flex sizing"
                value={flexPreset}
                options={[
                  { value: "shrink", label: "Shrink if needed" },
                  { value: "fixed", label: "Don't shrink" },
                  { value: "grow", label: "Grow" },
                ]}
                onChange={(v) => s.set("flex", FLEX_PRESETS[v])}
              />
            </StyleRow>
          )}
          {inGrid && (
            <StyleRow s={s} property="grid-column" label="Span">
              <LengthInput
                ariaLabel="Column span"
                value={s.value("grid-column") ? span : null}
                computed={span}
                units={[""]}
                onCommit={(v) => s.set("grid-column", v === null ? null : `span ${Math.max(1, Math.round(Number(v)))}`)}
              />
            </StyleRow>
          )}
          <StyleRow s={s} property="align-self" label="Align self">
            <Segmented
              ariaLabel="Align self"
              value={normalizeSelf(s.value("align-self") ?? s.computed?.["align-self"])}
              options={[
                { value: "auto", label: "Auto" },
                { value: "flex-start", label: "Start", icon: icon(AlignStartVertical) },
                { value: "center", label: "Center", icon: icon(AlignCenterVertical) },
                { value: "flex-end", label: "End", icon: icon(AlignEndVertical) },
                { value: "stretch", label: "Stretch", icon: icon(StretchVertical) },
              ]}
              onChange={(v) => s.set("align-self", v)}
            />
          </StyleRow>
          <StyleRow s={s} property="order" label="Order">
            <LengthInput ariaLabel="Order" value={s.value("order")} computed={s.computed?.order ?? "0"} units={[""]} allowNegative onCommit={(v) => s.set("order", v)} />
          </StyleRow>
        </>
      )}
    </InspectorSection>
  );
}

type Align = "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "stretch";

function normalizeAlign(value: string | undefined): Align | null {
  switch (value) {
    case "normal":
    case "start":
    case "flex-start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
    case "flex-end":
      return "flex-end";
    case "space-between":
      return "space-between";
    case "space-around":
    case "space-evenly":
      return "space-around";
    case "stretch":
      return "stretch";
    default:
      return null;
  }
}

function normalizeSelf(value: string | undefined): "auto" | "flex-start" | "center" | "flex-end" | "stretch" | null {
  if (!value || value === "auto" || value === "normal") return "auto";
  const n = normalizeAlign(value);
  return n === "space-between" || n === "space-around" ? null : n;
}
