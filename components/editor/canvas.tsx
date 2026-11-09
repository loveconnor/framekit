"use client";

import * as React from "react";
import { useEditor, VIEWPORT_WIDTHS } from "@/store/editor-store";
import { bridge, type BridgeToEditor } from "@/lib/client/bridge";
import { labelForTag } from "@/lib/source/labels";
import { handleEditorKey } from "@/lib/client/shortcuts";
import { SelectionOverlay } from "./selection-overlay";
import { ImportProgress } from "./import-progress";
import { ElementContextMenu } from "./element-context-menu";
import { cn } from "@/lib/utils";

export function Canvas() {
  const phase = useEditor((s) => s.phase);
  const previewUrl = useEditor((s) => s.previewUrl);
  const activeRoute = useEditor((s) => s.activeRoute);
  const viewport = useEditor((s) => s.viewport);
  const mode = useEditor((s) => s.mode);
  const hovered = useEditor((s) => s.hovered);
  const selectedRect = useEditor((s) => s.selectedRect);
  const selectedId = useEditor((s) => s.selected?.id);
  const elements = useEditor((s) => s.elements);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = React.useState({ width: 0, height: 0 });
  const [stageWidth, setStageWidth] = React.useState(0);

  const ready = phase === "ready" && previewUrl;
  const src = ready ? `${previewUrl}${activeRoute}` : undefined;

  // The preview box always has a pixel width so viewport changes can animate.
  // Desktop fills the stage; tablet and mobile use fixed widths, clamped to the stage.
  const requested = VIEWPORT_WIDTHS[viewport];
  const boxWidth = stageWidth > 0 ? Math.min(requested ?? stageWidth, stageWidth) : null;
  const framed = requested !== null;

  // Measure the stage so desktop can be expressed in pixels.
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  // Keep the overlay the same size as the iframe.
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setFrameSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  // Bridge wiring.
  React.useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !previewUrl || !ready) return;
    bridge.attach(frame, previewUrl);
    const unsubscribe = bridge.subscribe((message) => handleBridgeMessage(message, boxRef.current));
    return () => {
      unsubscribe();
      bridge.detach();
    };
    // The iframe is keyed by route, so each page switch mounts a new frame: attach to that one, or
    // its messages are dropped and the editor waits for the page forever.
  }, [previewUrl, ready, activeRoute]);

  const hoverLabel = hovered ? labelForTag(elements[hovered.id]?.tag ?? hovered.tag ?? "div") : "";
  const selectedLabel = selectedId ? labelForTag(elements[selectedId]?.tag ?? "div") : "";
  const hoveredFromCanvas = hovered && (hovered.rect.width > 0 || hovered.rect.height > 0) ? hovered : null;

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-fk-canvas" aria-label="Canvas">
      {!ready ? (
        <ImportProgress />
      ) : (
        <div ref={stageRef} className="flex min-h-0 flex-1 justify-center overflow-hidden">
          <div
            ref={boxRef}
            className={cn(
              "relative h-full shrink-0 bg-white",
              // honestui's drawer curve, so the viewport change reads as one settled motion.
              boxWidth !== null && "transition-[width,box-shadow] duration-[var(--hui-duration-drawer)] ease-[var(--hui-ease-drawer)] motion-reduce:transition-none",
              framed && "shadow-[-1px_0_0_var(--fk-border-strong),1px_0_0_var(--fk-border-strong)]",
            )}
            style={{ width: boxWidth ?? "100%" }}
          >
            <iframe
              key={`${previewUrl}${activeRoute}`}
              ref={frameRef}
              src={src}
              title="Website preview"
              className="block h-full w-full border-0"
              allow="clipboard-write"
            />
            {mode === "edit" && (
              <SelectionOverlay
                frame={frameSize}
                hovered={hoveredFromCanvas ? { rect: hoveredFromCanvas.rect, label: hoverLabel } : null}
                selected={selectedRect ? { rect: selectedRect, label: selectedLabel } : null}
              />
            )}
          </div>
        </div>
      )}
      <ElementContextMenu />
    </section>
  );
}

function handleBridgeMessage(message: BridgeToEditor, box: HTMLDivElement | null) {
  const state = useEditor.getState();
  switch (message.type) {
    case "ready": {
      state.patch({ bridgeReady: true });
      bridge.send({ type: "mode", mode: state.mode });
      bridge.send({ type: "css", css: state.css });
      bridge.send({ type: "request-tree" });
      if (state.selected) bridge.send({ type: "select", id: state.selected.id, instance: state.selected.instance, scroll: false });
      break;
    }
    case "hover":
      state.setHovered(message.target ? { id: message.target.id, instance: message.target.instance, rect: message.target.rect, tag: message.target.tag } : null);
      break;
    case "select":
      if (message.target) {
        state.select({ id: message.target.id, instance: message.target.instance }, { fromCanvas: true });
        state.patch({ selectedRect: message.target.rect });
      } else state.select(null, { fromCanvas: true });
      break;
    case "dblclick":
      state.startInlineEdit({ id: message.id, instance: message.instance });
      break;
    case "contextmenu": {
      const rect = box?.getBoundingClientRect();
      state.select({ id: message.id, instance: message.instance }, { fromCanvas: true });
      state.patch({ selectedRect: message.rect, contextMenu: { x: (rect?.left ?? 0) + message.x, y: (rect?.top ?? 0) + message.y, id: message.id, instance: message.instance } });
      break;
    }
    case "tree":
      state.setTree(message.tree, message.path);
      break;
    case "rects": {
      const patch: Partial<typeof state> = { previewViewport: message.viewport };
      if (message.selected && state.selected && message.selected.id === state.selected.id) {
        patch.selectedRect = message.selected.rect;
        patch.selectedDisplay = message.selected.display;
      } else if (!message.selected) {
        patch.selectedRect = null;
      }
      if (state.hovered && message.hovered && message.hovered.id === state.hovered.id) {
        patch.hovered = { ...state.hovered, rect: message.hovered.rect };
      }
      state.patch(patch);
      break;
    }
    case "selection-lost":
      if (state.selected && !state.elements[state.selected.id]) state.select(null, { fromCanvas: true });
      else state.patch({ selectedRect: null });
      break;
    case "computed":
      if (state.selected && message.id === state.selected.id) state.patch({ computed: message.styles, computedSize: message.size, renderedLevels: message.texts ?? [], renderedPieces: message.pieces ?? [] });
      break;
    case "text-commit":
      state.patch({ inlineEditing: false });
      if (state.inlineSource?.id === message.id) {
        const { commit } = state.inlineSource;
        state.patch({ inlineSource: null });
        commit(message.value);
        break;
      }
      void state.runCommand({ type: "SET_TEXT", nodeId: message.id, value: message.value }, { groupKey: `text:${message.id}`, keepSelection: true });
      break;
    case "text-cancel":
      state.patch({ inlineEditing: false, inlineSource: null });
      break;
    case "navigate": {
      const path = message.path.split("?")[0];
      if (path === state.activeRoute) break;
      const match = state.routes.find((r) => r.pattern === path);
      state.patch({ previewPath: message.path, activeRoute: match ? match.pattern : path, selected: null, selectedRect: null, computed: null });
      break;
    }
    case "key":
      handleEditorKey({ key: message.key, meta: message.meta, shift: message.shift, inTextField: false });
      break;
    case "style-check":
      if (message.applied !== null) state.patch({ styleChecks: { ...state.styleChecks, [message.property]: message.applied } });
      break;
  }
}
