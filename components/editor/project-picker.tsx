"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, X, ChevronRight, LoaderCircle, ArrowRight } from "honestui/icons";
import { Wordmark } from "./wordmark";
import { api, ApiError } from "@/lib/client/api";
import type { RecentProject } from "@/lib/filesystem/config-store";
import type { FoundApp } from "@/lib/project/find-apps";
import type { ProjectValidationError } from "@/types/project";
import { cn } from "@/lib/utils";

/** Open failures that mean "this folder isn't an app", worth searching inside for one. */
const SEARCHABLE = new Set<string>(["MONOREPO", "NO_PACKAGE_JSON", "NOT_NEXT"]);

export function ProjectPicker() {
  const router = useRouter();
  const [path, setPath] = React.useState("");
  const [recent, setRecent] = React.useState<RecentProject[]>([]);
  const [opening, setOpening] = React.useState<string | null>(null);
  const [error, setError] = React.useState<(ProjectValidationError & { code?: string }) | null>(null);
  const [showDetail, setShowDetail] = React.useState(false);
  const [current, setCurrent] = React.useState<{ name: string; root: string } | null>(null);
  /** Next.js apps found inside a folder that isn't an app itself (usually a monorepo root). */
  const [found, setFound] = React.useState<{ folder: string; apps: FoundApp[] } | null>(null);

  React.useEffect(() => {
    void api.recent().then((r) => setRecent(r.recent)).catch(() => undefined);
    void api.current().then((r) => {
      if (r.snapshot && r.snapshot.phase !== "error") setCurrent({ name: r.snapshot.project.name, root: r.snapshot.project.root });
    }).catch(() => undefined);
  }, []);

  const open = async (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) return;
    if (current && trimmed === current.root) {
      router.push("/editor");
      return;
    }
    setOpening(trimmed);
    setError(null);
    setFound(null);
    try {
      await api.openProject(trimmed);
      router.push("/editor");
    } catch (e) {
      const info: ProjectValidationError =
        e instanceof ApiError ? (e.info ?? { code: e.code as ProjectValidationError["code"], message: e.message }) : { code: "NOT_FOUND", message: "The project could not be opened." };
      // Not an app itself (a monorepo root or a parent folder): look for Next.js apps inside it.
      if (SEARCHABLE.has(info.code)) {
        const apps = await api.findApps(trimmed).then((r) => r.apps).catch(() => [] as FoundApp[]);
        const openable = apps.filter((a) => a.router === "app");
        if (openable.length === 1 && apps.length === 1) {
          setPath(openable[0].path);
          setOpening(null);
          return open(openable[0].path);
        }
        if (apps.length > 0) {
          setFound({ folder: trimmed, apps });
          setOpening(null);
          return;
        }
      }
      setError(info);
      setOpening(null);
    }
  };

  const [browsing, setBrowsing] = React.useState(false);
  const browse = async () => {
    setBrowsing(true);
    setError(null);
    try {
      const { path: picked } = await api.browseFolder(path);
      if (picked) {
        setPath(picked);
        void open(picked);
      }
    } catch (e) {
      setError({ code: "NOT_FOUND", message: e instanceof Error ? e.message : "The folder picker could not be opened." });
    } finally {
      setBrowsing(false);
    }
  };

  // `?project=swipz-landing` (from a dashboard's Edit Site tab): go straight to that project. Only
  // projects already in Recent are opened, since opening one runs its code and any page can link here.
  React.useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("project");
    if (!wanted) return;
    let cancelled = false;
    void Promise.all([api.current(), api.recent()])
      .then(async ([{ snapshot }, { recent: known }]) => {
        if (cancelled) return;
        if (snapshot && snapshot.phase !== "error" && (snapshot.project.name === wanted || snapshot.project.root === wanted)) {
          router.replace("/editor");
          return;
        }
        const match = known.find((r) => r.name === wanted || r.path === wanted);
        if (!match) {
          setError({ code: "NOT_FOUND", message: `“${wanted}” isn't in your recent projects. Open it here once, and links to it will work from then on.` });
          return;
        }
        setPath(match.path);
        setOpening(match.path);
        try {
          await api.openProject(match.path);
          if (!cancelled) router.push("/editor");
        } catch (e) {
          setOpening(null);
          setError(e instanceof ApiError && e.info ? e.info : { code: "NOT_FOUND", message: "The project could not be opened." });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);

  const forget = async (p: string) => {
    await api.forgetRecent(p).catch(() => undefined);
    setRecent((r) => r.filter((x) => x.path !== p));
  };

  // One list: the project that is open right now sits first, then the rest by recency.
  const rows: Array<RecentProject & { live: boolean }> = [
    ...(current ? [{ path: current.root, name: current.name, lastOpened: "", live: true }] : []),
    ...recent.filter((r) => r.path !== current?.root).map((r) => ({ ...r, live: false })),
  ];

  return (
    <div className="flex h-full flex-col bg-fk-app">
      <header className="flex h-[var(--fk-toolbar-height)] shrink-0 items-center justify-between border-b border-fk-border bg-fk-panel px-4">
        <Wordmark />
        <span className="font-mono text-[11px] text-fk-text-faint">127.0.0.1</span>
      </header>

      <main className="flex-1 overflow-y-auto fk-scroll">
        <div className="mx-auto w-full max-w-[560px] px-4 pt-16 pb-12">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void open(path);
            }}
          >
            <label htmlFor="project-path" className="text-[12px] font-medium leading-4 text-fk-text">
              Open project
            </label>
            <div className="mt-2 flex gap-2">
              <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-fk-border bg-fk-panel px-2.5 transition-[border-color,box-shadow] duration-[var(--hui-duration-fast)] ease-[var(--hui-ease-out)] focus-within:border-fk-accent focus-within:shadow-[0_0_0_1px_var(--fk-accent)]">
                <FolderOpen className="size-3.5 shrink-0 text-fk-text-faint" strokeWidth={1.5} />
                <input
                  id="project-path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="~/Projects/my-website"
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus
                  className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12px] text-fk-text outline-none placeholder:text-fk-text-faint"
                />
              </div>
              <button
                type="button"
                onClick={() => void browse()}
                disabled={opening !== null || browsing}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-fk-border bg-fk-panel px-3 text-[12px] font-medium text-fk-text transition-colors duration-[var(--hui-duration-fast)] ease-[var(--hui-ease-out)] hover:bg-fk-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {browsing ? <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} /> : null}
                Browse…
              </button>
              <button
                type="submit"
                aria-label="Open project"
                disabled={opening !== null || !path.trim()}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-fk-accent px-3 text-[12px] font-medium text-white transition-[background-color,opacity] duration-[var(--hui-duration-fast)] ease-[var(--hui-ease-out)] hover:bg-fk-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {opening && opening === path.trim() ? <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} /> : null}
                Open
              </button>
            </div>
            <p className="mt-2 text-[11.5px] leading-4 text-fk-text-muted">A Next.js App Router project, or a monorepo that contains one. Edits stay in a draft until you save.</p>
          </form>

          {found && (
            <section className="mt-6" aria-label="Next.js apps in this folder">
              <h2 className="flex min-w-0 items-baseline gap-1.5 text-[12px] font-medium leading-4 text-fk-text">
                <span className="shrink-0">{found.apps.length === 1 ? "1 Next.js app in" : `${found.apps.length} Next.js apps in`}</span>
                <span className="truncate font-mono text-[11px] font-normal text-fk-text-muted" dir="rtl">
                  <bdi>{shortenHome(found.folder)}</bdi>
                </span>
              </h2>
              <ul className="mt-2 divide-y divide-fk-border overflow-hidden rounded-md border border-fk-border bg-fk-panel">
                {found.apps.map((app) => {
                  const supported = app.router === "app";
                  return (
                    <li key={app.path}>
                      <button
                        type="button"
                        disabled={!supported || opening !== null}
                        onClick={() => {
                          setPath(app.path);
                          void open(app.path);
                        }}
                        className="group flex h-11 w-full items-center gap-3 px-3 text-left transition-colors duration-[var(--hui-duration-fast)] enabled:hover:bg-fk-hover disabled:cursor-not-allowed"
                      >
                        <span className={cn("min-w-0 flex-1", !supported && "opacity-50")}>
                          <span className="block truncate text-[12.5px] font-medium leading-4 text-fk-text">{app.name}</span>
                          <span className="block truncate font-mono text-[10.5px] leading-4 text-fk-text-muted">{app.relative}</span>
                        </span>
                        <span className="flex shrink-0 items-center text-[11px] text-fk-text-muted">
                          {opening === app.path ? (
                            <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} />
                          ) : supported ? (
                            <ArrowRight className="size-3.5 text-fk-text-faint opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={1.5} />
                          ) : (
                            "Pages Router, not supported"
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {error && (
            <div role="alert" className="mt-4 rounded-md border border-fk-border bg-fk-panel p-3">
              <p className="text-[12px] font-medium leading-5 text-fk-error">{error.message}</p>
              {error.suggestion && <pre className="mt-2 overflow-x-auto rounded-[4px] bg-fk-raised px-3 py-2 font-mono text-[11px] leading-5 text-fk-text">{error.suggestion}</pre>}
              {error.detail && (
                <div className="mt-2">
                  <button type="button" onClick={() => setShowDetail((v) => !v)} className="inline-flex items-center gap-1 text-[11.5px] text-fk-text-muted hover:text-fk-text">
                    <ChevronRight className={cn("size-3.5 transition-transform duration-150", showDetail && "rotate-90")} strokeWidth={1.5} />
                    Technical details
                  </button>
                  {showDetail && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-[4px] bg-fk-raised p-3 font-mono text-[11px] leading-4 text-fk-text-secondary">{error.detail}</pre>}
                </div>
              )}
            </div>
          )}

          {rows.length > 0 && (
            <section className="mt-10" aria-label="Recent projects">
              <h2 className="text-[12px] font-medium leading-4 text-fk-text">Recent</h2>
              <ul className="mt-2 divide-y divide-fk-border overflow-hidden rounded-md border border-fk-border bg-fk-panel">
                {rows.map((item) => (
                  <li key={item.path} className="group relative">
                    <button
                      type="button"
                      disabled={opening !== null}
                      onClick={() => {
                        setPath(item.path);
                        void open(item.path);
                      }}
                      className="flex h-11 w-full items-center gap-3 px-3 text-left transition-colors duration-[var(--hui-duration-fast)] hover:bg-fk-hover disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[12.5px] font-medium leading-4 text-fk-text">{item.name}</span>
                          {item.live && <span className="rounded-[3px] bg-fk-selected px-1 text-[10.5px] font-medium leading-4 text-fk-accent">In editor</span>}
                        </span>
                        <span className="block truncate font-mono text-[10.5px] leading-4 text-fk-text-muted" dir="rtl">
                          <bdi>{shortenHome(item.path)}</bdi>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center pr-6 text-[11px] text-fk-text-muted">
                        {opening === item.path ? (
                          <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} />
                        ) : item.live ? null : (
                          <span className="fk-num">{relativeTime(item.lastOpened)}</span>
                        )}
                      </span>
                    </button>
                    {item.live ? (
                      <ArrowRight className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-fk-text-faint" strokeWidth={1.5} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => void forget(item.path)}
                        aria-label={`Remove ${item.name} from recent projects`}
                        className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-fk-text-faint opacity-0 transition-[opacity,color] hover:text-fk-text group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <X className="size-3.5" strokeWidth={1.5} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function shortenHome(p: string): string {
  return p.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~");
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
