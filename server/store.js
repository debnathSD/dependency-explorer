/**
 * GraphStore keeps an in-memory model of target-frontend:
 *   - the list of files (git-aware: tracked + untracked, minus .gitignore'd)
 *   - the parsed import references of every source file (cached by mtime+size)
 *   - the resolved file -> file dependency graph
 *
 * `sync()` is cheap to call repeatedly: it re-stats every file, re-parses only
 * the ones that changed, then re-resolves the graph from the cached references.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  EDGE_KINDS,
  PARSEABLE_SCRIPT,
  PARSEABLE_STYLE,
  extractReferences,
} from './parser.js';
import { Resolver } from './resolver.js';

const MAX_PARSE_BYTES = 2 * 1024 * 1024;
const MAX_VIEW_BYTES = 1024 * 1024;

/** Directories that are never part of the source tree, even outside git. */
const ALWAYS_IGNORED =
  /(?:^|\/)(?:node_modules|\.git|dist|coverage|\.cache|\.turbo)(?:\/|$)/;

const BINARY_EXT =
  /\.(?:png|jpe?g|gif|webp|ico|icns|bmp|tiff?|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp[34]|mov|webm|wasm|bin|xlsx?|docx?|pptx?|node|map)$/i;

const KIND_BIT = Object.fromEntries(EDGE_KINDS.map((k, i) => [k, 1 << i]));

export function isBinaryPath(file) {
  return BINARY_EXT.test(file);
}

export class GraphStore {
  /**
   * @param {string} root absolute path of target-frontend
   * @param {{exclude?: string[]}} [options] posix path prefixes (relative to root) to leave out
   */
  constructor(root, options = {}) {
    this.root = root;
    this.exclude = options.exclude || [];
    /** @type {Map<string, {mtimeMs: number, size: number, refs: object[]}>} */
    this.cache = new Map();
    /** @type {Map<string, {mtimeMs: number, size: number, pkg: object|null}>} */
    this.pkgCache = new Map();
    this.graph = null;
    this.graphHash = '';
    this.version = 0;
    this.tsconfigStamp = '';
    this.tsconfig = { paths: {}, baseUrl: '' };
  }

  // ---------------------------------------------------------------- listing

  listFiles() {
    let listed;
    try {
      const out = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        {
          cwd: this.root,
          maxBuffer: 256 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      listed = out.toString('utf8').split('\0').filter(Boolean);
    } catch {
      listed = this.walk('');
    }
    const seen = new Set();
    const result = [];
    for (const rel of listed) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (ALWAYS_IGNORED.test(rel)) continue;
      if (this.exclude.some(prefix => rel.startsWith(prefix))) continue;
      result.push(rel);
    }
    return result;
  }

  /** Fallback when the directory is not inside a git checkout. */
  walk(rel) {
    const out = [];
    for (const entry of fs.readdirSync(path.join(this.root, rel), {
      withFileTypes: true,
    })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (ALWAYS_IGNORED.test(child)) continue;
      if (entry.isDirectory()) out.push(...this.walk(child));
      else if (entry.isFile()) out.push(child);
    }
    return out;
  }

  git(args) {
    try {
      return execFileSync('git', args, {
        cwd: this.root,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString('utf8')
        .trim();
    } catch {
      return '';
    }
  }

  // ------------------------------------------------------------------- sync

  /**
   * Bring the model up to date with the working tree.
   * @returns {{added: string[], removed: string[], changed: string[], graphChanged: boolean}}
   */
  sync() {
    const started = Date.now();
    const listed = this.listFiles();
    const present = new Map(); // rel -> stat
    for (const rel of listed) {
      try {
        const st = fs.lstatSync(path.join(this.root, rel));
        if (st.isFile()) present.set(rel, st);
      } catch {
        // tracked but deleted in the working tree
      }
    }

    const added = [];
    const changed = [];
    for (const [rel, st] of present) {
      const prev = this.cache.get(rel);
      if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size)
        continue;
      (prev ? changed : added).push(rel);
      this.cache.set(rel, {
        mtimeMs: st.mtimeMs,
        size: st.size,
        refs: this.parse(rel, st.size),
      });
    }
    const removed = [];
    for (const rel of this.cache.keys()) {
      if (!present.has(rel)) {
        removed.push(rel);
        this.cache.delete(rel);
      }
    }

    this.refreshWorkspaceConfig();
    const graph = this.buildGraph();
    const hash = crypto
      .createHash('md5')
      .update(
        JSON.stringify([
          graph.files.map(f => f.p),
          graph.edges,
          graph.external,
          graph.unresolved,
        ]),
      )
      .digest('hex');
    const graphChanged = hash !== this.graphHash;
    this.graphHash = hash;
    graph.scanMs = Date.now() - started;
    graph.branch = this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
    graph.commit = this.git(['rev-parse', '--short', 'HEAD']);
    graph.generatedAt = new Date().toISOString();
    if (
      graphChanged ||
      added.length ||
      removed.length ||
      changed.length ||
      !this.graph
    ) {
      this.version += 1;
    }
    graph.version = this.version;
    this.graph = graph;
    return { added, removed, changed, graphChanged };
  }

  parse(rel, size) {
    if (size > MAX_PARSE_BYTES) return [];
    if (!PARSEABLE_SCRIPT.test(rel) && !PARSEABLE_STYLE.test(rel)) return [];
    try {
      const text = fs.readFileSync(path.join(this.root, rel), 'utf8');
      return extractReferences(rel, text);
    } catch {
      return [];
    }
  }

  // ------------------------------------------- workspaces / tsconfig loading

  readJsonCached(rel) {
    const abs = path.join(this.root, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      this.pkgCache.delete(rel);
      return null;
    }
    const prev = this.pkgCache.get(rel);
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size)
      return prev.pkg;
    let pkg = null;
    try {
      pkg = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      /* malformed package.json: treat as absent */
    }
    this.pkgCache.set(rel, { mtimeMs: st.mtimeMs, size: st.size, pkg });
    return pkg;
  }

  /** Workspace globs + `file:` deps from package.json -> package dirs. */
  discoverWorkspaces(files) {
    const rootPkg = this.readJsonCached('package.json') || {};
    const dirs = new Set();

    const globs = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : rootPkg.workspaces?.packages || [];
    for (const glob of globs) {
      const m = /^(.*)\/\*$/.exec(glob);
      if (m) {
        // 'packages/*' -> every dir directly under packages/ with a package.json
        for (const f of files) {
          if (f.startsWith(`${m[1]}/`) && f.endsWith('/package.json')) {
            const dir = f.slice(0, -'/package.json'.length);
            if (dir.split('/').length === m[1].split('/').length + 1)
              dirs.add(dir);
          }
        }
      } else {
        dirs.add(glob);
      }
    }
    for (const spec of Object.values({
      ...rootPkg.dependencies,
      ...rootPkg.devDependencies,
    })) {
      if (typeof spec === 'string' && spec.startsWith('file:')) {
        dirs.add(path.posix.normalize(spec.slice('file:'.length)));
      }
    }

    const workspaces = [];
    for (const dir of dirs) {
      const pkg = this.readJsonCached(`${dir}/package.json`);
      if (pkg?.name) {
        workspaces.push({
          name: pkg.name,
          dir,
          main: pkg.main,
          module: pkg.module,
        });
      }
    }
    return workspaces;
  }

  refreshWorkspaceConfig() {
    const tsconfigPath = path.join(this.root, 'tsconfig.json');
    try {
      const st = fs.statSync(tsconfigPath);
      const stamp = `${st.mtimeMs}:${st.size}`;
      if (stamp !== this.tsconfigStamp) {
        this.tsconfigStamp = stamp;
        const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        const opts = config?.compilerOptions || {};
        this.tsconfig = {
          paths: opts.paths || {},
          baseUrl: path.posix
            .normalize(opts.baseUrl || '.')
            .replace(/^\.$/, ''),
        };
      }
    } catch {
      /* no tsconfig: fall back to root-relative resolution only */
    }
  }

  // ------------------------------------------------------------------ graph

  buildGraph() {
    const paths = [...this.cache.keys()].sort();
    const index = new Map(paths.map((p, i) => [p, i]));
    const fileSet = new Set(paths);
    const workspaces = this.discoverWorkspaces(fileSet);
    const resolver = new Resolver(
      fileSet,
      workspaces,
      this.tsconfig.paths,
      this.tsconfig.baseUrl,
    );

    const edgeMap = new Map(); // "from>to" -> [from, to, mask, line]
    const external = {}; // fileIdx -> sorted unique package names
    const unresolved = {}; // fileIdx -> [[spec, line, kind]]
    const packageUsage = {}; // package -> number of files importing it

    for (const [from, { refs }] of this.cache) {
      if (!refs.length) continue;
      const fromIdx = index.get(from);
      const ext = new Set();
      for (const { spec, kind, line } of refs) {
        const res = resolver.resolve(from, spec);
        if (res.type === 'file') {
          const toIdx = index.get(res.target);
          if (toIdx === fromIdx) continue;
          const key = `${fromIdx}>${toIdx}`;
          const edge = edgeMap.get(key);
          if (edge) {
            edge[2] |= KIND_BIT[kind];
            edge[3] = Math.min(edge[3], line);
          } else {
            edgeMap.set(key, [fromIdx, toIdx, KIND_BIT[kind], line]);
          }
        } else if (res.type === 'external') {
          ext.add(res.pkg);
        } else {
          (unresolved[fromIdx] ||= []).push([spec, line, kind]);
        }
      }
      if (ext.size) {
        external[fromIdx] = [...ext].sort();
        for (const pkg of ext) packageUsage[pkg] = (packageUsage[pkg] || 0) + 1;
      }
    }

    const edges = [...edgeMap.values()].sort(
      (a, b) => a[0] - b[0] || a[1] - b[1],
    );
    return {
      root: this.root,
      files: paths.map(p => ({ p, s: this.cache.get(p).size })),
      edges,
      edgeKinds: EDGE_KINDS,
      external,
      unresolved,
      packageUsage,
      workspaces: workspaces.map(w => ({ name: w.name, dir: w.dir })),
    };
  }

  // ---------------------------------------------------------------- content

  /** Read a known file for display. Only files in the graph are served. */
  readFile(rel) {
    const entry = this.cache.get(rel);
    if (!entry) return null;
    const abs = path.join(this.root, rel);
    if (isBinaryPath(rel)) {
      return { path: rel, size: entry.size, binary: true, content: '' };
    }
    const fd = fs.openSync(abs, 'r');
    try {
      const len = Math.min(entry.size, MAX_VIEW_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      if (buf.subarray(0, 8000).includes(0)) {
        return { path: rel, size: entry.size, binary: true, content: '' };
      }
      return {
        path: rel,
        size: entry.size,
        binary: false,
        truncated: entry.size > MAX_VIEW_BYTES,
        content: buf.toString('utf8'),
      };
    } finally {
      fs.closeSync(fd);
    }
  }
}
