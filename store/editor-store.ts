"use client";

import type { RenderedLevel } from "@/lib/client/text-segment";
import { create } from "zustand";
import type { ElementInfo, StyleSheetModel, Breakpoint, AddableElement } from "@/types/elements";
import type { RouteInfo } from "@/types/project";
import type { SessionSnapshot, CommandResult, SessionPhase } from "@/lib/session/session";
import type { EditCommand } from "@/lib/commands/schema";
import type { Rect, TreeNode } from "@/lib/client/bridge";
import { api, ApiError } from "@/lib/client/api";
import { bridge } from "@/lib/client/bridge";
import { toast } from "@/components/ui/toaster";

export type Viewport = Breakpoint;
export type Mode = "edit" | "preview";
export type Selection = { id: string; instance: number };

export const VIEWPORT_WIDTHS: Record<Viewport, number | null> = { desktop: null, tablet: 768, mobile: 390 };

type ContextMenuState = { x: number; y: number; id: string; instance: number } | null;

export type EditorState = {
  // Session (mirrors the server)
  phase: SessionPhase | "none";
  phaseMessage: string | null;
  error: SessionSnapshot["error"];
  hosted: boolean;
  project: SessionSnapshot["project"] | null;
  routes: RouteInfo[];
  previewUrl: string | null;
  revision: number;
  elements: Record<string, ElementInfo>;
  css: string;
  styles: StyleSheetModel;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  dirtyFiles: string[];
  devLog: string;
  compileError: string | null;
  isSaving: boolean;
  lastSavedAt: number | null;

  // Preview
  tree: TreeNode | null;
  previewPath: string;
  activeRoute: string;
  bridgeReady: boolean;
  previewViewport: { width: number; height: number } | null;

  // Selection
  selected: Selection | null;
  selectedRect: Rect | null;
  selectedDisplay: string | null;
  hovered: { id: string; instance: number; rect: Rect; tag?: string } | null;
  computed: Record<string, string> | null;
  computedSize: { width: number; height: number } | null;
  /** Text of the selected element and its ancestors, innermost first (from the bridge). */
  renderedLevels: RenderedLevel[];
  /** Separate text nodes inside the selected element (the clicked one first); see textPieces in the bridge. */
  renderedPieces: string[];
  /** Set when a double-click asks to edit text that lives in code; the inspector focuses its field and clears it. */
  textFocusRequest: { id: string } | null;
  /** An inline canvas edit of text that lives in a source string; its commit goes there, not to SET_TEXT. */
  inlineSource: { id: string; commit: (value: string) => void } | null;
  styleChecks: Record<string, boolean>;
  inlineEditing: boolean;

  // UI
  mode: Mode;
  viewport: Viewport;
  leftPanel: "layers" | "add";
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  expanded: Record<string, boolean>;
  contextMenu: ContextMenuState;
  confirm: { title: string; description: string; action: string; onConfirm: () => void } | null;
  busy: boolean;

  // Actions
  applySnapshot: (snapshot: SessionSnapshot | null) => void;
  applyResult: (result: CommandResult) => void;
  runCommand: (command: EditCommand, options?: { groupKey?: string; keepSelection?: boolean }) => Promise<CommandResult | null>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  save: () => Promise<boolean>;
  select: (selection: Selection | null, options?: { scroll?: boolean; fromCanvas?: boolean }) => void;
  setHovered: (hovered: EditorState["hovered"]) => void;
  setMode: (mode: Mode) => void;
  setViewport: (viewport: Viewport) => void;
  setRoute: (route: string) => void;
  setLeftPanel: (panel: "layers" | "add") => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setExpanded: (id: string, expanded: boolean) => void;
  revealInLayers: (id: string) => void;
  setContextMenu: (menu: ContextMenuState) => void;
  setConfirm: (confirm: EditorState["confirm"]) => void;
  setTree: (tree: TreeNode | null, path: string) => void;
  startInlineEdit: (selection?: Selection) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  addElement: (elementType: AddableElement, placement: "inside" | "after") => void;
  patch: (partial: Partial<EditorState>) => void;
};

const EMPTY_SESSION = {
  hosted: false,
  phase: "none" as const,
  phaseMessage: null,
  error: null,
  project: null,
  routes: [],
  previewUrl: null,
  revision: 0,
  elements: {},
  css: "",
  styles: {},
  isDirty: false,
  canUndo: false,
  canRedo: false,
  dirtyFiles: [],
  devLog: "",
  compileError: null,
};

let commandQueue: Promise<unknown> = Promise.resolve();

export const useEditor = create<EditorState>((set, get) => ({
  ...EMPTY_SESSION,
  isSaving: false,
  lastSavedAt: null,

  tree: null,
  previewPath: "/",
  activeRoute: "/",
  bridgeReady: false,
  previewViewport: null,

  selected: null,
  selectedRect: null,
  selectedDisplay: null,
  hovered: null,
  computed: null,
  computedSize: null,
  renderedLevels: [],
  renderedPieces: [],
  textFocusRequest: null,
  inlineSource: null,
  styleChecks: {},
  inlineEditing: false,

  mode: "edit",
  viewport: "desktop",
  leftPanel: "layers",
  leftCollapsed: false,
  rightCollapsed: false,
  expanded: {},
  contextMenu: null,
  confirm: null,
  busy: false,

  patch: (partial) => set(partial),

  applySnapshot: (snapshot) => {
    if (!snapshot) {
      set({ ...EMPTY_SESSION, tree: null, selected: null, selectedRect: null, hovered: null, computed: null });
      return;
    }
    const elements: Record<string, ElementInfo> = {};
    for (const el of snapshot.elements) elements[el.id] = el;
    set({
      phase: snapshot.phase,
      phaseMessage: snapshot.phaseMessage,
      error: snapshot.error,
      project: snapshot.project,
      hosted: snapshot.hosted,
      routes: snapshot.routes,
      previewUrl: snapshot.previewUrl,
      revision: snapshot.revision,
      elements,
      css: snapshot.css,
      styles: snapshot.styles,
      isDirty: snapshot.isDirty,
      canUndo: snapshot.canUndo,
      canRedo: snapshot.canRedo,
      dirtyFiles: snapshot.dirtyFiles,
      devLog: snapshot.devLog,
      compileError: snapshot.compileError,
    });
  },

  applyResult: (result) => {
    const affected = new Set(result.affectedFiles);
    const elements: Record<string, ElementInfo> = {};
    for (const [id, el] of Object.entries(get().elements)) if (!affected.has(el.file)) elements[id] = el;
    for (const el of result.elements) elements[el.id] = el;
    set({
      revision: result.revision,
      elements,
      css: result.css,
      styles: result.styles,
      isDirty: result.isDirty,
      dirtyFiles: result.dirtyFiles,
      canUndo: result.canUndo,
      canRedo: result.canRedo,
    });
    bridge.send({ type: "css", css: result.css });
    for (const warning of result.warnings) toast.info(warning);
  },

  runCommand: async (command, options) => {
    const run = async (): Promise<CommandResult | null> => {
      const { revision, selected } = get();
      set({ busy: true });
      try {
        const result = await api.command(command, revision, options?.groupKey);
        get().applyResult(result);
        const next = result.selectedId;
        if (next && (!options?.keepSelection || !selected || selected.id !== next)) {
          const instance = selected && selected.id === next ? selected.instance : 0;
          set({ selected: { id: next, instance } });
          // The DOM catches up after Fast Refresh; the bridge re-sends rects once the tree changes.
          setTimeout(() => bridge.send({ type: "select", id: next, instance, scroll: false }), 350);
        } else if (!next && command.type === "DELETE_NODE") {
          set({ selected: null, selectedRect: null, computed: null });
          bridge.send({ type: "select", id: null });
        }
        return result;
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "The edit could not be applied.";
        toast.error(message);
        if (error instanceof ApiError && error.code === "REVISION_MISMATCH") {
          const { snapshot } = await api.current();
          get().applySnapshot(snapshot);
        }
        return null;
      } finally {
        set({ busy: false });
      }
    };
    const chained = commandQueue.then(run, run);
    commandQueue = chained.catch(() => undefined);
    return chained;
  },

  undo: async () => {
    if (!get().canUndo) return;
    try {
      const result = await api.undo();
      get().applyResult(result);
      bridge.send({ type: "request-tree" });
      const selected = get().selected;
      if (selected) setTimeout(() => bridge.send({ type: "select", id: selected.id, instance: selected.instance }), 350);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Undo failed");
    }
  },

  redo: async () => {
    if (!get().canRedo) return;
    try {
      const result = await api.redo();
      get().applyResult(result);
      bridge.send({ type: "request-tree" });
      const selected = get().selected;
      if (selected) setTimeout(() => bridge.send({ type: "select", id: selected.id, instance: selected.instance }), 350);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Redo failed");
    }
  },

  save: async () => {
    if (!get().isDirty || get().isSaving) return false;
    set({ isSaving: true });
    try {
      const result = await api.save();
      set({ isDirty: result.isDirty, dirtyFiles: result.dirtyFiles, lastSavedAt: Date.now() });
      toast.success("All changes saved", result.files.length === 1 ? result.files[0] : `${result.files.length} files updated`);
      return true;
    } catch (error) {
      toast.error("Couldn't save changes", error instanceof ApiError ? error.message : undefined);
      return false;
    } finally {
      set({ isSaving: false });
    }
  },

  select: (selection, options) => {
    const current = get().selected;
    if (!selection) {
      set({ selected: null, selectedRect: null, selectedDisplay: null, computed: null, computedSize: null, renderedLevels: [], renderedPieces: [], styleChecks: {} });
      if (!options?.fromCanvas) bridge.send({ type: "select", id: null });
      return;
    }
    const changed = !current || current.id !== selection.id || current.instance !== selection.instance;
    set({ selected: selection, styleChecks: changed ? {} : get().styleChecks, contextMenu: null });
    if (changed) set({ computed: null, renderedLevels: [], renderedPieces: [] });
    if (!options?.fromCanvas) bridge.send({ type: "select", id: selection.id, instance: selection.instance, scroll: options?.scroll ?? true });
    get().revealInLayers(selection.id);
  },

  setHovered: (hovered) => set({ hovered }),

  setMode: (mode) => {
    set({ mode, hovered: null, contextMenu: null });
    bridge.send({ type: "mode", mode });
    if (mode === "preview") set({ selectedRect: null });
    else {
      const selected = get().selected;
      if (selected) bridge.send({ type: "select", id: selected.id, instance: selected.instance, scroll: false });
    }
  },

  setViewport: (viewport) => {
    set({ viewport, styleChecks: {} });
    const project = get().project;
    if (project) void api.rememberRoute(project.root, { lastViewport: viewport }).catch(() => undefined);
  },

  setRoute: (input) => {
    const route = input.replace(/\/{2,}/g, "/");
    // Already showing it: the frame wouldn't reload, so clearing the tree would leave Layers waiting.
    if (route === get().activeRoute) return;
    set({ activeRoute: route, previewPath: route, selected: null, selectedRect: null, hovered: null, computed: null, tree: null, bridgeReady: false });
    const project = get().project;
    if (project) void api.rememberRoute(project.root, { lastRoute: route }).catch(() => undefined);
  },

  setLeftPanel: (leftPanel) => set({ leftPanel, leftCollapsed: false }),
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  setExpanded: (id, expanded) => set((s) => ({ expanded: { ...s.expanded, [id]: expanded } })),

  revealInLayers: (id) => {
    const { tree, expanded } = get();
    if (!tree) return;
    const path = findPath(tree, id);
    if (!path) return;
    const next = { ...expanded };
    for (const ancestor of path) next[ancestor] = true;
    set({ expanded: next });
  },

  setContextMenu: (contextMenu) => set({ contextMenu }),
  setConfirm: (confirm) => set({ confirm }),

  setTree: (tree, path) => {
    const next: Partial<EditorState> = { tree, previewPath: path };
    if (tree && Object.keys(get().expanded).length === 0) {
      const expanded: Record<string, boolean> = {};
      // Open the first three levels so the page structure is visible right away.
      const open = (node: TreeNode, depth: number) => {
        if (depth > 2) return;
        expanded[nodeKey(node)] = true;
        node.children.forEach((c) => open(c, depth + 1));
      };
      open(tree, 0);
      next.expanded = expanded;
    }
    set(next);
  },

  startInlineEdit: (selection) => {
    const target = selection ?? get().selected;
    if (!target) return;
    const info = get().elements[target.id];
    if (!info || info.text.kind !== "editable") {
      // The inspector may trace this text to a source string; it focuses that field or explains why not.
      if (info?.text.kind === "readonly") {
        if (!get().renderedLevels[0]?.raw) toast.info(info.text.reason);
        else set({ textFocusRequest: { id: target.id }, rightCollapsed: false });
      }
      return;
    }
    set({ inlineEditing: true, selected: target });
    bridge.send({ type: "edit-text", id: target.id, instance: target.instance });
  },

  deleteSelected: () => {
    const { selected, elements } = get();
    if (!selected) return;
    const info = elements[selected.id];
    if (!info) return;
    if (!info.ops.delete.allowed) {
      toast.info(info.ops.delete.reason ?? "This element can't be deleted.");
      return;
    }
    const run = () => void get().runCommand({ type: "DELETE_NODE", nodeId: selected.id });
    if (info.shared) {
      set({
        confirm: {
          title: "Delete from a shared component?",
          description: "This element comes from a component used in more than one place. Deleting it removes it everywhere.",
          action: "Delete",
          onConfirm: run,
        },
      });
      return;
    }
    run();
  },

  duplicateSelected: () => {
    const { selected, elements } = get();
    if (!selected) return;
    const info = elements[selected.id];
    if (!info) return;
    if (!info.ops.duplicate.allowed) {
      toast.info(info.ops.duplicate.reason ?? "This element can't be duplicated.");
      return;
    }
    const run = () => void get().runCommand({ type: "DUPLICATE_NODE", nodeId: selected.id });
    if (info.shared) {
      set({
        confirm: {
          title: "Duplicate inside a shared component?",
          description: "This change will affect every instance of this component.",
          action: "Duplicate",
          onConfirm: run,
        },
      });
      return;
    }
    run();
  },

  addElement: (elementType, placement) => {
    const { selected, elements, tree } = get();
    let targetId = selected?.id ?? null;
    if (!targetId && tree) {
      // Nothing selected: add inside the first large container on the page (main, else body).
      const main = findFirst(tree, (n) => elements[n.id]?.tag === "main");
      targetId = main?.id ?? (tree.id !== "__body" ? tree.id : null);
      placement = "inside";
    }
    if (!targetId) {
      toast.info("Select a container first.");
      return;
    }
    const info = elements[targetId];
    if (!info) return;
    const op = placement === "inside" ? info.ops.addInside : info.ops.addAfter;
    if (!op.allowed) {
      toast.info(op.reason ?? "Elements can't be added here.");
      return;
    }
    const run = () => void get().runCommand({ type: "ADD_NODE", targetId: targetId!, placement, elementType });
    if (info.shared) {
      set({
        confirm: {
          title: "Add to a shared component?",
          description: "This change will affect every instance of this component.",
          action: "Add element",
          onConfirm: run,
        },
      });
      return;
    }
    run();
  },
}));

if (typeof window !== "undefined") {
  (window as unknown as { __framekit: typeof useEditor }).__framekit = useEditor;
}

export function nodeKey(node: TreeNode): string {
  return `${node.id}#${node.instance}`;
}

function findPath(tree: TreeNode, id: string): string[] | null {
  const path: string[] = [];
  const visit = (node: TreeNode): boolean => {
    if (node.id === id) return true;
    path.push(nodeKey(node));
    for (const child of node.children) if (visit(child)) return true;
    path.pop();
    return false;
  };
  return visit(tree) ? path : null;
}

function findFirst(tree: TreeNode, predicate: (n: TreeNode) => boolean): TreeNode | null {
  if (predicate(tree)) return tree;
  for (const child of tree.children) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

/** Elements that share a source parent, in source order; used for reorder positions. */
export function sourceSiblings(elements: Record<string, ElementInfo>, parentId: string | null): ElementInfo[] {
  return Object.values(elements)
    .filter((e) => e.parentId === parentId)
    .sort((a, b) => lastIndex(a.id) - lastIndex(b.id));
}

function lastIndex(id: string): number {
  const parts = id.split(":")[1]?.split(".") ?? [];
  return Number(parts[parts.length - 1] ?? 0);
}
