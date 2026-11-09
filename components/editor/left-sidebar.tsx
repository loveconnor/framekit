"use client";

import { useEditor } from "@/store/editor-store";
import { LayersPanel } from "./layers-panel";
import { AddPanel } from "./add-panel";
import { cn } from "@/lib/utils";

export function LeftSidebar() {
  const leftPanel = useEditor((s) => s.leftPanel);
  const setLeftPanel = useEditor((s) => s.setLeftPanel);
  return (
    <aside className="flex w-[var(--fk-sidebar-width)] shrink-0 flex-col border-r border-fk-border bg-fk-panel" aria-label="Sidebar">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-fk-border px-2" role="tablist" aria-label="Sidebar view">
        {(["layers", "add"] as const).map((panel) => (
          <button
            key={panel}
            type="button"
            role="tab"
            aria-selected={leftPanel === panel}
            onClick={() => setLeftPanel(panel)}
            className={cn(
              "h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors",
              leftPanel === panel ? "bg-fk-raised text-fk-text" : "text-fk-text-muted hover:bg-fk-hover hover:text-fk-text",
            )}
          >
            {panel === "layers" ? "Layers" : "Add"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{leftPanel === "layers" ? <LayersPanel /> : <AddPanel />}</div>
    </aside>
  );
}
