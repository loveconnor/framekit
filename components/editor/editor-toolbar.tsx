"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Monitor, Tablet, Smartphone, Undo2, Redo2, Eye, Pencil, LoaderCircle, Check, Search, PanelLeft, PanelRight, CloudUpload } from "honestui/icons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "@/components/ui/tooltip";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogPopup, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogClose,
} from "@/components/ui/alert-dialog";
import { Wordmark } from "./wordmark";
import { PublishDialog } from "./publish-dialog";
import { useEditor, VIEWPORT_WIDTHS, type Viewport } from "@/store/editor-store";
import { api } from "@/lib/client/api";
import type { RecentProject } from "@/lib/filesystem/config-store";
import { cn } from "@/lib/utils";

export function EditorToolbar() {
  const router = useRouter();
  const project = useEditor((s) => s.project);
  const hosted = useEditor((s) => s.hosted);
  const routes = useEditor((s) => s.routes);
  const activeRoute = useEditor((s) => s.activeRoute);
  const setRoute = useEditor((s) => s.setRoute);
  const viewport = useEditor((s) => s.viewport);
  const setViewport = useEditor((s) => s.setViewport);
  const previewViewport = useEditor((s) => s.previewViewport);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const isDirty = useEditor((s) => s.isDirty);
  const isSaving = useEditor((s) => s.isSaving);
  const save = useEditor((s) => s.save);
  const phase = useEditor((s) => s.phase);
  const leftCollapsed = useEditor((s) => s.leftCollapsed);
  const rightCollapsed = useEditor((s) => s.rightCollapsed);
  const toggleLeft = useEditor((s) => s.toggleLeft);
  const toggleRight = useEditor((s) => s.toggleRight);

  const [leaving, setLeaving] = React.useState<null | "back" | "close" | string>(null);
  const [recent, setRecent] = React.useState<RecentProject[]>([]);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishKey, setPublishKey] = React.useState(0);
  const openPublish = () => {
    setPublishKey((k) => k + 1); // remount so the dialog starts clean
    setPublishOpen(true);
  };

  const ready = phase === "ready";
  const currentRoute = routes.find((r) => r.pattern === activeRoute || r.previewPath === activeRoute);
  const routeLabel = currentRoute ? currentRoute.name : routeNameFromPath(activeRoute);

  const leave = async (target: "back" | "close" | string) => {
    if (useEditor.getState().isDirty) {
      setLeaving(target);
      return;
    }
    await performLeave(target);
  };

  const performLeave = async (target: "back" | "close" | string) => {
    if (target === "back") {
      router.push("/");
      return;
    }
    if (target === "close") {
      await api.closeProject().catch(() => undefined);
      useEditor.getState().applySnapshot(null);
      router.push("/");
      return;
    }
    // Switch to another recent project.
    try {
      await api.openProject(target);
      useEditor.getState().applySnapshot(null);
      useEditor.getState().patch({ activeRoute: "/", previewPath: "/", selected: null, tree: null, expanded: {} });
      const { snapshot } = await api.current();
      useEditor.getState().applySnapshot(snapshot);
    } catch {
      router.push("/");
    }
  };

  return (
    <header className="flex h-[var(--fk-toolbar-height)] items-center justify-between gap-4 border-b border-fk-border bg-fk-panel px-3">
      <div className="flex min-w-0 items-center gap-1">
        <Menu>
          <MenuTrigger render={<Button variant="link" size="sm" className="gap-1.5 px-2" aria-label="Framekit menu" />}>
            <Wordmark />
            <ChevronDown className="size-3.5 text-fk-text-faint" strokeWidth={1.5} />
          </MenuTrigger>
          <MenuPopup align="start" className="min-w-44">
            {!hosted && <MenuItem onClick={() => void leave("back")}>Back to projects</MenuItem>}
            {/* Rebuilds the preview copy and restarts its dev server, e.g. after the project's config changed. */}
            {project && <MenuItem onClick={() => void leave(project.root)}>Reload project</MenuItem>}
            {!hosted && <MenuItem onClick={() => void leave("close")}>Close project</MenuItem>}
          </MenuPopup>
        </Menu>

        <span className="mx-1 h-4 w-px bg-fk-border" aria-hidden="true" />

        <Menu onOpenChange={(open) => open && void api.recent().then((r) => setRecent(r.recent)).catch(() => undefined)}>
          <MenuTrigger render={<Button variant="link" size="sm" className="max-w-[200px] gap-1.5 px-2 font-normal" />}>
            <span className="truncate text-fk-text">{project?.name ?? "Project"}</span>
            <ChevronDown className="size-3.5 shrink-0 text-fk-text-faint" strokeWidth={1.5} />
          </MenuTrigger>
          <MenuPopup align="start" className="min-w-64">
            {project && (
              <div className="px-3 py-2">
                <p className="text-[13px] font-medium text-fk-text">{project.name}</p>
                <p className="truncate font-mono text-[11px] text-fk-text-muted">{project.root}</p>
              </div>
            )}
            {/* Hosted Framekit edits one site: no switching to other projects. */}
            {!hosted && recent.filter((r) => r.path !== project?.root).length > 0 && <MenuSeparator />}
            {(hosted ? [] : recent)
              .filter((r) => r.path !== project?.root)
              .map((r) => (
                <MenuItem key={r.path} onClick={() => void leave(r.path)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{r.name}</span>
                    <span className="truncate font-mono text-[11px] text-fk-text-muted">{r.path}</span>
                  </span>
                </MenuItem>
              ))}
          </MenuPopup>
        </Menu>

        <span className="mx-1 h-4 w-px bg-fk-border" aria-hidden="true" />

        <PageSelector routes={routes} activeRoute={activeRoute} onSelect={setRoute} label={routeLabel} disabled={!ready} />
      </div>

      <div className="flex items-center gap-3">
        <ToggleGroup
          value={[viewport]}
          onValueChange={(value) => {
            const next = (Array.isArray(value) ? value[0] : value) as Viewport | undefined;
            if (next) setViewport(next);
          }}
          size="sm"
          aria-label="Preview viewport"
          className="h-8 p-0.5"
        >
          <ViewportButton value="desktop" label="Desktop" icon={<Monitor className="size-4" strokeWidth={1.5} />} />
          <ViewportButton value="tablet" label="Tablet, 768px" icon={<Tablet className="size-4" strokeWidth={1.5} />} />
          <ViewportButton value="mobile" label="Mobile, 390px" icon={<Smartphone className="size-4" strokeWidth={1.5} />} />
        </ToggleGroup>
        <span className="fk-num hidden w-14 font-mono text-[11px] text-fk-text-muted lg:inline">
          {VIEWPORT_WIDTHS[viewport] ?? previewViewport?.width ?? "—"}px
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger render={<Button variant="link" size="icon-sm" aria-label={leftCollapsed ? "Show layers" : "Hide layers"} onClick={toggleLeft} className={cn(!leftCollapsed && "text-fk-text", leftCollapsed && "text-fk-text-muted")} />}>
            <PanelLeft className="size-4" strokeWidth={1.5} />
          </TooltipTrigger>
          <TooltipPopup>{leftCollapsed ? "Show layers" : "Hide layers"}</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="link" size="icon-sm" aria-label={rightCollapsed ? "Show inspector" : "Hide inspector"} onClick={toggleRight} className={cn(!rightCollapsed && "text-fk-text", rightCollapsed && "text-fk-text-muted")} />}>
            <PanelRight className="size-4" strokeWidth={1.5} />
          </TooltipTrigger>
          <TooltipPopup>{rightCollapsed ? "Show inspector" : "Hide inspector"}</TooltipPopup>
        </Tooltip>

        <span className="mx-1 h-4 w-px bg-fk-border" aria-hidden="true" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={mode === "preview" ? "secondary" : "link"}
                size="sm"
                onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
                disabled={!ready}
                aria-pressed={mode === "preview"}
                className="gap-1.5"
              />
            }
          >
            {mode === "preview" ? <Pencil className="size-4" strokeWidth={1.5} /> : <Eye className="size-4" strokeWidth={1.5} />}
            {mode === "preview" ? "Edit" : "Preview"}
          </TooltipTrigger>
          <TooltipPopup>
            {mode === "preview" ? "Back to editing" : "Preview the page with links and buttons working"} <Kbd>⌘⇧P</Kbd>
          </TooltipPopup>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger render={<Button variant="link" size="icon-sm" aria-label="Undo" disabled={!canUndo || !ready} onClick={() => void undo()} />}>
            <Undo2 className="size-4" strokeWidth={1.5} />
          </TooltipTrigger>
          <TooltipPopup>
            Undo <Kbd>⌘Z</Kbd>
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="link" size="icon-sm" aria-label="Redo" disabled={!canRedo || !ready} onClick={() => void redo()} />}>
            <Redo2 className="size-4" strokeWidth={1.5} />
          </TooltipTrigger>
          <TooltipPopup>
            Redo <Kbd>⌘⇧Z</Kbd>
          </TooltipPopup>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger render={<Button size="sm" className="ml-1 min-w-[64px]" disabled={!isDirty || isSaving || !ready} onClick={() => void save()} />}>
            {isSaving ? <LoaderCircle className="size-4 animate-spin" strokeWidth={1.5} /> : null}
            {isSaving ? "Saving" : "Save"}
          </TooltipTrigger>
          <TooltipPopup>
            Write changes to the project <Kbd>⌘S</Kbd>
          </TooltipPopup>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger render={<Button size="sm" variant="outline" className="ml-1" disabled={!ready} onClick={openPublish} />}>
            <CloudUpload className="size-4" strokeWidth={1.5} />
            Publish
          </TooltipTrigger>
          <TooltipPopup>Commit saved changes and push them to deploy</TooltipPopup>
        </Tooltip>
      </div>

      <PublishDialog key={publishKey} open={publishOpen} onOpenChange={setPublishOpen} />

      <AlertDialog open={leaving !== null} onOpenChange={(open) => !open && setLeaving(null)}>
        <AlertDialogPopup className="max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>Save your edits to the project before leaving, or discard them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="secondary"
              onClick={() => {
                const target = leaving!;
                setLeaving(null);
                void performLeave(target);
              }}
            >
              Discard changes
            </Button>
            <Button
              onClick={async () => {
                const target = leaving!;
                const ok = await save();
                if (!ok) return;
                setLeaving(null);
                void performLeave(target);
              }}
            >
              Save changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </header>
  );
}

function ViewportButton({ value, label, icon }: { value: Viewport; label: string; icon: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={label} size="sm" className="h-7 min-w-8 px-2" />}>{icon}</TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ml-1 rounded border border-white/20 px-1 font-sans text-[10px] text-white/70">{children}</kbd>;
}

function PageSelector({
  routes,
  activeRoute,
  onSelect,
  label,
  disabled,
}: {
  routes: { pattern: string; name: string; dynamic: boolean; previewPath?: string }[];
  activeRoute: string;
  onSelect: (route: string) => void;
  label: string;
  disabled: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [dynamicInput, setDynamicInput] = React.useState<string | null>(null);
  const filtered = routes.filter((r) => `${r.name} ${r.pattern}`.toLowerCase().includes(query.toLowerCase()));

  const isActive = (route: { pattern: string; previewPath?: string }) => route.pattern === activeRoute || route.previewPath === activeRoute;
  const choose = (route: { pattern: string; dynamic: boolean; previewPath?: string }) => {
    if (route.dynamic && route.previewPath) {
      onSelect(route.previewPath);
      setOpen(false);
      return;
    }
    if (route.dynamic) {
      setDynamicInput(route.pattern);
      return;
    }
    onSelect(route.pattern);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setDynamicInput(null);
        }
      }}
    >
      <PopoverTrigger render={<Button variant="link" size="sm" className="max-w-[260px] gap-1.5 px-2 font-normal" disabled={disabled} aria-label="Select page" />}>
        <span className="truncate text-fk-text">{label}</span>
        <span className="truncate font-mono text-[11px] text-fk-text-muted">{activeRoute}</span>
        <ChevronDown className="size-3.5 shrink-0 text-fk-text-faint" strokeWidth={1.5} />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-80 p-0">
        {dynamicInput === null ? (
          <>
            <div className="flex items-center gap-2 border-b border-fk-border px-3">
              <Search className="size-3.5 text-fk-text-faint" strokeWidth={1.5} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pages"
                aria-label="Search pages"
                className="h-9 w-full bg-transparent text-[13px] text-fk-text outline-none placeholder:text-fk-text-faint"
              />
            </div>
            <ul className="max-h-72 overflow-y-auto fk-scroll p-1" role="listbox" aria-label="Pages">
              {filtered.length === 0 && <li className="px-3 py-2 text-xs text-fk-text-muted">No pages match</li>}
              {filtered.map((route) => (
                <li key={route.pattern}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive(route)}
                    onClick={() => choose(route)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] text-fk-text hover:bg-fk-hover",
                      isActive(route) && "bg-fk-selected hover:bg-fk-selected",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {isActive(route) ? <Check className="size-3.5 shrink-0 text-fk-accent" strokeWidth={1.5} /> : <span className="size-3.5 shrink-0" />}
                      <span className="truncate">{route.name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-fk-text-muted">{route.previewPath ?? route.pattern}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <form
            className="flex flex-col gap-3 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = (new FormData(e.currentTarget).get("url") as string).trim().replace(/\/{2,}/g, "/");
              if (!value.startsWith("/")) return;
              onSelect(value);
              setOpen(false);
            }}
          >
            <div>
              <p className="text-[13px] font-medium text-fk-text">Dynamic route</p>
              <p className="mt-0.5 text-xs leading-4 text-fk-text-secondary">
                <span className="font-mono">{dynamicInput}</span> needs a real URL to preview. Enter one that exists in your data.
              </p>
            </div>
            <Input name="url" defaultValue={dynamicInput.replace(/\[\[?\.{0,3}([^\]]+)\]\]?/g, "").replace(/\/{2,}/g, "/")} placeholder="/blog/my-post" autoFocus className="font-mono text-[12px]" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDynamicInput(null)}>
                Back
              </Button>
              <Button type="submit" size="sm">
                Open
              </Button>
            </div>
          </form>
        )}
      </PopoverPopup>
    </Popover>
  );
}

function routeNameFromPath(path: string): string {
  if (path === "/") return "Home";
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return last.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
