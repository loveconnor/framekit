"use client";

import * as React from "react";
import { X } from "honestui/icons";
import type { ElementInfo } from "@/types/elements";
import { useEditor } from "@/store/editor-store";
import { useStyleEditor } from "./use-style-editor";
import { InspectorSection, LengthInput, Segmented, SelectControl, ColorField, Notice } from "./controls";
import { StyleRow } from "./style-row";
import { AssetPicker } from "./asset-picker";
import { toHex, parseGradient, formatGradient, parseImageUrl } from "@/lib/client/style-utils";

const SIZES = [
  { value: "cover", label: "Cover" },
  { value: "contain", label: "Contain" },
  { value: "auto", label: "Auto" },
  { value: "100% 100%", label: "Stretch" },
];
const POSITIONS = ["center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"].map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
const REPEATS = [
  { value: "no-repeat", label: "No repeat" },
  { value: "repeat", label: "Repeat" },
  { value: "repeat-x", label: "Repeat horizontally" },
  { value: "repeat-y", label: "Repeat vertically" },
];
const DEFAULT_GRADIENT = "linear-gradient(180deg, #f5f5f5, #e5e5e5)";
const IMAGE_PROPS = ["background-image", "background-size", "background-position", "background-repeat"];

type Kind = "none" | "image" | "gradient";

export function BackgroundsSection({ info }: { info: ElementInfo }) {
  const s = useStyleEditor(info);
  const previewUrl = useEditor((st) => st.previewUrl);
  const own = s.value("background-image");
  const computedImage = s.computed?.["background-image"];
  const current = own ?? (computedImage && computedImage !== "none" ? computedImage : null);
  const imagePath = parseImageUrl(current);
  const gradient = parseGradient(current);
  const fromCode = own === null && current !== null;
  const unparsed = current !== null && !imagePath && !gradient;

  // "Image" can be chosen before a file is picked; remember that choice per element.
  const [pendingImage, setPendingImage] = React.useState<string | null>(null);
  const wantsImage = pendingImage === info.id && !current;
  const kind: Kind = imagePath || wantsImage ? "image" : gradient ? "gradient" : "none";

  const setKind = (next: Kind) => {
    setPendingImage(next === "image" ? info.id : null);
    if (next === "none") return s.set("background-image", fromCode ? "none" : null);
    if (next === "gradient" && !gradient) return s.set("background-image", DEFAULT_GRADIENT);
  };

  return (
    <InspectorSection title="Backgrounds" defaultOpen={false}>
      <StyleRow s={s} property="background-color" label="Color">
        <ColorField ariaLabel="Background color" value={s.value("background-color")} computed={toHex(s.computed?.["background-color"])} onCommit={(v) => s.set("background-color", v)} />
      </StyleRow>
      <StyleRow s={s} property="background-image" label="Type" resets={IMAGE_PROPS}>
        <Segmented<Kind>
          ariaLabel="Background type"
          value={unparsed ? null : kind}
          options={[
            { value: "none", label: "None" },
            { value: "image", label: "Image" },
            { value: "gradient", label: "Gradient" },
          ]}
          onChange={setKind}
        />
      </StyleRow>
      {unparsed && (
        <Notice>
          Background set in existing CSS: <span className="font-mono">{current!.length > 44 ? current!.slice(0, 43) + "…" : current}</span>
        </Notice>
      )}
      {kind === "image" && (
        <>
          <StyleRow s={s} property="background-image" label="Image" resets={IMAGE_PROPS}>
            <div className="flex min-w-0 items-center gap-1.5">
              <AssetPicker
                previewUrl={previewUrl}
                label={imagePath ? (imagePath.split("/").pop() ?? imagePath) : "Choose image"}
                className="min-w-0 flex-1 justify-start truncate"
                onPick={(path) => s.set("background-image", `url("${path}")`)}
              />
              {imagePath && (
                <button type="button" aria-label="Remove background image" onClick={() => setKind("none")} className="flex size-6 shrink-0 items-center justify-center rounded-[4px] text-fk-text-muted hover:bg-fk-raised hover:text-fk-text">
                  <X className="size-3.5" strokeWidth={1.5} />
                </button>
              )}
            </div>
          </StyleRow>
          {imagePath && (
            <>
              <StyleRow s={s} property="background-size" label="Size">
                <SelectControl ariaLabel="Background size" value={s.value("background-size")} placeholder={s.computed?.["background-size"] ?? "auto"} options={SIZES} onChange={(v) => s.set("background-size", v)} />
              </StyleRow>
              <StyleRow s={s} property="background-position" label="Position">
                <SelectControl ariaLabel="Background position" value={s.value("background-position")} placeholder={describePosition(s.computed?.["background-position"])} options={POSITIONS} onChange={(v) => s.set("background-position", v)} />
              </StyleRow>
              <StyleRow s={s} property="background-repeat" label="Repeat">
                <SelectControl ariaLabel="Background repeat" value={s.value("background-repeat")} placeholder={s.computed?.["background-repeat"] ?? "repeat"} options={REPEATS} onChange={(v) => s.set("background-repeat", v)} />
              </StyleRow>
            </>
          )}
        </>
      )}
      {kind === "gradient" && gradient && (
        <>
          <StyleRow s={s} property="background-image" label="Angle">
            <LengthInput
              ariaLabel="Gradient angle"
              value={own ? `${gradient.angle}deg` : null}
              computed={`${gradient.angle}deg`}
              units={["deg"]}
              allowNegative
              onCommit={(v) => s.set("background-image", formatGradient({ ...gradient, angle: v === null ? 180 : Number(v.replace("deg", "")) }))}
            />
          </StyleRow>
          <StyleRow s={s} property="background-image" label="From">
            <ColorField ariaLabel="Gradient start color" value={own ? gradient.from : null} computed={gradient.from} onCommit={(v) => v && s.set("background-image", formatGradient({ ...gradient, from: v }))} />
          </StyleRow>
          <StyleRow s={s} property="background-image" label="To">
            <ColorField ariaLabel="Gradient end color" value={own ? gradient.to : null} computed={gradient.to} onCommit={(v) => v && s.set("background-image", formatGradient({ ...gradient, to: v }))} />
          </StyleRow>
          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
            <span />
            <div className="h-6 rounded-[4px] border border-fk-border" style={{ backgroundImage: formatGradient(gradient) }} aria-hidden="true" />
          </div>
        </>
      )}
    </InspectorSection>
  );
}

function describePosition(computed: string | undefined): string {
  if (!computed) return "center";
  const map: Record<string, string> = { "50% 50%": "center", "50% 0%": "top", "50% 100%": "bottom", "0% 50%": "left", "100% 50%": "right", "0% 0%": "top left", "100% 0%": "top right", "0% 100%": "bottom left", "100% 100%": "bottom right" };
  return map[computed] ?? computed;
}
