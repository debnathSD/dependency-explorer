import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileList } from './components/DependencyLists.jsx';
import FileViewer from './components/FileViewer.jsx';
import Header from './components/Header.jsx';
import Search from './components/Search.jsx';
import TreeView from './components/TreeView.jsx';
import { useFileContent, useGraph } from './hooks/useGraph.js';
import { layoutTree } from './layout.js';
import {
  ancestorsOf,
  buildDependencyTree,
  buildFolderTree,
  defaultExpanded,
  neighbors,
} from './model.js';
import { computeOverlay } from './overlay.js';

const MODES = [
  { id: 'folders', label: 'Folders' },
  { id: 'imports', label: 'Imports' },
  { id: 'importers', label: 'Imported by' },
];

const readHash = () => decodeURIComponent(window.location.hash.slice(1));

function depLabel(model, data) {
  const f = model.files[data.fileIdx];
  const parent = f.dir.slice(f.dir.lastIndexOf('/') + 1);
  return `${parent ? `${parent}/` : ''}${f.name}${data.dup ? ' ↩' : ''}${data.more ? ` +${data.more}` : ''}`;
}

export default function App() {
  const { model, error, connected, lastUpdate } = useGraph();
  const [opts, setOpts] = useState({ types: true, tests: true });
  const [mode, setMode] = useState('folders');
  const [depth, setDepth] = useState(2);
  const [showArcs, setShowArcs] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [selected, setSelected] = useState(readHash);
  const [focus, setFocus] = useState(readHash);
  const [tab, setTab] = useState('source');
  const [centerTick, setCenterTick] = useState(0);
  const [panelWidth, setPanelWidth] = useState(() =>
    Math.round(window.innerWidth * 0.42),
  );

  const tree = useMemo(
    () => (model ? buildFolderTree(model, opts) : null),
    [model, opts],
  );
  const expandedSet = useMemo(
    () => expanded || (tree ? defaultExpanded(tree) : new Set()),
    [expanded, tree],
  );

  const selectedFile = model?.byPath.get(selected) || null;
  const focusFile = model?.byPath.get(focus) || null;

  const reveal = useCallback(
    path => {
      if (!tree) return;
      const ids = ancestorsOf(tree, path);
      if (ids.length)
        setExpanded(
          prev => new Set([...(prev || defaultExpanded(tree)), ...ids]),
        );
      setCenterTick(t => t + 1);
    },
    [tree],
  );

  const selectFile = useCallback(
    (path, { revealInTree = false, refocus = true } = {}) => {
      setSelected(path);
      if (refocus) setFocus(path);
      window.history.replaceState(null, '', `#${encodeURIComponent(path)}`);
      if (revealInTree) reveal(path);
      else if (refocus) setCenterTick(t => t + (mode === 'folders' ? 0 : 1));
    },
    [reveal, mode],
  );

  // Deep links: reveal the file named in the URL once the graph has loaded,
  // and follow manual edits of the hash afterwards.
  const didInitialReveal = useRef(false);
  useEffect(() => {
    if (!tree || didInitialReveal.current) return;
    didInitialReveal.current = true;
    if (selected) reveal(selected);
  }, [tree, selected, reveal]);
  useEffect(() => {
    const onHashChange = () => selectFile(readHash(), { revealInTree: true });
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [selectFile]);

  const layout = useMemo(() => {
    if (!model || !tree) return null;
    if (mode === 'folders') {
      return layoutTree(
        tree.root,
        n => (n.isDir && expandedSet.has(n.id) ? n.children : null),
        n => (n.isDir ? `${n.name} (${n.count})` : n.name),
      );
    }
    if (!focusFile) return null;
    const { root } = buildDependencyTree(
      model,
      focusFile.i,
      mode === 'imports' ? 'out' : 'in',
      depth,
      opts,
    );
    return layoutTree(
      root,
      n => n.children,
      n => depLabel(model, n),
    );
  }, [model, tree, mode, expandedSet, focusFile, depth, opts]);

  const overlay = useMemo(
    () =>
      layout
        ? computeOverlay({
            model,
            mode,
            layout,
            tree,
            selectedIdx: selectedFile?.i,
            opts,
            showArcs,
          })
        : { marks: new Map(), arcs: [] },
    [model, mode, layout, tree, selectedFile, opts, showArcs],
  );

  const changedByUpdate = lastUpdate
    ? [...lastUpdate.changed, ...lastUpdate.added, ...lastUpdate.removed]
    : [];
  const refreshKey =
    lastUpdate && changedByUpdate.includes(selected)
      ? lastUpdate.at.getTime()
      : 0;
  const fileState = useFileContent(
    selectedFile ? selectedFile.p : null,
    refreshKey,
  );

  const importLines = useMemo(() => {
    const map = new Map();
    if (!model || !selectedFile) return map;
    for (const e of model.out[selectedFile.i]) {
      const list = map.get(e.line) || [];
      list.push({ target: model.files[e.to].p });
      map.set(e.line, list);
    }
    return map;
  }, [model, selectedFile]);

  const handleToggle = useCallback(
    node => {
      const id = node.data.id;
      setExpanded(prev => {
        const next = new Set(prev || expandedSet);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [expandedSet],
  );

  const handleActivate = useCallback(
    (node, isDoubleClick) => {
      if (node.data.isDir) {
        handleToggle(node);
        return;
      }
      setTab('source');
      if (mode === 'folders') selectFile(model.files[node.data.fileIdx].p);
      else {
        selectFile(model.files[node.data.fileIdx].p, {
          refocus: Boolean(isDoubleClick),
        });
        if (isDoubleClick) setCenterTick(t => t + 1);
      }
    },
    [handleToggle, mode, model, selectFile],
  );

  const startResize = e => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const onMove = ev =>
      setPanelWidth(
        Math.min(
          Math.max(window.innerWidth - ev.clientX, 320),
          window.innerWidth - 320,
        ),
      );
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (error && !model)
    return (
      <div className="fatal">Could not load the dependency graph: {error}</div>
    );
  if (!model || !tree)
    return <div className="fatal">Scanning superset-frontend…</div>;

  const outCount = selectedFile
    ? neighbors(model, selectedFile.i, 'out', opts).length
    : 0;
  const inCount = selectedFile
    ? neighbors(model, selectedFile.i, 'in', opts).length
    : 0;
  const tabs = [
    { id: 'source', label: 'Source' },
    { id: 'out', label: `Imports (${outCount})` },
    { id: 'in', label: `Imported by (${inCount})` },
  ];
  const pick = path => selectFile(path, { revealInTree: true });
  const pickFromSearch = path => {
    setTab('source');
    pick(path);
  };

  return (
    <div className="app">
      <Header model={model} connected={connected} lastUpdate={lastUpdate} />
      <div className="toolbar">
        <Search model={model} onPick={pickFromSearch} />
        <div className="segmented" role="group" aria-label="Tree mode">
          {MODES.map(m => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id}
              onClick={() => {
                setMode(m.id);
                setCenterTick(t => t + 1);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mode === 'folders' ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded(new Set([tree.root.id]))}
            >
              Collapse all
            </button>
            <button
              type="button"
              onClick={() => setExpanded(new Set(tree.byId.keys()))}
            >
              Expand all
            </button>
            <label>
              <input
                type="checkbox"
                checked={showArcs}
                onChange={e => setShowArcs(e.target.checked)}
              />{' '}
              Dependency arcs
            </label>
          </>
        ) : (
          <label>
            Depth {depth}
            <input
              type="range"
              min="1"
              max="8"
              value={depth}
              onChange={e => setDepth(Number(e.target.value))}
            />
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={opts.types}
            onChange={e => setOpts({ ...opts, types: e.target.checked })}
          />{' '}
          Type-only imports
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.tests}
            onChange={e => setOpts({ ...opts, tests: e.target.checked })}
          />{' '}
          Tests &amp; stories
        </label>
      </div>
      <main className="main">
        <section className="tree-pane" aria-label="Dependency tree">
          {layout ? (
            <TreeView
              layout={layout}
              marks={overlay.marks}
              arcs={overlay.arcs}
              centerKey={mode === 'folders' ? selected : undefined}
              centerTick={centerTick}
              onActivate={handleActivate}
              onToggle={handleToggle}
            />
          ) : (
            <div className="viewer-empty">
              Pick a file (search, or switch to Folders) to see its dependency
              tree.
            </div>
          )}
          <Legend mode={mode} />
        </section>
        <div
          className="splitter"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startResize}
        />
        <aside
          className="side"
          style={{ width: panelWidth }}
          aria-label="Selected file"
        >
          <div className="side-head">
            <h2 title={selected}>
              {selectedFile ? selectedFile.p : 'No file selected'}
            </h2>
            {selectedFile && (
              <div role="tablist" className="tabs">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {selected && !selectedFile && (
            <div className="viewer-empty">
              {selected} is no longer in the project.
            </div>
          )}
          {selectedFile && tab === 'source' && (
            <FileViewer
              path={selectedFile.p}
              state={fileState}
              absolutePath={`${model.payload.root}/${selectedFile.p}`}
              importLines={importLines}
              onNavigate={pick}
            />
          )}
          {selectedFile && tab !== 'source' && (
            <FileList
              model={model}
              fileIdx={selectedFile.i}
              direction={tab}
              opts={opts}
              onNavigate={pick}
            />
          )}
          {!selected && (
            <div className="viewer-empty">
              Select a file in the tree to see its source and dependencies.
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function Legend({ mode }) {
  return (
    <div className="legend" aria-label="Legend">
      <span>
        <i className="dot cat-component" /> component (.tsx/.jsx)
      </span>
      <span>
        <i className="dot cat-module" /> module (.ts/.js)
      </span>
      <span>
        <i className="dot cat-style" /> style
      </span>
      <span>
        <i className="dot cat-other" /> other
      </span>
      {mode === 'folders' && (
        <>
          <span>
            <i className="swatch swatch-out" /> imports
          </span>
          <span>
            <i className="swatch swatch-in" /> imported by
          </span>
          <span className="muted">
            dashed = type-only / inside a collapsed folder
          </span>
        </>
      )}
      {mode !== 'folders' && (
        <span className="muted">
          ↩ already shown above · +N more beyond depth · double-click to
          re-root
        </span>
      )}
    </div>
  );
}
