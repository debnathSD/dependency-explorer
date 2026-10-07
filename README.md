# superset-frontend dependency explorer

An interactive, **live** map of every file in `superset-frontend/` and how the
files import each other. Built for frontend devs who want to answer
"what does this file depend on?" and "what breaks if I change it?" without grepping.

```bash
cd superset-frontend/tools/dependency-explorer
npm install        # once; this tool has its own dependencies and is not part of the app's workspaces
npm run dev        # http://localhost:5177   (PORT=xxxx npm run dev to change)
```

Needs Node 18+. The first scan takes ~3 s for ~5,300 files.

## Using it

| Do this | To get |
| --- | --- |
| Click a **folder** | expand / collapse it (single-child folder chains are merged, e.g. `src/dashboard/components`) |
| Click a **file** (a leaf) | its full source on the right, syntax highlighted |
| Look at the tree | the selected file is outlined; files it **imports** are blue, files that **import it** are orange; arcs connect them (dashed = type-only import, or target hidden inside a collapsed folder) |
| **Imports** / **Imported by** modes | re-roots the tree at the selected file and shows its transitive dependencies / dependents (depth slider). `↩` marks a file already shown higher up (cycles and diamonds never explode the tree); `+N` means N more beyond the depth limit. Double-click a node to re-root there. |
| Gutter `24 →` in the source view | that line imports a project file; click to jump to it |
| **Imports** / **Imported by** tabs | flat lists with the import kind and line number, plus npm packages and **unresolved** imports |
| Search box | fuzzy path search (`dashboard header index`); reveals and selects the file |
| Wheel / drag | scroll and pan the tree. **Ctrl/Cmd + wheel** (or pinch) zooms |
| URL hash | `#src%2Futils%2FtextUtils.ts` deep-links to a file — paste it to a teammate |

Filters: **Type-only imports** (`import type` / `import { type X }`) and **Tests & stories**
can be switched off to see only the runtime, non-test graph.

## Staying up to date

The dev server watches `superset-frontend/` (chokidar). When files are saved, created, deleted,
or the working tree changes through `git checkout` / `pull` / `merge`, it debounces (350 ms),
re-lists files through git, re-parses **only the files whose mtime/size changed**, re-resolves
the graph and pushes the result to every open browser tab over Server-Sent Events. The header
shows the branch, commit and the last update ("Updated 18:01:25 · 1 changed"); the open file's
source refreshes in place. On network drives or in containers where file events don't fire, start
with `DEP_EXPLORER_POLL=1 npm run dev`.

## How the dependencies are computed (and how accurate they are)

- **Files**: `git ls-files --cached --others --exclude-standard`, so tracked and new untracked
  files appear, `.gitignore`d output (`node_modules`, `dist`, …) does not. This tool's own folder is left out.
- **Parsing**: the real TypeScript parser (syntax only) on `.ts/.tsx/.js/.jsx/.mjs/.cjs`, so imports in
  strings and comments are never counted. Captured: `import`, `import type`, `export … from`,
  `import()`, `require()`, `import x = require()`, `import('x').T` types,
  `new URL('./x', import.meta.url)` (workers) and `@import` in `.less/.scss/.css`.
- **Resolution** mirrors `webpack.config.js` + `tsconfig.json`: relative paths, extension probing
  (`.ts .tsx .js .jsx …`), directory `index` files, `@superset-ui/*` → `<package>/src`, tsconfig
  `paths`, `baseUrl` imports (`src/…`, `spec/…`), and other workspace packages via their `package.json`.
  Everything else is reported as an npm package.
- **Broken imports** (target file doesn't exist) are listed as *unresolved* rather than silently
  dropped — currently ~25 in the repo, all genuinely missing files (plus git-ignored build output
  such as `packages/ai1/copilot_package/dist`).

What it does *not* see: imports assembled at runtime (`require(variable)`), `require.context`,
`jest.mock()` paths, and CSS-in-JS class references. It maps **file-to-file** imports; it does not
analyse which React component renders which inside a file.

Check resolution quality without the UI:

```bash
npm run scan -- --unresolved          # summary + every unresolved import
npm run scan -- --json graph.json     # dump the full graph
npm test                              # parser + resolver unit tests
```

## Layout

```
server/parser.js    TypeScript-AST import extraction
server/resolver.js  webpack/tsconfig-style module resolution (against an in-memory file set)
server/store.js     file listing, mtime cache, graph building, file reads
server/plugin.js    Vite plugin: /api/graph, /api/file, /api/events (SSE) + file watcher
src/                React + d3 UI (model.js, layout.js, overlay.js, components/)
```

The API only serves files that are part of the graph, and Vite binds to `localhost` by default —
don't pass `--host` unless you are happy to share the source tree on your network.

`npm run build` produces a static UI in `dist/`, but the API needs the dev server, so use `npm run dev`.
