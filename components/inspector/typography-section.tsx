"use client";

import { TextAlignStart, TextAlignCenter, TextAlignEnd, TextAlignJustify, Underline, Strikethrough, Minus, Italic } from "honestui/icons";
import type { ElementInfo } from "@/types/elements";
import { useStyleEditor } from "./use-style-editor";
import { InspectorSection, LengthInput, Segmented, SelectControl, ColorField, CommitInput } from "./controls";
import { StyleRow } from "./style-row";
import { toHex, primaryFontFamily } from "@/lib/client/style-utils";

const WEIGHT_NAMES: Record<string, string> = { "300": "Light", "400": "Regular", "500": "Medium", "600": "Semibold", "700": "Bold", "800": "Extrabold" };
const WEIGHTS = Object.keys(WEIGHT_NAMES).map((w) => ({ value: w, label: `${w} · ${WEIGHT_NAMES[w]}` }));
const BREAKING = [
  { value: "normal", label: "Normal" },
  { value: "nowrap", label: "No wrap" },
  { value: "pre-wrap", label: "Preserve spaces" },
  { value: "pre", label: "Preformatted" },
];
const LIST_STYLES = [
  { value: "none", label: "None" },
  { value: "disc", label: "Disc" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "decimal", label: "Numbers" },
  { value: "lower-alpha", label: "Letters" },
  { value: "upper-roman", label: "Roman" },
];
const NO_TEXT_TAGS = new Set(["img", "video", "hr", "br", "svg", "picture", "source", "iframe", "canvas"]);
const LIST_TAGS = new Set(["ul", "ol", "li"]);

const icon = (I: React.ComponentType<{ className?: string; strokeWidth?: number }>) => <I className="size-3.5" strokeWidth={1.5} />;

export function TypographySection({ info }: { info: ElementInfo }) {
  const s = useStyleEditor(info);
  if (NO_TEXT_TAGS.has(info.tag)) return null;

  const computedWeight = s.computed?.["font-weight"];
  const weight = s.value("font-weight") ?? (computedWeight === "normal" ? "400" : computedWeight === "bold" ? "700" : computedWeight) ?? null;
  const align = (s.value("text-align") ?? s.computed?.["text-align"] ?? "start").replace("start", "left").replace("end", "right");
  const decoration = s.value("text-decoration") ?? s.computed?.["text-decoration-line"] ?? "none";
  const style = s.value("font-style") ?? s.computed?.["font-style"] ?? "normal";
  const transform = s.value("text-transform") ?? s.computed?.["text-transform"] ?? "none";

  return (
    <InspectorSection title="Typography" defaultOpen={info.text.kind !== "none"}>
      <StyleRow s={s} property="font-family" label="Font" htmlFor="fk-font">
        <CommitInput id="fk-font" value={s.value("font-family") ?? ""} placeholder={primaryFontFamily(s.computed?.["font-family"]) || "Inherited"} onCommit={(v) => s.set("font-family", v.trim() === "" ? null : v)} />
      </StyleRow>
      <StyleRow s={s} property="font-weight" label="Weight">
        <SelectControl ariaLabel="Font weight" value={weight} placeholder={weight ? `${weight}${WEIGHT_NAMES[weight] ? ` · ${WEIGHT_NAMES[weight]}` : ""}` : "–"} options={WEIGHTS} onChange={(v) => s.set("font-weight", v)} />
      </StyleRow>
      <StyleRow s={s} property="font-size" label="Size">
        <LengthInput ariaLabel="Font size" value={s.value("font-size")} computed={s.computed?.["font-size"]} units={["px", "rem", "em", "vw"]} onCommit={(v) => s.set("font-size", v)} />
      </StyleRow>
      <StyleRow s={s} property="line-height" label="Line height">
        <LengthInput ariaLabel="Line height" value={s.value("line-height")} computed={s.computed?.["line-height"] === "normal" ? "" : s.computed?.["line-height"]} units={["px", "", "rem"]} keywords={["normal"]} onCommit={(v) => s.set("line-height", v)} />
      </StyleRow>
      <StyleRow s={s} property="letter-spacing" label="Letter spacing">
        <LengthInput ariaLabel="Letter spacing" value={s.value("letter-spacing")} computed={s.computed?.["letter-spacing"] === "normal" ? "0px" : s.computed?.["letter-spacing"]} units={["px", "em"]} allowNegative onCommit={(v) => s.set("letter-spacing", v)} />
      </StyleRow>
      <StyleRow s={s} property="text-align" label="Align">
        <Segmented
          ariaLabel="Text align"
          value={align as "left" | "center" | "right" | "justify"}
          options={[
            { value: "left", label: "Left", icon: icon(TextAlignStart) },
            { value: "center", label: "Center", icon: icon(TextAlignCenter) },
            { value: "right", label: "Right", icon: icon(TextAlignEnd) },
            { value: "justify", label: "Justify", icon: icon(TextAlignJustify) },
          ]}
          onChange={(v) => s.set("text-align", v)}
        />
      </StyleRow>
      <StyleRow s={s} property="font-style" label="Style">
        <Segmented
          ariaLabel="Font style"
          value={style === "italic" || style === "oblique" ? "italic" : "normal"}
          options={[
            { value: "normal", label: "Normal", icon: icon(Minus) },
            { value: "italic", label: "Italic", icon: icon(Italic) },
          ]}
          onChange={(v) => s.set("font-style", v)}
        />
      </StyleRow>
      <StyleRow s={s} property="text-decoration" label="Decoration">
        <Segmented
          ariaLabel="Text decoration"
          value={decoration.includes("underline") ? "underline" : decoration.includes("line-through") ? "line-through" : "none"}
          options={[
            { value: "none", label: "None", icon: icon(Minus) },
            { value: "underline", label: "Underline", icon: icon(Underline) },
            { value: "line-through", label: "Strikethrough", icon: icon(Strikethrough) },
          ]}
          onChange={(v) => s.set("text-decoration", v)}
        />
      </StyleRow>
      <StyleRow s={s} property="text-transform" label="Case">
        <Segmented
          ariaLabel="Text transform"
          value={transform as "none" | "uppercase" | "lowercase" | "capitalize"}
          options={[
            { value: "none", label: "None", icon: icon(Minus) },
            { value: "uppercase", label: "Uppercase", icon: <span className="text-[10px] tracking-wide">AA</span> },
            { value: "lowercase", label: "Lowercase", icon: <span className="text-[10px]">aa</span> },
            { value: "capitalize", label: "Capitalize", icon: <span className="text-[10px]">Aa</span> },
          ]}
          onChange={(v) => s.set("text-transform", v)}
        />
      </StyleRow>
      <StyleRow s={s} property="color" label="Color">
        <ColorField ariaLabel="Text color" value={s.value("color")} computed={toHex(s.computed?.color)} onCommit={(v) => s.set("color", v)} />
      </StyleRow>
      <StyleRow s={s} property="white-space" label="Breaking">
        <SelectControl ariaLabel="White space" value={s.value("white-space")} placeholder={s.computed?.["white-space"] ?? "normal"} options={BREAKING} onChange={(v) => s.set("white-space", v)} />
      </StyleRow>
      {LIST_TAGS.has(info.tag) && (
        <StyleRow s={s} property="list-style-type" label="List style">
          <SelectControl ariaLabel="List style" value={s.value("list-style-type")} placeholder={s.computed?.["list-style-type"] ?? "disc"} options={LIST_STYLES} onChange={(v) => s.set("list-style-type", v)} />
        </StyleRow>
      )}
    </InspectorSection>
  );
}
