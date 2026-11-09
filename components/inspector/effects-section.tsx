"use client";

import { Plus, X } from "honestui/icons";
import type { ElementInfo } from "@/types/elements";
import { useStyleEditor } from "./use-style-editor";
import { InspectorSection, LengthInput, SelectControl, ColorField, Segmented } from "./controls";
import { StyleRow, MiniField, InlineAction } from "./style-row";
import { parseShadow, formatShadow, parseTransform, formatTransform, parseTransition, formatTransition, type Shadow, type Transform } from "@/lib/client/style-utils";

const CURSORS = ["auto", "default", "pointer", "text", "move", "grab", "not-allowed", "zoom-in"].map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1).replace("-", " ") }));
const BLENDS = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "luminosity"].map((b) => ({ value: b, label: b.charAt(0).toUpperCase() + b.slice(1) }));
const EASINGS = [
  { value: "ease", label: "Ease" },
  { value: "linear", label: "Linear" },
  { value: "ease-in", label: "Ease in" },
  { value: "ease-out", label: "Ease out" },
  { value: "ease-in-out", label: "Ease in out" },
  { value: "cubic-bezier(0.22, 1, 0.36, 1)", label: "Settle" },
];
const DEFAULT_SHADOW: Shadow = { inset: false, x: "0px", y: "1px", blur: "3px", spread: "0px", color: "rgba(0,0,0,0.12)" };
const IDENTITY: Transform = { x: "0px", y: "0px", scale: "1", rotate: "0deg" };

function blurOf(filter: string | null | undefined): string | null {
  const m = filter?.match(/blur\(\s*([^)]+)\)/);
  return m ? m[1].trim() : null;
}

export function EffectsSection({ info }: { info: ElementInfo }) {
  const s = useStyleEditor(info);

  const opacityValue = s.value("opacity");
  const computedOpacity = s.computed?.opacity ?? "1";

  const ownShadow = s.value("box-shadow");
  const shadow = parseShadow(ownShadow ?? s.computed?.["box-shadow"]);
  const shadowFromCode = ownShadow === null && shadow !== null;
  const setShadow = (patch: Partial<Shadow>) => s.set("box-shadow", formatShadow({ ...(shadow ?? DEFAULT_SHADOW), ...patch }));

  const ownTransform = s.value("transform");
  const transform = parseTransform(ownTransform) ?? IDENTITY;
  const setTransform = (patch: Partial<Transform>) => s.set("transform", formatTransform({ ...transform, ...patch }));

  const ownTransition = s.value("transition");
  const transition = parseTransition(ownTransition) ?? parseTransition(`${s.computed?.["transition-duration"] ?? ""} ${s.computed?.["transition-timing-function"] ?? ""}`);
  const activeTransition = transition && transition.duration !== "0s" && transition.duration !== "0ms" ? transition : null;

  return (
    <InspectorSection title="Effects" defaultOpen={false}>
      <StyleRow s={s} property="opacity" label="Opacity">
        <LengthInput
          ariaLabel="Opacity"
          value={opacityValue === null ? null : `${Math.round(Number(opacityValue) * 100)}%`}
          computed={`${Math.round(Number(computedOpacity) * 100)}%`}
          units={["%"]}
          onCommit={(v) => {
            if (v === null) return s.set("opacity", null);
            const n = Math.max(0, Math.min(100, Number(v.replace("%", ""))));
            s.set("opacity", String(Math.round(n) / 100));
          }}
        />
      </StyleRow>

      <StyleRow s={s} property="box-shadow" label="Shadow">
        {shadow ? (
          <div className="flex items-center gap-1.5">
            <Segmented
              ariaLabel="Shadow placement"
              value={shadow.inset ? "inset" : "outside"}
              options={[
                { value: "outside", label: "Outside" },
                { value: "inset", label: "Inside" },
              ]}
              onChange={(v) => setShadow({ inset: v === "inset" })}
            />
            <button type="button" aria-label="Remove shadow" onClick={() => s.set("box-shadow", shadowFromCode ? "none" : null)} className="flex size-6 shrink-0 items-center justify-center rounded-[4px] text-fk-text-muted hover:bg-fk-raised hover:text-fk-text">
              <X className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
        ) : (
          <InlineAction onClick={() => setShadow({})} icon={<Plus className="size-3" strokeWidth={1.5} />}>
            Add shadow
          </InlineAction>
        )}
      </StyleRow>
      {shadow && (
        <>
          <div className="grid grid-cols-4 gap-x-1.5 gap-y-1.5">
            {(["x", "y", "blur", "spread"] as const).map((key) => (
              <MiniField key={key} s={s} property="box-shadow" label={{ x: "X", y: "Y", blur: "Blur", spread: "Spread" }[key]}>
                <LengthInput ariaLabel={`Shadow ${key}`} value={shadow[key]} units={["px"]} allowNegative={key !== "blur"} onCommit={(v) => setShadow({ [key]: v ?? "0px" })} />
              </MiniField>
            ))}
          </div>
          <StyleRow s={s} property="box-shadow" label="Color">
            <ColorField ariaLabel="Shadow color" value={shadow.color} onCommit={(v) => v && setShadow({ color: v })} />
          </StyleRow>
        </>
      )}

      <p className="pt-2 text-[10.5px] font-medium leading-4 text-fk-text-muted">Transform</p>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <MiniField s={s} property="transform" label="Move X">
          <LengthInput ariaLabel="Move X" value={ownTransform ? transform.x : null} computed="0px" units={["px", "%"]} allowNegative onCommit={(v) => setTransform({ x: v ?? "0px" })} />
        </MiniField>
        <MiniField s={s} property="transform" label="Move Y">
          <LengthInput ariaLabel="Move Y" value={ownTransform ? transform.y : null} computed="0px" units={["px", "%"]} allowNegative onCommit={(v) => setTransform({ y: v ?? "0px" })} />
        </MiniField>
        <MiniField s={s} property="transform" label="Scale">
          <LengthInput ariaLabel="Scale" value={ownTransform ? transform.scale : null} computed="1" units={[""]} onCommit={(v) => setTransform({ scale: v ?? "1" })} />
        </MiniField>
        <MiniField s={s} property="transform" label="Rotate">
          <LengthInput ariaLabel="Rotate" value={ownTransform ? transform.rotate : null} computed="0deg" units={["deg"]} allowNegative onCommit={(v) => setTransform({ rotate: v ?? "0deg" })} />
        </MiniField>
      </div>

      <p className="pt-2 text-[10.5px] font-medium leading-4 text-fk-text-muted">Motion and filters</p>
      <StyleRow s={s} property="transition" label="Transition">
        <LengthInput
          ariaLabel="Transition duration"
          value={ownTransition && activeTransition ? activeTransition.duration : null}
          computed={activeTransition?.duration ?? "0ms"}
          units={["ms", "s"]}
          onCommit={(v) => s.set("transition", v === null ? null : formatTransition({ duration: v, easing: activeTransition?.easing ?? "ease" }))}
        />
      </StyleRow>
      {activeTransition && (
        <StyleRow s={s} property="transition" label="Easing">
          <SelectControl
            ariaLabel="Transition easing"
            value={ownTransition ? activeTransition.easing : null}
            placeholder={EASINGS.find((e) => e.value === activeTransition.easing)?.label ?? activeTransition.easing}
            options={EASINGS}
            onChange={(v) => s.set("transition", formatTransition({ duration: activeTransition.duration, easing: v }))}
          />
        </StyleRow>
      )}
      <StyleRow s={s} property="filter" label="Blur">
        <LengthInput ariaLabel="Blur" value={blurOf(s.value("filter"))} computed={blurOf(s.computed?.filter) ?? "0px"} units={["px"]} onCommit={(v) => s.set("filter", v === null || /^0(px)?$/.test(v) ? null : `blur(${v})`)} />
      </StyleRow>
      <StyleRow s={s} property="backdrop-filter" label="Backdrop blur">
        <LengthInput ariaLabel="Backdrop blur" value={blurOf(s.value("backdrop-filter"))} computed={blurOf(s.computed?.["backdrop-filter"]) ?? "0px"} units={["px"]} onCommit={(v) => s.set("backdrop-filter", v === null || /^0(px)?$/.test(v) ? null : `blur(${v})`)} />
      </StyleRow>
      <StyleRow s={s} property="mix-blend-mode" label="Blend">
        <SelectControl ariaLabel="Blend mode" value={s.value("mix-blend-mode")} placeholder={s.computed?.["mix-blend-mode"] ?? "normal"} options={BLENDS} onChange={(v) => s.set("mix-blend-mode", v)} />
      </StyleRow>
      <StyleRow s={s} property="cursor" label="Cursor">
        <SelectControl ariaLabel="Cursor" value={s.value("cursor")} placeholder={s.computed?.cursor ?? "auto"} options={CURSORS} onChange={(v) => s.set("cursor", v)} />
      </StyleRow>
    </InspectorSection>
  );
}
