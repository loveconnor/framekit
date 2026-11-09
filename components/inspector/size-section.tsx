"use client";

import { Eye, EyeOff, Scan, Move } from "honestui/icons";
import type { ElementInfo } from "@/types/elements";
import { useStyleEditor } from "./use-style-editor";
import { InspectorSection, LengthInput, Segmented, SelectControl, CommitInput } from "./controls";
import { StyleRow, MiniField } from "./style-row";

const UNITS = ["px", "rem", "%", "vw", "vh"];
const MEDIA_TAGS = new Set(["img", "video", "picture", "iframe"]);

const FIT = [
  { value: "fill", label: "Fill" },
  { value: "contain", label: "Contain" },
  { value: "cover", label: "Cover" },
  { value: "none", label: "None" },
  { value: "scale-down", label: "Scale down" },
];

const icon = (I: React.ComponentType<{ className?: string; strokeWidth?: number }>) => <I className="size-3.5" strokeWidth={1.5} />;

export function SizeSection({ info }: { info: ElementInfo }) {
  const s = useStyleEditor(info);
  const fields: Array<{ property: string; label: string; keywords: string[] }> = [
    { property: "width", label: "Width", keywords: ["auto", "fit-content", "max-content"] },
    { property: "height", label: "Height", keywords: ["auto", "fit-content"] },
    { property: "min-width", label: "Min W", keywords: ["auto"] },
    { property: "min-height", label: "Min H", keywords: ["auto"] },
    { property: "max-width", label: "Max W", keywords: ["none"] },
    { property: "max-height", label: "Max H", keywords: ["none"] },
  ];
  const overflow = s.value("overflow") ?? s.computed?.["overflow-x"] ?? "visible";
  const isMedia = MEDIA_TAGS.has(info.tag);

  return (
    <InspectorSection title="Size" defaultOpen={false}>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        {fields.map((field) => (
          <MiniField key={field.property} s={s} property={field.property} label={field.label}>
            <LengthInput
              ariaLabel={field.label.replace(" W", " width").replace(" H", " height")}
              value={s.value(field.property)}
              computed={s.computed?.[field.property]}
              units={UNITS}
              keywords={field.keywords}
              onCommit={(v) => s.set(field.property, v)}
            />
          </MiniField>
        ))}
      </div>
      <div className="pt-1" />
      <StyleRow s={s} property="overflow" label="Overflow">
        <Segmented
          ariaLabel="Overflow"
          value={overflow as "visible" | "hidden" | "scroll" | "auto"}
          options={[
            { value: "visible", label: "Visible", icon: icon(Eye) },
            { value: "hidden", label: "Hidden", icon: icon(EyeOff) },
            { value: "scroll", label: "Scroll", icon: icon(Move) },
            { value: "auto", label: "Auto", icon: icon(Scan) },
          ]}
          onChange={(v) => s.set("overflow", v)}
        />
      </StyleRow>
      {isMedia && (
        <StyleRow s={s} property="object-fit" label="Fit">
          <SelectControl ariaLabel="Object fit" value={s.value("object-fit")} placeholder={s.computed?.["object-fit"] ?? "fill"} options={FIT} onChange={(v) => s.set("object-fit", v)} />
        </StyleRow>
      )}
      <StyleRow s={s} property="aspect-ratio" label="Ratio" htmlFor="fk-ratio">
        <CommitInput
          id="fk-ratio"
          mono
          value={s.value("aspect-ratio") ?? ""}
          placeholder={s.computed?.["aspect-ratio"] && s.computed["aspect-ratio"] !== "auto" ? s.computed["aspect-ratio"] : "auto · e.g. 16 / 9"}
          onCommit={(v) => {
            const trimmed = v.trim();
            if (trimmed === "" || trimmed === "auto") return s.set("aspect-ratio", null);
            if (/^\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?$/.test(trimmed)) s.set("aspect-ratio", trimmed.replace(/\s*\/\s*/, " / "));
          }}
        />
      </StyleRow>
    </InspectorSection>
  );
}
