"use client";

import { Lock, Repeat, Component } from "honestui/icons";
import { useEditor } from "@/store/editor-store";
import { labelForTag } from "@/lib/source/labels";
import { displayFile } from "@/lib/client/style-utils";
import { ContentSection } from "./content-section";
import { LayoutSection } from "./layout-section";
import { SpacingSection } from "./spacing-section";
import { SizeSection } from "./size-section";
import { PositionSection } from "./position-section";
import { TypographySection } from "./typography-section";
import { BackgroundsSection } from "./backgrounds-section";
import { BordersSection } from "./borders-section";
import { EffectsSection } from "./effects-section";
import { Tooltip, TooltipTrigger, TooltipPopup } from "@/components/ui/tooltip";

export function Inspector() {
  const selected = useEditor((s) => s.selected);
  const info = useEditor((s) => (s.selected ? s.elements[s.selected.id] : undefined));
  const mode = useEditor((s) => s.mode);
  const viewport = useEditor((s) => s.viewport);

  return (
    <aside className="flex w-[var(--fk-inspector-width)] shrink-0 flex-col border-l border-fk-border bg-fk-panel" aria-label="Inspector">
      {!selected || mode === "preview" ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-[12px] leading-4 text-fk-text-muted">{mode === "preview" ? "Switch back to Edit to change properties." : "Select an element to edit its properties."}</p>
        </div>
      ) : !info ? (
        <div className="p-4">
          <p className="text-[13px] font-medium text-fk-text">Unknown element</p>
          <p className="mt-1 text-[12px] leading-4 text-fk-text-secondary">Framekit couldn&apos;t identify the source for this element. It may come from a dependency or from code outside this project.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto fk-scroll">
          <header className="border-b border-fk-border px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-[12px] font-medium leading-4 text-fk-text">{labelForTag(info.tag)}</h2>
                <p className="mt-0.5 truncate font-mono text-[10.5px] leading-4 text-fk-text-muted">
                  {info.tag} · {displayFile(info.file)}:{info.line}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-fk-text-muted">
                {info.shared && (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Component className="size-3.5" strokeWidth={1.5} />
                    </TooltipTrigger>
                    <TooltipPopup>Shared source. Changes affect every place this renders.</TooltipPopup>
                  </Tooltip>
                )}
                {info.repeated && (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Repeat className="size-3.5" strokeWidth={1.5} />
                    </TooltipTrigger>
                    <TooltipPopup>Rendered from a list. Styles apply to every item.</TooltipPopup>
                  </Tooltip>
                )}
                {info.text.kind === "readonly" && !info.ops.delete.allowed && (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Lock className="size-3.5" strokeWidth={1.5} />
                    </TooltipTrigger>
                    <TooltipPopup>Content and structure are controlled by code. Styles can still change.</TooltipPopup>
                  </Tooltip>
                )}
              </div>
            </div>
            {info.shared && <p className="mt-2 rounded-[4px] bg-fk-raised px-2 py-1.5 text-[11px] leading-4 text-fk-text-secondary">Shared source. Changes affect every place this renders.</p>}
            {viewport !== "desktop" && (
              <p className="mt-2 text-[11px] leading-4 text-fk-text-muted">
                Editing the <span className="text-fk-text">{viewport}</span> override. Desktop styles stay as they are.
              </p>
            )}
          </header>
          <ContentSection info={info} />
          <LayoutSection info={info} />
          <SpacingSection info={info} />
          <SizeSection info={info} />
          <PositionSection info={info} />
          <TypographySection info={info} />
          <BackgroundsSection info={info} />
          <BordersSection info={info} />
          <EffectsSection info={info} />
          <div className="h-6" />
        </div>
      )}
    </aside>
  );
}
