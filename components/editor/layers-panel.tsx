"use client";

import * as React from "react";
import { ChevronRight, Lock, Repeat } from "honestui/icons";
import { useEditor, nodeKey, sourceSiblings } from "@/store/editor-store";
import type { TreeNode } from "@/lib/client/bridge";
import { bridge } from "@/lib/client/bridge";
import { labelForTag } from "@/lib/source/labels";
import type { ElementInfo } from "@/types/elements";
import { Tooltip, TooltipTrigger, TooltipPopup } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

type DropTarget = { key: string; position: "before" | "after" } | null;

export function LayersPanel() {
  const tree = useEditor((s) => s.tree);
  const phase = useEditor((s) => s.phase);
  const routes = useEditor((s) => s.routes);
  const activeRoute = useEditor((s) => s.activeRoute);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<DropTarget>(null);
  const pageName = routes.find((r) => r.pattern === activeRoute)?.name ?? activeRoute;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center px-3 text-[11px] text-fk-text-muted">
        <span className="truncate">Page: {pageName}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto fk-scroll pb-6" role="tree" aria-label="Layers" onDragLeave={() => setDropTarget(null)}>
        {!tree && <p className="px-3 py-2 text-xs leading-4 text-fk-text-muted">{phase === "ready" ? "Waiting for the page…" : "The layer tree appears once the preview loads."}</p>}
        {tree && (
          <LayerRow node={tree} depth={0} dragging={dragging} setDragging={setDragging} dropTarget={dropTarget} setDropTarget={setDropTarget} />
        )}
      </div>
    </div>
  );
}

type RowProps = {
  node: TreeNode;
  depth: number;
  dragging: string | null;
  setDragging: (id: string | null) => void;
  dropTarget: DropTarget;
  setDropTarget: (t: DropTarget) => void;
};

function LayerRow({ node, depth, dragging, setDragging, dropTarget, setDropTarget }: RowProps) {
  const key = nodeKey(node);
  const info = useEditor((s) => s.elements[node.id]);
  const isSelected = useEditor((s) => s.selected?.id === node.id && s.selected.instance === node.instance);
  const isHovered = useEditor((s) => s.hovered?.id === node.id && s.hovered.instance === node.instance);
  const expanded = useEditor((s) => s.expanded[key] ?? false);
  const setExpanded = useEditor((s) => s.setExpanded);
  const select = useEditor((s) => s.select);
  const setHovered = useEditor((s) => s.setHovered);
  const setContextMenu = useEditor((s) => s.setContextMenu);
  const startInlineEdit = useEditor((s) => s.startInlineEdit);
  const runCommand = useEditor((s) => s.runCommand);
  const rowRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  const hasChildren = node.children.length > 0;
  const label = info ? labelForTag(info.tag) : node.id === "__body" ? "Body" : labelForTag(node.tag);
  const locked = !info;
  const canDrag = Boolean(info?.ops.move.allowed);

  const onDragOver = (e: React.DragEvent) => {
    if (!dragging || dragging === node.id || !info) return;
    const elements = useEditor.getState().elements;
    const source = elements[dragging];
    if (!source || source.file !== info.file || !info.parentId) return;
    if (isDescendant(elements, info, dragging)) return;
    const parent = elements[info.parentId];
    if (!parent || parent.repeated) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    if (dropTarget?.key !== key || dropTarget.position !== position) setDropTarget({ key, position });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const target = dropTarget;
    setDropTarget(null);
    if (!dragging || !target || !info || !info.parentId) return;
    const elements = useEditor.getState().elements;
    const siblings = sourceSiblings(elements, info.parentId).filter((s) => s.id !== dragging);
    const index = siblings.findIndex((s) => s.id === info.id);
    if (index < 0) return;
    const position = target.position === "before" ? index : index + 1;
    const source = elements[dragging];
    const run = () => void runCommand({ type: "MOVE_NODE", nodeId: dragging, targetParentId: info.parentId!, position });
    if (source?.shared) {
      useEditor.getState().setConfirm({
        title: "Move inside a shared component?",
        description: "This change will affect every instance of this component.",
        action: "Move",
        onConfirm: run,
      });
    } else run();
    setDragging(null);
  };

  return (
    <div role="none">
      <div
        ref={rowRef}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={depth + 1}
        tabIndex={isSelected ? 0 : -1}
        draggable={canDrag}
        onDragStart={(e) => {
          if (!canDrag) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
          setDragging(node.id);
        }}
        onDragEnd={() => {
          setDragging(null);
          setDropTarget(null);
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => select({ id: node.id, instance: node.instance }, { scroll: true })}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (info?.text.kind === "editable") startInlineEdit({ id: node.id, instance: node.instance });
          else if (hasChildren) setExpanded(key, !expanded);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          select({ id: node.id, instance: node.instance }, { scroll: false });
          setContextMenu({ x: e.clientX, y: e.clientY, id: node.id, instance: node.instance });
        }}
        onMouseEnter={() => {
          setHovered({ id: node.id, instance: node.instance, rect: { x: 0, y: 0, width: 0, height: 0 } });
          bridge.send({ type: "hover", id: node.id, instance: node.instance });
        }}
        onMouseLeave={() => {
          setHovered(null);
          bridge.send({ type: "hover", id: null });
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && hasChildren && !expanded) setExpanded(key, true);
          if (e.key === "ArrowLeft" && expanded) setExpanded(key, false);
        }}
        className={cn(
          "group relative flex h-7 w-full cursor-default select-none items-center gap-1 pr-2 text-[12px] leading-4 outline-none",
          isSelected ? "bg-fk-selected text-fk-text" : isHovered ? "bg-fk-hover text-fk-text" : "text-fk-text-secondary hover:bg-fk-hover hover:text-fk-text",
          dragging === node.id && "opacity-40",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fk-accent",
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {isSelected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-fk-accent" />}
        {dropTarget?.key === key && (
          <span
            aria-hidden="true"
            className={cn("pointer-events-none absolute left-2 right-2 h-0.5 rounded bg-fk-accent", dropTarget.position === "before" ? "-top-px" : "-bottom-px")}
          />
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(key, !expanded);
          }}
          className={cn("flex size-4 shrink-0 items-center justify-center rounded text-fk-text-faint hover:text-fk-text", !hasChildren && "invisible")}
        >
          <ChevronRight className={cn("size-3 transition-transform duration-150", expanded && "rotate-90")} strokeWidth={1.5} />
        </button>
        <span className={cn("shrink-0 truncate", isSelected && "font-medium")}>{label}</span>
        {node.text && <span className="min-w-0 truncate text-fk-text-faint">{node.text}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-fk-text-faint">
          {info?.repeated && (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Repeat className="size-3" strokeWidth={1.5} />
              </TooltipTrigger>
              <TooltipPopup>Rendered from a list. Edits apply to every item.</TooltipPopup>
            </Tooltip>
          )}
          {locked && (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Lock className="size-3" strokeWidth={1.5} />
              </TooltipTrigger>
              <TooltipPopup>Framekit couldn&apos;t identify the source for this element.</TooltipPopup>
            </Tooltip>
          )}
        </span>
      </div>
      {hasChildren && expanded && (
        <div role="group">
          {node.children.map((child) => (
            <LayerRow key={nodeKey(child)} node={child} depth={depth + 1} dragging={dragging} setDragging={setDragging} dropTarget={dropTarget} setDropTarget={setDropTarget} />
          ))}
        </div>
      )}
    </div>
  );
}

function isDescendant(elements: Record<string, ElementInfo>, candidate: ElementInfo, ancestorId: string): boolean {
  let current: ElementInfo | undefined = candidate;
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parentId ? elements[current.parentId] : undefined;
  }
  return false;
}

export function explainDisabled(reason?: string) {
  if (reason) toast.info(reason);
}
