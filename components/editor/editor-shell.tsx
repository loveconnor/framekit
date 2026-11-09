"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useEditor } from "@/store/editor-store";
import { api } from "@/lib/client/api";
import { handleEditorKey, isTextField } from "@/lib/client/shortcuts";
import { EditorToolbar } from "./editor-toolbar";
import { LeftSidebar } from "./left-sidebar";
import { Canvas } from "./canvas";
import { Inspector } from "@/components/inspector/inspector";
import { StatusBar } from "./status-bar";
import { ConfirmDialog } from "./confirm-dialog";
import type { SessionSnapshot } from "@/lib/session/session";
import type { DevServerEvent } from "@/lib/project/process-manager";
import type { RouteInfo } from "@/types/project";

type ServerEvent =
  | { type: "hello"; snapshot: SessionSnapshot | null }
  | { type: "phase"; phase: SessionSnapshot["phase"]; message: string | null }
  | { type: "dev"; event: DevServerEvent }
  | { type: "revision"; revision: number }
  | { type: "saved"; files: string[]; isDirty?: boolean; dirtyFiles?: string[] }
  | { type: "routes"; routes: RouteInfo[] }
  | { type: "closed" }
  | { type: "ping" };

export function EditorShell() {
  const router = useRouter();
  const applySnapshot = useEditor((s) => s.applySnapshot);
  const phase = useEditor((s) => s.phase);
  const leftCollapsed = useEditor((s) => s.leftCollapsed);
  const rightCollapsed = useEditor((s) => s.rightCollapsed);
  const [loaded, setLoaded] = React.useState(false);

  // Initial snapshot, saved route/viewport, and the event stream.
  React.useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    const refresh = async () => {
      const { snapshot } = await api.current();
      if (cancelled) return;
      if (!snapshot) {
        router.replace("/");
        return;
      }
      applySnapshot(snapshot);
      return snapshot;
    };

    void (async () => {
      const snapshot = await refresh().catch(() => undefined);
      if (!snapshot || cancelled) return;
      setLoaded(true);
      try {
        const { recent } = await api.recent();
        const entry = recent.find((r) => r.path === snapshot.project.root);
        const state = useEditor.getState();
        // Older sessions could remember `//privacy` (an empty dynamic segment): collapse it.
        const lastRoute = entry?.lastRoute?.replace(/\/{2,}/g, "/");
        if (lastRoute && snapshot.routes.some((r) => r.pattern === lastRoute || lastRoute.startsWith("/"))) {
          state.patch({ activeRoute: lastRoute, previewPath: lastRoute });
        }
        if (entry?.lastViewport) state.patch({ viewport: entry.lastViewport });
      } catch {
        // preferences are optional
      }

      source = new EventSource("/api/projects/events");
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as ServerEvent;
        const state = useEditor.getState();
        switch (event.type) {
          case "phase":
            state.patch({ phase: event.phase, phaseMessage: event.message });
            if (event.phase === "ready" || event.phase === "error") void refresh();
            break;
          case "dev":
            if (event.event.type === "compile") state.patch({ compileError: event.event.ok ? null : (event.event.message ?? "Compilation failed") });
            if (event.event.type === "output") state.patch({ devLog: (state.devLog + "\n" + event.event.line).slice(-20_000) });
            if (event.event.type === "status" && event.event.status === "failed") state.patch({ compileError: event.event.message ?? "The project preview stopped running." });
            break;
          case "saved":
            if (event.isDirty !== undefined) state.patch({ isDirty: event.isDirty, dirtyFiles: event.dirtyFiles ?? [], lastSavedAt: Date.now() });
            break;
          case "routes":
            state.patch({ routes: event.routes });
            break;
          case "closed":
            router.replace("/");
            break;
        }
      };
    })();

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [applySnapshot, router]);

  // Keyboard shortcuts for the editor window; the bridge forwards keys pressed inside the preview.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const handled = handleEditorKey({ key: e.key, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, inTextField: isTextField(e.target) });
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().isDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  if (!loaded && phase === "none") {
    return <div className="flex h-full items-center justify-center text-[13px] text-fk-text-muted">Loading editor…</div>;
  }

  return (
    <div className="grid h-full grid-rows-[var(--fk-toolbar-height)_minmax(0,1fr)_var(--fk-statusbar-height)] bg-fk-app">
      <EditorToolbar />
      <div className="flex min-h-0 min-w-0">
        {!leftCollapsed && <LeftSidebar />}
        <Canvas />
        {!rightCollapsed && <Inspector />}
      </div>
      <StatusBar />
      <ConfirmDialog />
    </div>
  );
}
