/**
 * Resolves an import specifier to a file inside superset-frontend, mirroring
 * the rules webpack (webpack.config.js) and TypeScript (tsconfig.json) use:
 *
 *   1. relative specifiers          ./x, ../x
 *   2. workspace aliases            @superset-ui/core -> packages/superset-ui-core/src
 *   3. tsconfig `paths`             (wildcard patterns)
 *   4. tsconfig `baseUrl` / webpack `modules: [APP_DIR]`
 *                                   'src/components/Foo' -> <root>/src/components/Foo
 *   5. workspace packages by name   'blocknote-editor' -> packages/blocknote-editor (package.json main)
 *   6. anything else is an external npm package (or a node builtin)
 *
 * It resolves against an in-memory set of known files, never the disk, so a
 * full re-resolve of the whole graph after a file is added/removed is cheap.
 */
import { builtinModules } from 'node:module';
import path from 'node:path';

const posix = path.posix;

// webpack `resolve.extensions` plus the ones TypeScript / Node also accept.
const EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.d.ts',
];
// TypeScript allows `import './x.js'` to mean `./x.ts`.
const JS_TO_TS = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

const BUILTINS = new Set(builtinModules);

/** '@scope/pkg/deep/path' -> '@scope/pkg', 'lodash/get' -> 'lodash' */
export function packageNameOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export class Resolver {
  /**
   * @param {Set<string>} files   posix paths relative to the frontend root
   * @param {{name: string, dir: string, main?: string, module?: string}[]} workspaces
   * @param {Record<string, string[]>} tsPaths   tsconfig `compilerOptions.paths`
   * @param {string} baseUrl   tsconfig baseUrl, relative to root ('' == root)
   */
  constructor(files, workspaces = [], tsPaths = {}, baseUrl = '') {
    this.files = files;
    this.baseUrl = baseUrl;
    this.workspaces = [...workspaces].sort(
      (a, b) => b.name.length - a.name.length,
    );

    // Longest alias first so '@superset-ui/core' wins over a shorter prefix.
    this.aliases = [];
    for (const ws of this.workspaces) {
      // webpack.config.js: every @superset-ui/* workspace that has a src/
      // directory is aliased straight to its TypeScript sources.
      if (ws.name.startsWith('@superset-ui/') && this.hasDir(`${ws.dir}/src`)) {
        this.aliases.push({ from: ws.name, to: `${ws.dir}/src` });
      }
    }

    this.tsPaths = Object.entries(tsPaths).map(([pattern, targets]) => {
      const star = pattern.indexOf('*');
      return {
        prefix: star === -1 ? pattern : pattern.slice(0, star),
        suffix: star === -1 ? '' : pattern.slice(star + 1),
        wildcard: star !== -1,
        targets,
      };
    });

    this.dirIndex = null;
  }

  hasDir(dir) {
    if (!this.dirIndex) {
      this.dirIndex = new Set();
      for (const f of this.files) {
        let d = posix.dirname(f);
        while (d !== '.' && !this.dirIndex.has(d)) {
          this.dirIndex.add(d);
          d = posix.dirname(d);
        }
      }
    }
    return this.dirIndex.has(dir);
  }

  /** Try `base` as file, file+ext, directory index, or package main. */
  tryPath(base) {
    base = posix.normalize(base).replace(/\/+$/, '');
    if (base === '.') base = '';
    if (base.startsWith('../') || base === '..') return null;
    if (base && this.files.has(base)) return base;

    for (const ext of EXTENSIONS) {
      if (base && this.files.has(base + ext)) return base + ext;
    }
    const ext = posix.extname(base);
    if (JS_TO_TS[ext]) {
      const stem = base.slice(0, -ext.length);
      for (const alt of JS_TO_TS[ext]) {
        if (this.files.has(stem + alt)) return stem + alt;
      }
    }
    const prefix = base ? `${base}/` : '';
    for (const e of EXTENSIONS) {
      if (this.files.has(`${prefix}index${e}`)) return `${prefix}index${e}`;
    }
    return null;
  }

  resolveWorkspaceEntry(ws, rest) {
    if (rest) {
      return (
        this.tryPath(`${ws.dir}/${rest}`) ||
        this.tryPath(`${ws.dir}/src/${rest}`)
      );
    }
    for (const entry of [ws.module, ws.main]) {
      if (entry) {
        const hit = this.tryPath(`${ws.dir}/${entry}`);
        if (hit) return hit;
      }
    }
    return this.tryPath(`${ws.dir}/src`) || this.tryPath(ws.dir);
  }

  /**
   * @param {string} from  importing file (posix, relative to root)
   * @param {string} rawSpec
   * @returns {{type: 'file', target: string}
   *   | {type: 'external', pkg: string}
   *   | {type: 'unresolved'}}
   */
  resolve(from, rawSpec) {
    // Strip webpack loader prefixes ('!!raw-loader!./x') and query strings.
    let spec = rawSpec
      .slice(rawSpec.lastIndexOf('!') + 1)
      .replace(/[?#].*$/, '');
    if (!spec) return { type: 'unresolved' };

    if (spec.startsWith('.')) {
      const hit = this.tryPath(posix.join(posix.dirname(from), spec));
      return hit ? { type: 'file', target: hit } : { type: 'unresolved' };
    }
    if (/^(?:https?:|data:|blob:|\/\/)/.test(spec)) {
      return { type: 'external', pkg: spec.split(':')[0] + ':' };
    }
    if (spec.startsWith('node:') || BUILTINS.has(spec.split('/')[0])) {
      return {
        type: 'external',
        pkg: spec.startsWith('node:') ? spec : spec.split('/')[0],
      };
    }
    if (spec.startsWith('/')) spec = spec.slice(1);

    // 2. workspace aliases (exact or prefix + '/')
    for (const { from: name, to } of this.aliases) {
      if (spec === name || spec.startsWith(`${name}/`)) {
        const hit = this.tryPath(posix.join(to, spec.slice(name.length)));
        if (hit) return { type: 'file', target: hit };
      }
    }

    // 3. tsconfig paths
    for (const p of this.tsPaths) {
      const matches = p.wildcard
        ? spec.length >= p.prefix.length + p.suffix.length &&
          spec.startsWith(p.prefix) &&
          spec.endsWith(p.suffix)
        : spec === p.prefix;
      if (!matches) continue;
      const captured = p.wildcard
        ? spec.slice(p.prefix.length, spec.length - p.suffix.length)
        : '';
      for (const target of p.targets) {
        const hit = this.tryPath(
          posix.join(this.baseUrl, target.replace('*', captured)),
        );
        if (hit) return { type: 'file', target: hit };
      }
    }

    // 5. workspace package by name (checked before baseUrl so that a package
    //    called e.g. 'src' can never be shadowed by accident).
    for (const ws of this.workspaces) {
      if (spec === ws.name || spec.startsWith(`${ws.name}/`)) {
        const hit = this.resolveWorkspaceEntry(
          ws,
          spec.slice(ws.name.length + 1),
        );
        if (hit) return { type: 'file', target: hit };
      }
    }

    // 4. baseUrl / webpack `modules: [APP_DIR]`
    const hit = this.tryPath(posix.join(this.baseUrl, spec));
    if (hit) return { type: 'file', target: hit };

    // A bare specifier whose first segment is a real top-level directory
    // ('src/...', 'spec/...') was meant to be local: report it as broken
    // rather than silently calling it an npm package.
    const first = spec.split('/')[0];
    if (this.hasDir(posix.join(this.baseUrl, first)))
      return { type: 'unresolved' };

    return { type: 'external', pkg: packageNameOf(spec) };
  }
}
