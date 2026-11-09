"use client";

import type { ElementInfo } from "@/types/elements";
import { useStyleEditor } from "./use-style-editor";
import { InspectorSection, LengthInput, SelectControl } from "./controls";
import { StyleRow, MiniField } from "./style-row";

const POSITIONS = [
  { value: "static", label: "Static" },
  { value: "relative", label: "Relative" },
  { value: "absolute", label: "Absolute" },
  { value: "fixed", label: "Fixed" },
  { value: "sticky", label: "Sticky" },
];

const OFFSETS = [
  { property: "top", label: "Top" },
  { property: "right", label: "Right" },
  { property: "bottom", label: "Bottom" },
  { property: "left", label: "Left" },
];

const UNITS = ["px", "%", "rem", "vw", "vh"];

export function PositionSection({ info }: { info: ElementInfo }) {
  const s = useStyleEditor(info);
  const position = s.value("position") ?? s.computed?.position ?? "static";
  const positioned = position !== "static";

  return (
    <InspectorSection title="Position" defaultOpen={positioned}>
      <StyleRow s={s} property="position" label="Position">
        <SelectControl ariaLabel="Position" value={s.value("position")} placeholder={position} options={POSITIONS} onChange={(v) => s.set("position", v)} />
      </StyleRow>
      {positioned && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 pt-0.5">
          {OFFSETS.map((offset) => (
            <MiniField key={offset.property} s={s} property={offset.property} label={offset.label}>
              <LengthInput
                ariaLabel={`${offset.label} offset`}
                value={s.value(offset.property)}
                computed={s.computed?.[offset.property]}
                units={UNITS}
                keywords={["auto"]}
                allowNegative
                onCommit={(v) => s.set(offset.property, v)}
              />
            </MiniField>
          ))}
        </div>
      )}
      <StyleRow s={s} property="z-index" label="Z-index">
        <LengthInput ariaLabel="Z-index" value={s.value("z-index")} computed={s.computed?.["z-index"]} units={[""]} keywords={["auto"]} allowNegative onCommit={(v) => s.set("z-index", v)} />
      </StyleRow>
    </InspectorSection>
  );
}
