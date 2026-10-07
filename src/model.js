/**
 * Client-side model derived from the /api/graph payload.
 *
 * Payload shape (see server/store.js):
 *   files:      [{p: 'src/a/b.tsx', s: sizeBytes}]
 *   edges:      [[fromIdx, toIdx, kindMask, firstLine]]
 *   edgeKinds:  ['import', 'reexport', 'dynamic', 'require', 'url', 'style', 'type']
 *   external:   {fileIdx: ['react', 'lodash', ...]}
 *   unresolved: {fileIdx: [[spec, line, kind]]}
 */

const TEST_RE =
  /(?:\.(?:test|spec|stories)\.[cm]?[jt]sx?$)|(?:(?:^|\/)(?:__tests__|__mocks__|spec|cypress-base|test)\/)/;

export const CATEGORIES = {
  component: { label: 'Component (.tsx / .jsx)', cssVar: '--c-component' },
  module: { label: 'Module (.ts / .js)', cssVar: '--c-module' },
  style: { label: 'Style (.less / .css / .scss)', cssVar: '--c-style' },
  other: { label: 'Other (json, md, assets…)', cssVar: '--c-other' },
};

function categoryOf(name) {
  if (/\.[jt]sx$/.test(name)) return 'component';
  if (/\.(?:[cm]?[jt]s)$/.test(name)) return 'module';
  if (/\.(?:less|css|scss|sass)$/.test(name)) return 'style';
  return 'other';
}

export function buildModel(payload) {
  const kindBit = Object.fromEntries(
    payload.edgeKinds.map((k, i) => [k, 1 << i]),
  );
  const files = payload.files.map((f, i) => {
    const slash = f.p.lastIndexOf('/');
    const name = f.p.slice(slash + 1);
    return {
      i,
      p: f.p,
      name,
      dir: slash < 0 ? '' : f.p.slice(0, slash),
      size: f.s,
      cat: categoryOf(name),
      isTest: TEST_RE.test(f.p),
    };
  });
  const out = files.map(() => []);
  const inn = files.map(() => []);
  for (const [from, to, mask, line] of payload.edges) {
    out[from].push({ to, mask, line });
    inn[to].push({ to: from, mask, line });
  }
  return {
    payload,
    files,
    out,
    inn,
    kindBit,
    typeBit: kindBit.type,
    byPath: new Map(files.map(f => [f.p, f])),
  };
}

export function kindsOf(model, mask) {
  return model.payload.edgeKinds.filter((_, i) => mask & (1 << i));
}

/** Neighbour list honouring the toolbar filters, sorted by path. */
export function neighbors(model, idx, direction, opts) {
  const list = direction === 'out' ? model.out[idx] : model.inn[idx];
  return list
    .filter(e => {
      if (!opts.types && e.mask === model.typeBit) return false;
      if (!opts.tests && model.files[e.to].isTest) return false;
      return true;
    })
    .sort((a, b) => (model.files[a.to].p < model.files[b.to].p ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Folder tree
// ---------------------------------------------------------------------------

/**
 * Builds the directory tree. Single-child directory chains are merged
 * ('a' > 'b' > 'c' becomes 'a/b/c'), like VS Code's compact folders.
 * Every leaf is a file.
 */
export function buildFolderTree(model, opts) {
  const root = {
    id: '',
    name: 'superset-frontend',
    isDir: true,
    children: [],
    parent: null,
  };
  const dirs = new Map([['', root]]);

  const dirFor = dirPath => {
    let node = dirs.get(dirPath);
    if (node) return node;
    const slash = dirPath.lastIndexOf('/');
    const parent = dirFor(slash < 0 ? '' : dirPath.slice(0, slash));
    node = {
      id: dirPath,
      name: dirPath.slice(slash + 1),
      isDir: true,
      children: [],
      parent,
    };
    parent.children.push(node);
    dirs.set(dirPath, node);
    return node;
  };

  for (const f of model.files) {
    if (!opts.tests && f.isTest) continue;
    const parent = dirFor(f.dir);
    parent.children.push({
      id: f.p,
      name: f.name,
      isDir: false,
      fileIdx: f.i,
      cat: f.cat,
      parent,
    });
  }

  const finish = node => {
    if (!node.isDir) return 1;
    node.children.sort((a, b) =>
      a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name),
    );
    // compact chains of single-child directories
    while (
      node.parent &&
      node.children.length === 1 &&
      node.children[0].isDir
    ) {
      const only = node.children[0];
      node.id = only.id;
      node.name = `${node.name}/${only.name}`;
      node.children = only.children;
      node.children.forEach(c => {
        c.parent = node;
      });
    }
    node.count = node.children.reduce((n, c) => n + finish(c), 0);
    return node.count;
  };
  finish(root);

  const byId = new Map();
  const index = node => {
    byId.set(node.id, node);
    if (node.isDir) node.children.forEach(index);
  };
  index(root);
  return { root, byId };
}

/** Directory ids that should start expanded: the root and its children. */
export function defaultExpanded(tree) {
  const set = new Set([tree.root.id]);
  tree.root.children.forEach(c => c.isDir && set.add(c.id));
  return set;
}

/** Every ancestor directory id of a file (for revealing it in the tree). */
export function ancestorsOf(tree, filePath) {
  const ids = [];
  let node = tree.byId.get(filePath)?.parent;
  while (node) {
    ids.push(node.id);
    node = node.parent;
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Dependency tree (imports / imported-by) rooted at a single file
// ---------------------------------------------------------------------------

/**
 * Breadth-first expansion: a file is expanded only where it first appears;
 * later occurrences are shown as leaves flagged `dup` so cycles and diamond
 * dependencies can never blow the tree up.
 */
export function buildDependencyTree(model, rootIdx, direction, maxDepth, opts) {
  const rootFile = model.files[rootIdx];
  const root = {
    id: 'r',
    fileIdx: rootIdx,
    name: rootFile.name,
    cat: rootFile.cat,
    tooltip: rootFile.p,
    depth: 0,
    children: [],
  };
  const seen = new Set([rootIdx]);
  let level = [root];
  let counter = 0;
  for (let depth = 0; depth < maxDepth && level.length; depth += 1) {
    const next = [];
    for (const node of level) {
      for (const e of neighbors(model, node.fileIdx, direction, opts)) {
        const f = model.files[e.to];
        counter += 1;
        const child = {
          id: `n${counter}`,
          fileIdx: e.to,
          name: f.name,
          cat: f.cat,
          tooltip: `${f.p}\n${kindsOf(model, e.mask).join(', ')} (line ${e.line})`,
          depth: depth + 1,
          mask: e.mask,
          line: e.line,
          children: [],
        };
        if (seen.has(e.to)) child.dup = true;
        else {
          seen.add(e.to);
          next.push(child);
        }
        node.children.push(child);
      }
    }
    level = next;
  }
  // Leaves at the depth limit that still have neighbours get a "+N" hint.
  const mark = node => {
    if (!node.children.length && !node.dup) {
      const more = neighbors(model, node.fileIdx, direction, opts).length;
      if (more) node.more = more;
    }
    node.children.forEach(mark);
  };
  mark(root);
  return { root, size: seen.size };
}
