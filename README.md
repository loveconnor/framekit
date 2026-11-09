# Framekit

Framekit is a local-first visual editor for existing Next.js App Router websites. Open a project
folder, click elements on the live site, change text, links, images, layout, spacing and
typography in an inspector, preview desktop, tablet and mobile, then save. Framekit writes
targeted changes back into your JSX and a small generated stylesheet. The project stays a normal
Next.js app and never depends on Framekit at runtime.

## Run it

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:3000>, paste the absolute path of a Next.js project and press Open project.
The project needs the App Router (`app/` or `src/app/`), TypeScript or JavaScript, and installed
dependencies. Pages Router projects and monorepos are not supported.

## What happens when you open a project

1. The project is validated: `package.json`, a `next` dependency, an App Router directory, a root
   layout with a native `<body>`, and `node_modules`.
2. A preview workspace is created under `~/.framekit/workspaces/`. Source files are copied with a
   `data-fk-id` attribute on every native JSX element so the browser can report which source
   element a DOM node came from. `node_modules` is cloned copy-on-write (APFS/btrfs), so the preview
   has an ordinary project layout. The project's `next.config` is kept and wrapped only to hide
   Next's dev indicator.
3. `next dev` starts on a free loopback port and the editor loads the page in an iframe. A small
   bridge script, served only inside the workspace, reports hover, selection, geometry, computed
   styles and the element tree over `postMessage`.
4. Every edit is applied to the draft source with Babel + Recast (formatting of untouched code is
   preserved), re-instrumented into the workspace, and picked up by Fast Refresh. Undo and redo
   replay file snapshots. Save writes the draft into the original project with backups in
   `~/.framekit/backups/`, refusing to overwrite files that changed outside Framekit.

## How styles are stored

Framekit never rewrites existing classes or CSS. The first style edit on an element adds a stable
`data-fk-style="fk-xxxx"` attribute and a rule in `framekit/styles.css` (or `src/framekit/styles.css`),
which the root layout imports once:

```css
[data-fk-style="fk-a82d"] { font-size: 56px; }
@media (max-width: 1023px) { [data-fk-style="fk-a82d"] { font-size: 48px; } }
@media (max-width: 767px)  { [data-fk-style="fk-a82d"] { font-size: 36px; } }
```

The inspector shows measured values in grey and Framekit overrides in blue. When existing CSS wins
over an override, the property shows a warning instead of pretending the edit worked.

## What is editable

| Source | Framekit |
| --- | --- |
| Static text in a native element (`<h1>Hello</h1>`) | Editable inline and in the inspector |
| Text from JavaScript (`<h1>{title}</h1>`) | Read-only, styles still editable |
| Static attributes (`href`, `src`, `alt`, `target`) | Editable; computed attributes are shown read-only |
| `next/image` and `next/link` | Treated as images and links; required props preserved |
| Elements inside `.map()` | Selectable and styleable as a template; no delete, duplicate or move |
| `{cond && <X/>}` | Styleable; delete removes the whole expression |
| Component roots and `{children}` holders | Protected from structural changes |
| Shared components and layouts | Edits are allowed with a warning that every instance changes |

## Keyboard

| Action | Shortcut |
| --- | --- |
| Save | ⌘S |
| Undo / Redo | ⌘Z / ⌘⇧Z |
| Delete selected element | Delete |
| Duplicate selected element | ⌘D |
| Edit text of the selection | Enter, or double-click on the canvas |
| Clear selection | Esc |
| Toggle preview | ⌘⇧P |

## Project layout

```
app/                 Framekit's own UI and API routes
components/editor/   toolbar, layers, canvas, overlay, context menu
components/inspector content, layout, spacing, size, typography, appearance sections
components/ui/       honestui primitives
lib/project/         validation, route discovery, dev-server process
lib/source/          parser, analysis, instrumentation, mutations
lib/preview/         workspace builder and the browser bridge script
lib/styles/          generated stylesheet model
lib/session/         editing session: drafts, history, save
store/               editor state (zustand)
fixtures/            test projects
tests/               vitest unit tests and Playwright e2e
```

## Tests

```bash
npm test          # unit tests for the source engine and session
npm run test:e2e  # drives the editor against a copy of fixtures/marketing-site
```

The fixture symlinks its `node_modules` to this repository's, so no extra install is needed.

## Not in scope

No accounts, cloud storage, publishing, CMS, AI assistants, animation editors or a custom
renderer. Framekit edits existing pages; it does not create routes.

## Hosted mode

Framekit can also run in a cloud sandbox next to one site's code and open from that site's admin dashboard, so people edit the site without installing anything. The Swipz dashboard's **Edit Site** tab does this with a Vercel Sandbox. Its backend runs `scripts/hosted/up.sh` in the sandbox, which clones the site, installs dependencies and builds Framekit, and only repeats steps whose inputs changed. The backend then starts Framekit with `FRAMEKIT_HOSTED=1`.

Hosted mode changes how Framekit behaves:

- **Access:** a short-lived link signed with `FRAMEKIT_ACCESS_SECRET` signs a person in and becomes a 12-hour session cookie. The cookie is partitioned, so it works inside the dashboard's iframe. API routes check the session and refuse mutations from other origins. Only origins in `FRAMEKIT_EMBED_ORIGINS` may embed the editor, and that list is fixed when Framekit is built.
- **One project:** Framekit opens `FRAMEKIT_PROJECT_ROOT` at startup. The project screen, folder browsing and switching projects are turned off.
- **Preview:** runs on `FRAMEKIT_PREVIEW_PORT` and is shown at `FRAMEKIT_PREVIEW_PUBLIC_URL`. That origin is allowed for Next's live reload.
- **Drafts:** edits save into the site's working tree about 1.5 seconds after each change. Only files survive a sandbox stop. **Publish** commits as the signed-in person.
- **Idle stop:** `GET /api/hosted/activity` and `POST /api/hosted/prepare-stop` use the `x-framekit-secret` header and let the launcher stop the sandbox when nobody has the editor open. `GET /api/hosted/health` reports whether Framekit is ready.

Nothing changes when `FRAMEKIT_HOSTED` isn't set.
