export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type ProjectInfo = {
  /** Absolute, real path of the original project. */
  root: string;
  name: string;
  /** Directory that contains `app` (either root or root/src). */
  sourceRoot: string;
  /** Absolute path to the App Router directory. */
  appDir: string;
  /** `app` or `src/app` relative to root, posix. */
  appDirRelative: string;
  packageManager: PackageManager;
  nextVersion: string;
  rootLayoutFile: string;
  /**
   * Set when the app depends on code outside its folder, so the preview copy must mirror more:
   * - `workspace`: the app is a package in an npm/yarn/pnpm/bun workspace; the whole repo is mirrored.
   * - `shared-files`: the app imports a few files outside its folder by relative path; only those are copied.
   */
  repoRoot: string | null;
  repoKind: "workspace" | "shared-files" | null;
  /** For `shared-files`: those files, relative to repoRoot, posix. */
  sharedFiles: string[];
};

export type RouteInfo = {
  /** URL pattern, e.g. `/blog/[slug]`. */
  pattern: string;
  /** Display name, e.g. Home, About, Blog post. */
  name: string;
  /** Route file relative to project root, posix. */
  file: string;
  dynamic: boolean;
  /**
   * A URL that renders this route, so choosing it opens right away: the pattern itself, or for a
   * dynamic route the pattern without its dynamic segments when the site serves that (an i18n
   * `[locale]` with a default). Found by loading the page once in the background.
   */
  previewPath?: string;
};

export type ProjectValidationError = {
  code:
    | "NOT_FOUND"
    | "NOT_READABLE"
    | "NO_PACKAGE_JSON"
    | "NOT_NEXT"
    | "PAGES_ROUTER"
    | "NO_APP_DIR"
    | "NO_ROUTES"
    | "MONOREPO"
    | "MISSING_DEPENDENCIES"
    | "NO_ROOT_LAYOUT"
    | "UNSUPPORTED_LAYOUT"
    | "PARSE_ERROR";
  message: string;
  detail?: string;
  suggestion?: string;
};

export class ProjectError extends Error {
  constructor(public readonly info: ProjectValidationError) {
    super(info.message);
  }
}
