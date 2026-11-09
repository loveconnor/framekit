import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import * as t from "@babel/types";
import type { ProjectInfo, RouteInfo } from "@/types/project";
import type { ElementInfo, StyleSheetModel } from "@/types/elements";
import type { EditCommand } from "@/lib/commands/schema";
import { Workspace, SOURCE_EXTENSIONS, readBridgeSource } from "@/lib/preview/workspace";
import { DevServer, type DevServerEvent } from "@/lib/project/process-manager";
import { discoverRoutes } from "@/lib/project/discovery";
import { instrumentSource, hasBodyElement } from "@/lib/source/instrument";
import { analyzeFile, describeElement, isInstrumentable, type FileAnalysis } from "@/lib/source/analysis";
import { parseSource, SourceParseError } from "@/lib/source/parser";
import {
  openForMutation, requireElement, finish, setText, setAttribute, ensureStyleId, setInlineStyleProperty, setTag,
  deleteElement, duplicateElement, collectCopiedStyleIds, moveElement, insertNewElement, MutationError, NEW_ELEMENT_STYLES,
} from "@/lib/source/mutations";
import { catalogEntry } from "@/lib/source/element-catalog";
import {
  serializeStylesheet, parseStylesheet, setStyle as setStyleRule, removeStyleIds, copyStyleRules, makeStyleIdFactory, validateDeclaration,
} from "@/lib/styles/stylesheet";
import { atomicWrite, fileExists, readTextIfExists } from "@/lib/filesystem/safe-write";
import { backupsDir, contentHash, ensureDir, shortHash, toPosix, resolveInside } from "@/lib/filesystem/paths";
import { addPendingPublish } from "@/lib/filesystem/config-store";
import { ProjectError } from "@/types/project";
import { parseJsonc } from "@/lib/filesystem/jsonc";
import { hostedConfig } from "@/lib/hosted/config";
import { collectTextLiterals, findTextSources, setTextLiteral, TextSourceError, type TextLiteral, type TextSourceMatch } from "@/lib/source/text-sources";

export type SessionPhase = "checking" | "preparing" | "starting" | "loading" | "ready" | "error";

type DraftFile = {
  draft: string;
  saved: string | null;
  savedHash: string | null;
  parseError: string | null;
};

type HistoryEntry = {
  label: string;
  groupKey?: string;
  files: Map<string, { before: string | null; after: string | null }>;
  styles: { before: StyleSheetModel; after: StyleSheetModel };
  createdAt: number;
};

export type CommandResult = {
  revision: number;
  affectedFiles: string[];
  elements: ElementInfo[];
  css: string;
  styles: StyleSheetModel;
  selectedId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  dirtyFiles: string[];
  warnings: string[];
};

export type SessionSnapshot = {
  /** Hosted Framekit (one site, opened from its dashboard): hides project switching in the UI. */
  hosted: boolean;
  phase: SessionPhase;
  phaseMessage: string | null;
  error: { message: string; detail?: string; suggestion?: string } | null;
  project: Pick<ProjectInfo, "root" | "name" | "appDirRelative" | "packageManager" | "nextVersion">;
  routes: RouteInfo[];
  previewUrl: string | null;
  revision: number;
  elements: ElementInfo[];
  css: string;
  styles: StyleSheetModel;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  dirtyFiles: string[];
  devLog: string;
  compileError: string | null;
  warnings: string[];
};

export class SessionError extends Error {
  constructor(message: string, public readonly code: string = "UNSUPPORTED", public readonly status = 400) {
    super(message);
  }
}

export class ProjectSession {
  readonly events = new EventEmitter();
  readonly workspace: Workspace;
  readonly dev: DevServer;
  readonly stylesFile: string;

  phase: SessionPhase = "checking";
  phaseMessage: string | null = null;
  error: SessionSnapshot["error"] = null;
  routes: RouteInfo[] = [];
  revision = 0;
  warnings: string[] = [];
  compileError: string | null = null;

  private files = new Map<string, DraftFile>();
  private analyses = new Map<string, FileAnalysis>();
  private elements = new Map<string, ElementInfo>();
  private importers = new Map<string, Set<string>>();
  private styles: StyleSheetModel = {};
  private stylesSaved: string | null = null;
  private stylesSavedHash: string | null = null;
  private stylesSavedExists = false;
  private pendingAssets = new Map<string, string>(); // public-relative path -> temp file path
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private aliasPaths: Array<{ prefix: string; target: string }> = [];
  private closed = false;

  constructor(readonly project: ProjectInfo, readonly editorOrigin: string) {
    this.workspace = new Workspace(project);
    this.dev = new DevServer(this.workspace.dir, this.workspace.mirrorRoot);
    this.stylesFile = toPosix(path.join(path.relative(project.root, project.sourceRoot), "framekit", "styles.css"));
    this.dev.on("event", (event: DevServerEvent) => {
      if (event.type === "compile") this.compileError = event.ok ? null : (event.message ?? "Compilation failed");
      if (event.type === "status" && event.status === "failed" && this.phase === "ready") {
        this.compileError = event.message ?? "The project preview stopped running.";
      }
      this.events.emit("event", { type: "dev", event });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  async boot(): Promise<void> {
    try {
      this.setPhase("checking", "Checking project...");
      this.routes = await discoverRoutes(this.project);
      if (this.routes.length === 0) {
        throw new ProjectError({ code: "NO_ROUTES", message: "No page files were found in the app directory." });
      }
      await this.loadAliases();

      this.setPhase("preparing", "Preparing preview...");
      await this.loadSourceFiles();
      await this.loadStylesheet();
      this.buildImportGraph();
      this.buildStyledExports();

      const layout = this.files.get(this.project.rootLayoutFile);
      if (!layout || layout.parseError) {
        throw new ProjectError({
          code: "UNSUPPORTED_LAYOUT",
          message: "The root layout could not be parsed.",
          detail: layout?.parseError ?? undefined,
        });
      }
      if (!hasBodyElement(layout.draft, this.project.rootLayoutFile)) {
        throw new ProjectError({
          code: "UNSUPPORTED_LAYOUT",
          message: "The root layout has no <body> element Framekit can attach to.",
          detail: `Framekit expects a native <body> in ${this.project.rootLayoutFile}.`,
        });
      }

      await this.workspace.create(async (rel, content) => this.instrumentForWorkspace(rel, content), this.editorOrigin);
      if (this.closed) return;

      this.setPhase("starting", "Starting development server...");
      await this.dev.start();
      if (this.closed) return;

      this.setPhase("loading", "Loading website...");
      await this.warmRoute(this.routes[0]?.pattern ?? "/");
      if (this.closed) return;
      this.setPhase("ready", "Ready");
      void this.warmAllRoutes();
    } catch (error) {
      if (this.closed) return;
      if (error instanceof ProjectError) {
        this.error = { message: error.info.message, detail: error.info.detail, suggestion: error.info.suggestion };
      } else {
        this.error = { message: (error as Error).message || "The project could not be opened.", detail: this.dev.log || undefined };
      }
      this.setPhase("error", this.error.message);
      await this.dev.stop().catch(() => {});
    }
  }

  /**
   * Load every page once in the background so the dev server compiles them before they're opened
   * (a first visit otherwise waits for compilation), and record a preview URL for dynamic routes
   * that work without their dynamic segments (`/[locale]/privacy` served at `/privacy`).
   */
  private async warmAllRoutes(): Promise<void> {
    let found = false;
    for (const route of this.routes) {
      if (this.closed) return;
      const candidate = route.dynamic ? withoutDynamicSegments(route.pattern) : route.pattern;
      if (candidate === null) continue;
      try {
        const res = await fetch(`${this.dev.url}${candidate}`, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
        await res.arrayBuffer().catch(() => undefined);
        if (route.dynamic && res.status === 200) {
          route.previewPath = candidate;
          found = true;
        }
      } catch {
        // best effort: the page compiles when it's opened instead
      }
    }
    if (found && !this.closed) this.events.emit("event", { type: "routes", routes: this.routes });
  }

  private async warmRoute(route: string): Promise<void> {
    if (route.includes("[")) return;
    try {
      await fetch(`${this.dev.url}${route}`, { signal: AbortSignal.timeout(120_000) });
    } catch {
      // The iframe will surface the compile state; warming is best effort.
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.dev.stop().catch(() => {});
    await this.workspace.destroy().catch(() => {});
    for (const temp of this.pendingAssets.values()) await fs.rm(temp, { force: true }).catch(() => {});
    this.events.emit("event", { type: "closed" });
  }

  private setPhase(phase: SessionPhase, message: string | null) {
    this.phase = phase;
    this.phaseMessage = message;
    this.events.emit("event", { type: "phase", phase, message });
  }

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */

  private async loadAliases(): Promise<void> {
    const raw = await readTextIfExists(path.join(this.project.root, "tsconfig.json")) ?? await readTextIfExists(path.join(this.project.root, "jsconfig.json"));
    if (!raw) return;
    try {
      const json = parseJsonc<{ compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }>(raw);
      const baseUrl = json.compilerOptions?.baseUrl ?? ".";
      for (const [pattern, targets] of Object.entries(json.compilerOptions?.paths ?? {})) {
        if (!pattern.endsWith("/*") || !targets[0]?.endsWith("/*")) continue;
        this.aliasPaths.push({ prefix: pattern.slice(0, -1), target: toPosix(path.join(baseUrl, targets[0].slice(0, -1))) });
      }
    } catch {
      // Invalid tsconfig: alias resolution simply becomes best effort.
    }
  }

  private async loadSourceFiles(): Promise<void> {
    const all = await this.workspace.listProjectFiles();
    for (const rel of all) {
      if (!SOURCE_EXTENSIONS.has(path.extname(rel))) continue;
      if (rel.startsWith("public/")) continue;
      if (/^(next\.config|framekit\.user\.config|postcss\.config|tailwind\.config|eslint\.config|vitest\.config|playwright\.config)/.test(rel)) continue;
      const content = await fs.readFile(path.join(this.project.root, rel), "utf8");
      this.files.set(rel, { draft: content, saved: content, savedHash: contentHash(content), parseError: null });
    }
    // Files outside the app that it imports (e.g. shared legal copy): editable text sources too.
    // Keyed relative to the app root (`../shared/legal.ts`), like the app's own imports see them.
    if (this.project.repoKind === "shared-files" && this.project.repoRoot) {
      for (const repoRel of this.project.sharedFiles) {
        if (!SOURCE_EXTENSIONS.has(path.extname(repoRel))) continue;
        const abs = path.join(this.project.repoRoot, repoRel);
        const content = await readTextIfExists(abs);
        if (content === null) continue;
        this.files.set(toPosix(path.relative(this.project.root, abs)), { draft: content, saved: content, savedHash: contentHash(content), parseError: null });
      }
    }
  }

  /** Absolute path on disk for a project file; files outside the app must stay inside its repo. */
  private async diskPath(rel: string): Promise<string> {
    if (rel.startsWith("../") && this.project.repoRoot) {
      return resolveInside(this.project.repoRoot, toPosix(path.relative(this.project.repoRoot, path.join(this.project.root, rel))));
    }
    return resolveInside(this.project.root, rel);
  }

  private async loadStylesheet(): Promise<void> {
    const existing = await readTextIfExists(path.join(this.project.root, this.stylesFile));
    if (existing !== null) {
      const { model, warnings } = parseStylesheet(existing);
      this.styles = model;
      this.warnings.push(...warnings);
      this.stylesSaved = existing;
      this.stylesSavedHash = contentHash(existing);
      this.stylesSavedExists = true;
    }
  }

  private buildImportGraph(): void {
    this.importers.clear();
    for (const [rel, file] of this.files) {
      let ast;
      try {
        ast = parseSource(file.draft, rel).ast;
      } catch {
        continue;
      }
      for (const stmt of ast.program.body) {
        if (!t.isImportDeclaration(stmt)) continue;
        const resolved = this.resolveImport(rel, stmt.source.value);
        if (!resolved) continue;
        if (!this.importers.has(resolved)) this.importers.set(resolved, new Set());
        this.importers.get(resolved)!.add(rel);
      }
    }
  }

  /** Per file: the styled elements it exports, and what it re-exports (see analyzeFile). */
  private styledExports = new Map<string, Pick<FileAnalysis, "exportedTags" | "reexports" | "reexportAll">>();

  /**
   * Record every file's styled exports before instrumenting, so `import { Title } from "@/ui"`
   * resolves no matter which file is instrumented first.
   */
  private buildStyledExports(): void {
    this.styledExports.clear();
    for (const [rel, file] of this.files) {
      try {
        const a = analyzeFile(parseSource(file.draft, rel).ast, rel);
        if (a.exportedTags.size || a.reexports.size || a.reexportAll.length) this.styledExports.set(rel, a);
      } catch {
        // unparseable files export nothing usable
      }
    }
  }

  /** The HTML tag an imported name renders, following re-exports (`index.ts` barrels) a few levels deep. */
  private resolveStyledExport(from: string, specifier: string, name: string, depth = 0): string | null {
    if (depth > 6) return null;
    const target = this.resolveImport(from, specifier);
    const entry = target ? this.styledExports.get(target) : undefined;
    if (!target || !entry) return null;
    const direct = entry.exportedTags.get(name);
    if (direct) return direct;
    const forward = entry.reexports.get(name);
    if (forward) return this.resolveStyledExport(target, forward.source, forward.imported, depth + 1);
    for (const source of entry.reexportAll) {
      const found = this.resolveStyledExport(target, source, name, depth + 1);
      if (found) return found;
    }
    return null;
  }

  private resolveImport(from: string, specifier: string): string | null {
    let base: string | null = null;
    if (specifier.startsWith(".")) base = toPosix(path.join(path.dirname(from), specifier));
    else {
      for (const alias of this.aliasPaths) {
        if (specifier.startsWith(alias.prefix)) {
          base = toPosix(path.join(alias.target, specifier.slice(alias.prefix.length)));
          break;
        }
      }
    }
    if (!base) return null;
    base = base.replace(/^\.\//, "");
    if (this.files.has(base)) return base;
    for (const ext of [".tsx", ".ts", ".jsx", ".js", ".mjs"]) {
      if (this.files.has(base + ext)) return base + ext;
      if (this.files.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
    }
    return null;
  }

  /**
   * A file is shared when its elements can render in more than one place: layouts and templates,
   * modules imported by several files, and anything imported (transitively) by a shared module.
   */
  private isShared(rel: string, seen = new Set<string>()): boolean {
    if (seen.has(rel)) return false;
    seen.add(rel);
    const base = path.basename(rel);
    if (/^(layout|template)\.(tsx|jsx|js|ts)$/.test(base)) return true;
    const importers = this.importers.get(rel);
    if (!importers || importers.size === 0) return false;
    if (importers.size > 1) return true;
    for (const importer of importers) if (this.isShared(importer, seen)) return true;
    return false;
  }

  /** Instrument a draft file for the workspace and refresh the element map for it. */
  private instrumentForWorkspace(rel: string, content: string): string | null {
    const file = this.files.get(rel);
    if (!file) return null;
    try {
      const injectBridge = rel === this.project.rootLayoutFile ? { editorOrigin: this.editorOrigin, source: readBridgeSource() } : undefined;
      const { code, analysis } = instrumentSource(content, rel, {
        injectBridge,
        resolveImportedTag: (source, name) => this.resolveStyledExport(rel, source, name),
      });
      this.analyses.set(rel, analysis);
      this.styledExports.set(rel, { exportedTags: analysis.exportedTags, reexports: analysis.reexports, reexportAll: analysis.reexportAll });
      file.parseError = null;
      this.replaceElementsForFile(rel, analysis);
      return code;
    } catch (error) {
      file.parseError = error instanceof SourceParseError ? error.message : String(error);
      this.analyses.delete(rel);
      this.replaceElementsForFile(rel, null);
      return null;
    }
  }

  private replaceElementsForFile(rel: string, analysis: FileAnalysis | null): void {
    for (const [id, info] of this.elements) if (info.file === rel) this.elements.delete(id);
    if (!analysis) return;
    const shared = this.isShared(rel);
    for (const el of analysis.elements) {
      if (!isInstrumentable(el)) continue;
      this.elements.set(el.id, describeElement(el, analysis, { shared }));
    }
  }

  private async syncFileToWorkspace(rel: string): Promise<void> {
    const file = this.files.get(rel);
    if (!file) return;
    const code = this.instrumentForWorkspace(rel, file.draft);
    await this.workspace.writeFile(rel, code ?? file.draft);
  }

  private async syncStylesheet(): Promise<void> {
    await this.workspace.writeFile(this.stylesFile, this.css);
  }

  /* ------------------------------------------------------------------ */
  /* Snapshot                                                            */
  /* ------------------------------------------------------------------ */

  get css(): string {
    return serializeStylesheet(this.styles);
  }

  get dirtyFiles(): string[] {
    const dirty: string[] = [];
    for (const [rel, file] of this.files) if (file.draft !== file.saved) dirty.push(rel);
    const cssNow = this.css;
    const stylesChanged = this.stylesSavedExists ? cssNow !== this.stylesSaved : Object.keys(this.styles).length > 0;
    if (stylesChanged) dirty.push(this.stylesFile);
    for (const asset of this.pendingAssets.keys()) dirty.push(`public/${asset}`);
    return dirty;
  }

  get isDirty(): boolean {
    return this.dirtyFiles.length > 0;
  }

  snapshot(): SessionSnapshot {
    return {
      phase: this.phase,
      phaseMessage: this.phaseMessage,
      error: this.error,
      project: {
        root: this.project.root,
        name: this.project.name,
        appDirRelative: this.project.appDirRelative,
        packageManager: this.project.packageManager,
        nextVersion: this.project.nextVersion,
      },
      routes: this.routes,
      hosted: hostedConfig() !== null,
      // Hosted: the browser reaches the preview through its public sandbox URL, not loopback.
      previewUrl: this.phase === "ready" ? (hostedConfig()?.previewPublicUrl ?? this.dev.url) : null,
      revision: this.revision,
      elements: [...this.elements.values()],
      css: this.css,
      styles: this.styles,
      isDirty: this.isDirty,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      dirtyFiles: this.dirtyFiles,
      devLog: this.dev.log,
      compileError: this.compileError,
      warnings: this.warnings,
    };
  }

  async refreshRoutes(): Promise<RouteInfo[]> {
    // Keep preview URLs found by warming; rediscovery only knows the patterns.
    const known = new Map(this.routes.map((r) => [r.pattern, r.previewPath]));
    this.routes = (await discoverRoutes(this.project)).map((r) => (known.get(r.pattern) ? { ...r, previewPath: known.get(r.pattern) } : r));
    return this.routes;
  }

  /* ------------------------------------------------------------------ */
  /* Commands                                                            */
  /* ------------------------------------------------------------------ */

  async apply(command: EditCommand, expectedRevision: number | undefined, groupKey: string | undefined): Promise<CommandResult> {
    if (this.phase !== "ready") throw new SessionError("The project preview isn't ready yet.", "NOT_READY", 409);
    if (expectedRevision !== undefined && expectedRevision !== this.revision) {
      throw new SessionError("The project changed since this edit was prepared. Refresh and try again.", "REVISION_MISMATCH", 409);
    }

    const touched = new Map<string, { before: string | null; after: string | null }>();
    const stylesBefore = this.styles;
    const warnings: string[] = [];
    let selectedId: string | null = null;

    const touch = (rel: string) => {
      if (!touched.has(rel)) touched.set(rel, { before: this.files.get(rel)?.draft ?? null, after: null });
    };
    const commit = (rel: string, code: string) => {
      touch(rel);
      const file = this.files.get(rel);
      if (file) file.draft = code;
      else this.files.set(rel, { draft: code, saved: null, savedHash: null, parseError: null });
      touched.get(rel)!.after = code;
    };

    const takenIds = this.collectStyleIds();
    const makeStyleId = makeStyleIdFactory(takenIds);
    let label: string = command.type;

    try {
      switch (command.type) {
        case "SET_TEXT": {
          const info = this.requireInfo(command.nodeId);
          if (!info.ops.setText.allowed) throw new SessionError(info.ops.setText.reason ?? "This text can't be edited.");
          const m = openForMutation(this.draftOf(info.file), info.file);
          const el = requireElement(m, info.id);
          setText(el, command.value);
          commit(info.file, finish(m));
          selectedId = info.id;
          label = "Edit text";
          break;
        }
        case "SET_ATTRIBUTE": {
          const info = this.requireInfo(command.nodeId);
          if (command.name === "href" || command.name === "src") this.assertSafeUrl(command.value);
          const m = openForMutation(this.draftOf(info.file), info.file);
          const el = requireElement(m, info.id);
          setAttribute(el, command.name, command.value);
          commit(info.file, finish(m));
          selectedId = info.id;
          label = `Change ${command.name}`;
          break;
        }
        case "SET_TAG": {
          const info = this.requireInfo(command.nodeId);
          if (!info.ops.setTag.allowed) throw new SessionError(info.ops.setTag.reason ?? "This element can't change its tag.");
          const m = openForMutation(this.draftOf(info.file), info.file);
          const el = requireElement(m, info.id);
          setTag(el, command.tag);
          commit(info.file, finish(m));
          selectedId = info.id;
          label = "Change heading level";
          break;
        }
        case "SET_STYLE": {
          const info = this.requireInfo(command.nodeId);
          if (command.value !== null) {
            const problem = validateDeclaration(command.property, command.value);
            if (problem) throw new SessionError(problem, "INVALID_VALUE");
          }
          let styleId = info.styleId;
          const needsAttr = !styleId;
          const inlineBlocks = info.inlineStyle?.kind === "static" && command.property in info.inlineStyle.values;
          if (needsAttr || inlineBlocks) {
            const m = openForMutation(this.draftOf(info.file), info.file);
            const el = requireElement(m, info.id);
            styleId = ensureStyleId(el, makeStyleId);
            if (inlineBlocks) {
              setInlineStyleProperty(el, command.property, null);
              warnings.push(`Removed the inline ${command.property} so the Framekit style applies.`);
            }
            commit(info.file, finish(m));
          }
          if (command.value !== null) await this.ensureStylesheetImport(commit);
          this.styles = setStyleRule(this.styles, styleId!, command.breakpoint, command.property, command.value);
          selectedId = info.id;
          label = `Style ${command.property}`;
          break;
        }
        case "ADD_NODE": {
          const info = this.requireInfo(command.targetId);
          const op = command.placement === "inside" ? info.ops.addInside : info.ops.addAfter;
          if (!op.allowed) throw new SessionError(op.reason ?? "Elements can't be added here.");
          const m = openForMutation(this.draftOf(info.file), info.file);
          const el = requireElement(m, info.id);
          const node = insertNewElement(el, command.placement, command.elementType, makeStyleId);
          const defaults = NEW_ELEMENT_STYLES[command.elementType];
          if (defaults) {
            const styleAttr = node.openingElement.attributes.find((a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: "data-fk-style" }));
            if (styleAttr && t.isStringLiteral(styleAttr.value)) {
              for (const [prop, value] of Object.entries(defaults)) this.styles = setStyleRule(this.styles, styleAttr.value.value, "desktop", prop, value);
              await this.ensureStylesheetImport(commit);
            }
          }
          if (command.elementType === "image") await this.ensurePlaceholderAsset();
          const after = analyzeFile(m.ast, info.file);
          selectedId = after.elements.find((e) => e.node === node)?.id ?? null;
          commit(info.file, finish(m));
          label = `Add ${catalogEntry(command.elementType).label.toLowerCase()}`;
          break;
        }
        case "SET_SOURCE_TEXT": {
          if (!this.files.has(command.file)) throw new SessionError(`Unknown file ${command.file}`, "NOT_FOUND", 404);
          const m = openForMutation(this.draftOf(command.file), command.file);
          try {
            setTextLiteral(m.ast, command.loc, command.expected, command.value, m.code);
          } catch (error) {
            if (error instanceof TextSourceError) throw new SessionError(error.message, "STALE_TEXT", 409);
            throw error;
          }
          commit(command.file, finish(m));
          label = "Edit text";
          break;
        }
        case "DELETE_NODE": {
          const info = this.requireInfo(command.nodeId);
          if (!info.ops.delete.allowed) throw new SessionError(info.ops.delete.reason ?? "This element can't be deleted.");
          const m = openForMutation(this.draftOf(info.file), info.file);
          const el = requireElement(m, info.id);
          const removedStyleIds = this.styleIdsWithin(el.node);
          deleteElement(el);
          commit(info.file, finish(m));
          this.styles = removeStyleIds(this.styles, removedStyleIds);
          selectedId = info.parentId;
          label = "Delete element";
          break;
        }
        case "DUPLICATE_NODE": {
          const info = this.requireInfo(command.nodeId);
          if (!info.ops.duplicate.allowed) throw new SessionError(info.ops.duplicate.reason ?? "This element can't be duplicated.");
          const m = openForMutation(this.draftOf(info.file), info.file);
          const el = requireElement(m, info.id);
          const copy = duplicateElement(el, makeStyleId);
          this.styles = copyStyleRules(this.styles, collectCopiedStyleIds(copy));
          const after = analyzeFile(m.ast, info.file);
          selectedId = after.elements.find((e) => e.node === copy)?.id ?? null;
          commit(info.file, finish(m));
          label = "Duplicate element";
          break;
        }
        case "MOVE_NODE": {
          const info = this.requireInfo(command.nodeId);
          const parentInfo = this.requireInfo(command.targetParentId);
          if (!info.ops.move.allowed) throw new SessionError(info.ops.move.reason ?? "This element can't be moved.");
          if (parentInfo.file !== info.file) throw new SessionError("Elements can't be moved between files.");
          if (parentInfo.repeated) throw new SessionError("This container is rendered from a list in React code.");
          const m = openForMutation(this.draftOf(info.file), info.file);
          const el = requireElement(m, info.id);
          const target = requireElement(m, parentInfo.id);
          if (isAncestor(el, target)) throw new SessionError("An element can't be moved inside itself.");
          moveElement(el, target, command.position);
          const after = analyzeFile(m.ast, info.file);
          selectedId = after.elements.find((e) => e.node === el.node)?.id ?? null;
          commit(info.file, finish(m));
          label = "Move element";
          break;
        }
      }
    } catch (error) {
      // Roll back any draft changes made before the failure.
      for (const [rel, change] of touched) {
        const file = this.files.get(rel);
        if (file && change.before !== null) file.draft = change.before;
        else if (change.before === null) this.files.delete(rel);
      }
      this.styles = stylesBefore;
      if (error instanceof MutationError) throw new SessionError(error.message, error.code);
      if (error instanceof SourceParseError) throw new SessionError(`The edit produced invalid code and was not applied. ${error.message}`, "INVALID_RESULT");
      throw error;
    }

    const stylesChanged = stylesBefore !== this.styles;
    const entry: HistoryEntry = { label, groupKey, files: touched, styles: { before: stylesBefore, after: this.styles }, createdAt: Date.now() };
    this.pushHistory(entry);

    await this.writeChanges([...touched.keys()], stylesChanged);
    this.revision++;
    this.events.emit("event", { type: "revision", revision: this.revision });
    this.scheduleAutosave();

    return {
      revision: this.revision,
      affectedFiles: [...touched.keys()],
      elements: this.elementsForFiles([...touched.keys()]),
      css: this.css,
      styles: this.styles,
      selectedId,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      isDirty: this.isDirty,
      dirtyFiles: this.dirtyFiles,
      warnings,
    };
  }

  private pushHistory(entry: HistoryEntry): void {
    this.redoStack = [];
    const last = this.undoStack[this.undoStack.length - 1];
    if (entry.groupKey && last && last.groupKey === entry.groupKey && entry.createdAt - last.createdAt < 60_000) {
      for (const [rel, change] of entry.files) {
        const existing = last.files.get(rel);
        if (existing) existing.after = change.after;
        else last.files.set(rel, change);
      }
      last.styles.after = entry.styles.after;
      last.createdAt = entry.createdAt;
      return;
    }
    this.undoStack.push(entry);
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  async undo(): Promise<CommandResult> {
    const entry = this.undoStack.pop();
    if (!entry) throw new SessionError("Nothing to undo.", "NOTHING_TO_UNDO");
    this.redoStack.push(entry);
    return this.restore(entry, "before");
  }

  async redo(): Promise<CommandResult> {
    const entry = this.redoStack.pop();
    if (!entry) throw new SessionError("Nothing to redo.", "NOTHING_TO_REDO");
    this.undoStack.push(entry);
    return this.restore(entry, "after");
  }

  private async restore(entry: HistoryEntry, side: "before" | "after"): Promise<CommandResult> {
    const affected: string[] = [];
    for (const [rel, change] of entry.files) {
      const content = change[side];
      const file = this.files.get(rel);
      if (content === null) {
        this.files.delete(rel);
        this.replaceElementsForFile(rel, null);
        await this.workspace.removeFile(rel);
      } else if (file) file.draft = content;
      else this.files.set(rel, { draft: content, saved: null, savedHash: null, parseError: null });
      affected.push(rel);
    }
    const stylesChanged = entry.styles.before !== entry.styles.after;
    this.styles = entry.styles[side];
    await this.writeChanges(affected.filter((rel) => this.files.has(rel)), stylesChanged);
    this.revision++;
    this.events.emit("event", { type: "revision", revision: this.revision });
    this.scheduleAutosave();
    return {
      revision: this.revision,
      affectedFiles: affected,
      elements: this.elementsForFiles(affected),
      css: this.css,
      styles: this.styles,
      selectedId: null,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      isDirty: this.isDirty,
      dirtyFiles: this.dirtyFiles,
      warnings: [],
    };
  }

  private async writeChanges(files: string[], stylesChanged: boolean): Promise<void> {
    for (const rel of files) await this.syncFileToWorkspace(rel);
    if (stylesChanged) await this.syncStylesheet();
  }

  private elementsForFiles(files: string[]): ElementInfo[] {
    const set = new Set(files);
    return [...this.elements.values()].filter((e) => set.has(e.file));
  }

  /** Literal lists per file, keyed by the draft they were read from. */
  private literalCache = new Map<string, { draft: string; literals: TextLiteral[] }>();

  /**
   * Find the source string behind rendered text that isn't editable on the element itself.
   * `texts` is the selected element's text, then its ancestors' (innermost first).
   */
  findTextSource(texts: string[]): TextSourceMatch[] {
    const literals: TextLiteral[] = [];
    for (const [rel, file] of this.files) {
      if (file.parseError) continue;
      let cached = this.literalCache.get(rel);
      if (!cached || cached.draft !== file.draft) {
        cached = { draft: file.draft, literals: collectTextLiterals(file.draft, rel) };
        this.literalCache.set(rel, cached);
      }
      literals.push(...cached.literals);
    }
    return findTextSources(literals, texts);
  }

  private requireInfo(id: string): ElementInfo {
    const info = this.elements.get(id);
    if (!info) throw new SessionError("Framekit couldn't identify the source for this element.", "NOT_FOUND", 404);
    return info;
  }

  private draftOf(rel: string): string {
    const file = this.files.get(rel);
    if (!file) throw new SessionError(`Unknown file ${rel}`, "NOT_FOUND", 404);
    return file.draft;
  }

  private collectStyleIds(): Set<string> {
    const ids = new Set(Object.keys(this.styles));
    for (const info of this.elements.values()) if (info.styleId) ids.add(info.styleId);
    return ids;
  }

  private styleIdsWithin(node: t.Node): string[] {
    const ids: string[] = [];
    t.traverseFast(node, (n) => {
      if (!t.isJSXElement(n)) return;
      for (const a of n.openingElement.attributes) {
        if (t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: "data-fk-style" }) && t.isStringLiteral(a.value)) ids.push(a.value.value);
      }
    });
    return ids;
  }

  private assertSafeUrl(value: string | boolean | null): void {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed === "") return;
    if (/^(javascript|data|vbscript|file):/i.test(trimmed)) throw new SessionError("That link scheme isn't allowed.", "INVALID_VALUE");
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^(https?|mailto|tel|sms):/i.test(trimmed)) {
      throw new SessionError("Only http, https, mailto and tel links are supported.", "INVALID_VALUE");
    }
  }

  /** Make the root layout import framekit/styles.css once. */
  private async ensureStylesheetImport(commit: (rel: string, code: string) => void): Promise<void> {
    const layoutRel = this.project.rootLayoutFile;
    const layout = this.files.get(layoutRel);
    if (!layout) return;
    const relImport = toPosix(path.relative(path.dirname(layoutRel), this.stylesFile));
    const specifier = relImport.startsWith(".") ? relImport : `./${relImport}`;
    if (layout.draft.includes(specifier)) return;
    const m = openForMutation(layout.draft, layoutRel);
    const body = m.ast.program.body;
    let lastImport = -1;
    body.forEach((stmt, i) => {
      if (t.isImportDeclaration(stmt)) lastImport = i;
    });
    const decl = t.importDeclaration([], t.stringLiteral(specifier));
    body.splice(lastImport + 1, 0, decl);
    commit(layoutRel, finish(m));
  }

  /* ------------------------------------------------------------------ */
  /* Assets                                                              */
  /* ------------------------------------------------------------------ */

  async addAsset(originalName: string, bytes: Buffer): Promise<string> {
    const ext = path.extname(originalName).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif"].includes(ext)) {
      throw new SessionError("Only PNG, JPG, GIF, SVG, WebP and AVIF images can be added.", "INVALID_VALUE");
    }
    const base = path.basename(originalName, ext).replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "image";
    let name = `${base}${ext}`;
    let counter = 2;
    while (
      (await fileExists(path.join(this.project.root, "public", "framekit", name))) ||
      this.pendingAssets.has(`framekit/${name}`)
    ) {
      name = `${base}-${counter++}${ext}`;
    }
    const publicRel = `framekit/${name}`;
    const temp = path.join(this.workspace.dir, ".framekit-assets", name);
    await ensureDir(path.dirname(temp));
    await fs.writeFile(temp, bytes);
    await this.workspace.writeFile(path.join("public", publicRel), bytes);
    this.pendingAssets.set(publicRel, temp);
    return `/${publicRel}`;
  }

  private async ensurePlaceholderAsset(): Promise<void> {
    const publicRel = "framekit/placeholder.svg";
    if (this.pendingAssets.has(publicRel) || (await fileExists(path.join(this.project.root, "public", publicRel)))) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#e5e5e5"/><path d="M0 400 220 180l140 140 90-80 190 160z" fill="#cfcfcf"/><circle cx="470" cy="110" r="46" fill="#cfcfcf"/></svg>\n`;
    const temp = path.join(this.workspace.dir, ".framekit-assets", "placeholder.svg");
    await ensureDir(path.dirname(temp));
    await fs.writeFile(temp, svg);
    await this.workspace.writeFile(path.join("public", publicRel), svg);
    this.pendingAssets.set(publicRel, temp);
  }

  async listPublicImages(): Promise<string[]> {
    const publicDir = path.join(this.project.root, "public");
    const result: string[] = [];
    const walk = async (dir: string) => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__framekit") continue;
          await walk(full);
        } else if (/\.(png|jpe?g|gif|svg|webp|avif)$/i.test(entry.name)) {
          result.push("/" + toPosix(path.relative(publicDir, full)));
        }
      }
    };
    await walk(publicDir);
    for (const pending of this.pendingAssets.keys()) result.push(`/${pending}`);
    return [...new Set(result)].sort();
  }

  /* ------------------------------------------------------------------ */
  /* Save                                                                */
  /* ------------------------------------------------------------------ */

  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Hosted mode saves drafts into the sandbox's copy of the site shortly after each change: the
   * sandbox may stop when idle, and only files survive that. Publish then commits them.
   */
  private scheduleAutosave(): void {
    if (!hostedConfig()) return;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      if (this.closed || !this.isDirty) return;
      this.save().catch((error) => console.error("[framekit] autosave failed:", error));
    }, 1500);
  }

  /** Save now if anything is unsaved (the launcher calls this before stopping an idle sandbox). */
  async flush(): Promise<boolean> {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    if (this.phase !== "ready" || !this.isDirty) return false;
    await this.save();
    return true;
  }

  async save(): Promise<{ files: string[]; backupDir: string | null }> {
    if (this.phase !== "ready") throw new SessionError("The project preview isn't ready yet.", "NOT_READY", 409);
    const changedFiles = [...this.files.entries()].filter(([, f]) => f.draft !== f.saved);
    const cssNow = this.css;
    const stylesChanged = this.stylesSavedExists ? cssNow !== this.stylesSaved : Object.keys(this.styles).length > 0;
    if (changedFiles.length === 0 && !stylesChanged && this.pendingAssets.size === 0) return { files: [], backupDir: null };

    for (const [rel, file] of changedFiles) {
      if (file.parseError) throw new SessionError(`${rel} has invalid syntax and can't be saved.`, "INVALID_DRAFT");
    }

    // Conflict detection: refuse to overwrite files that changed outside Framekit.
    const conflicts: string[] = [];
    for (const [rel, file] of changedFiles) {
      const onDisk = await readTextIfExists(path.join(this.project.root, rel));
      const diskHash = onDisk === null ? null : contentHash(onDisk);
      if (diskHash !== file.savedHash) conflicts.push(rel);
    }
    if (stylesChanged) {
      const onDisk = await readTextIfExists(path.join(this.project.root, this.stylesFile));
      const diskHash = onDisk === null ? null : contentHash(onDisk);
      if (diskHash !== this.stylesSavedHash) conflicts.push(this.stylesFile);
    }
    if (conflicts.length) {
      throw new SessionError(
        `${conflicts.length === 1 ? "This file" : "These files"} changed outside Framekit. Reload the project before saving: ${conflicts.join(", ")}`,
        "EXTERNAL_CHANGE",
        409,
      );
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupRoot = path.join(backupsDir(), shortHash(this.project.root), stamp);
    const manifest: Array<{ file: string; existed: boolean }> = [];

    const writes: Array<{ rel: string; content: string | Buffer }> = changedFiles.map(([rel, f]) => ({ rel, content: f.draft }));
    if (stylesChanged) writes.push({ rel: this.stylesFile, content: cssNow });
    for (const [publicRel, temp] of this.pendingAssets) writes.push({ rel: path.join("public", publicRel), content: await fs.readFile(temp) });

    for (const write of writes) {
      const target = await this.diskPath(write.rel);
      const existing = await readTextIfExists(target).catch(() => null);
      if (existing !== null) {
        // Files outside the app (`../shared/x.ts`) back up under `_outside/` instead of escaping.
        const backupPath = path.join(backupRoot, write.rel.replace(/^(\.\.\/)+/, "_outside/"));
        await ensureDir(path.dirname(backupPath));
        await fs.copyFile(target, backupPath);
      }
      manifest.push({ file: write.rel, existed: existing !== null });
    }
    if (manifest.length) {
      await ensureDir(backupRoot);
      await atomicWrite(path.join(backupRoot, "manifest.json"), JSON.stringify({ project: this.project.root, savedAt: stamp, files: manifest }, null, 2));
    }

    const written: string[] = [];
    try {
      for (const write of writes) {
        const target = await this.diskPath(write.rel);
        await atomicWrite(target, write.content);
        written.push(write.rel);
      }
    } catch (error) {
      throw new SessionError(
        `Couldn't save changes. ${written.length} of ${writes.length} files were written; backups are in ${backupRoot}. ${(error as Error).message}`,
        "WRITE_FAILED",
        500,
      );
    }

    for (const [, file] of changedFiles) {
      file.saved = file.draft;
      file.savedHash = contentHash(file.draft);
    }
    if (stylesChanged) {
      this.stylesSaved = cssNow;
      this.stylesSavedHash = contentHash(cssNow);
      this.stylesSavedExists = true;
    }
    for (const temp of this.pendingAssets.values()) await fs.rm(temp, { force: true }).catch(() => {});
    this.pendingAssets.clear();
    // Remember what Framekit wrote so Publish commits exactly these files and nothing else.
    await addPendingPublish(this.project.root, written.map(toPosix)).catch(() => {});
    // Saves can happen without the editor asking (hosted autosave): tell it the new state.
    this.events.emit("event", { type: "saved", files: written, isDirty: this.isDirty, dirtyFiles: this.dirtyFiles });
    return { files: written, backupDir: manifest.some((m) => m.existed) ? backupRoot : null };
  }
}

function isAncestor(candidate: { node: t.Node }, target: { ancestors: t.Node[] }): boolean {
  return target.ancestors.includes(candidate.node);
}

/** `/[locale]/privacy` -> `/privacy`; null for catch-alls or when nothing static is left. */
function withoutDynamicSegments(pattern: string): string | null {
  if (pattern.includes("[...") || pattern.includes("[[...")) return null;
  const path = "/" + pattern.split("/").filter((s) => s && !s.startsWith("[")).join("/");
  return path;
}
