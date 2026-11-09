"use client";

import * as React from "react";
import { useEditor } from "@/store/editor-store";
import { labelForTag } from "@/lib/source/labels";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";

export function StatusBar() {
  const phase = useEditor((s) => s.phase);
  const isSaving = useEditor((s) => s.isSaving);
  const isDirty = useEditor((s) => s.isDirty);
  const dirtyFiles = useEditor((s) => s.dirtyFiles);
  const compileError = useEditor((s) => s.compileError);
  const devLog = useEditor((s) => s.devLog);
  const previewViewport = useEditor((s) => s.previewViewport);
  const breadcrumb = useBreadcrumb();

  let status: React.ReactNode = "Ready";
  let tone: "ok" | "busy" | "error" = "ok";
  if (phase !== "ready") {
    status = useEditor.getState().phaseMessage ?? "Loading";
    tone = phase === "error" ? "error" : "busy";
  } else if (isSaving) {
    status = "Saving...";
    tone = "busy";
  } else if (compileError) {
    status = "The preview has a compile error";
    tone = "error";
  }

  return (
    <footer className="flex h-[var(--fk-statusbar-height)] shrink-0 items-center justify-between border-t border-fk-border bg-fk-panel px-3 text-[11px] leading-4 text-fk-text-muted">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            tone === "ok" && "bg-fk-success",
            tone === "busy" && "bg-fk-text-faint",
            tone === "error" && "bg-fk-error",
          )}
        />
        {tone === "error" && compileError ? (
          <Popover>
            <PopoverTrigger className="truncate text-fk-text-secondary hover:text-fk-text">{status}</PopoverTrigger>
            <PopoverPopup side="top" align="start" className="w-[560px] max-w-[90vw] p-0">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-4 text-fk-text-secondary">{stripAnsi(devLog) || compileError}</pre>
            </PopoverPopup>
          </Popover>
        ) : (
          <span className="truncate">{status}</span>
        )}
      </div>
      <div className="hidden min-w-0 flex-1 justify-center truncate px-4 text-fk-text-muted md:flex">{breadcrumb}</div>
      <div className="flex shrink-0 items-center gap-4">
        {previewViewport && (
          <span className="fk-num font-mono text-fk-text-faint">
            {previewViewport.width} × {previewViewport.height}
          </span>
        )}
        <span className={cn(isDirty && "text-fk-text-secondary")}>
          {isDirty ? `${dirtyFiles.length} unsaved ${dirtyFiles.length === 1 ? "file" : "files"}` : "No unsaved changes"}
        </span>
      </div>
    </footer>
  );
}

function useBreadcrumb(): string {
  const selected = useEditor((s) => s.selected);
  const tree = useEditor((s) => s.tree);
  const elements = useEditor((s) => s.elements);
  return React.useMemo(() => {
    if (!selected || !tree) return "";
    const path: string[] = [];
    const visit = (node: typeof tree): boolean => {
      const info = elements[node.id];
      path.push(info ? labelForTag(info.tag) : labelForTag(node.tag));
      if (node.id === selected.id && node.instance === selected.instance) return true;
      for (const child of node.children) if (visit(child)) return true;
      path.pop();
      return false;
    };
    return visit(tree) ? path.join(" › ") : "";
  }, [selected, tree, elements]);
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}
