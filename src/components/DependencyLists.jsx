import { kindsOf, neighbors } from '../model.js';

function FileRow({ model, edge, onNavigate }) {
  const file = model.files[edge.to];
  return (
    <li>
      <button
        type="button"
        className="dep-row"
        onClick={() => onNavigate(file.p)}
        title={file.p}
      >
        <span className={`dot cat-${file.cat}`} aria-hidden="true" />
        <span className="dep-name">
          <span className="dep-dir">{file.dir}/</span>
          {file.name}
        </span>
        <span className="dep-kinds">
          {kindsOf(model, edge.mask).map(k => (
            <span key={k} className={`badge badge-${k}`}>
              {k}
            </span>
          ))}
          <span className="dep-line">:{edge.line}</span>
        </span>
      </button>
    </li>
  );
}

/** Direct imports (`out`) or direct importers (`in`) of one file. */
export function FileList({ model, fileIdx, direction, opts, onNavigate }) {
  const edges = neighbors(model, fileIdx, direction, opts);
  const unresolved =
    direction === 'out' ? model.payload.unresolved[fileIdx] || [] : [];
  const externals =
    direction === 'out' ? model.payload.external[fileIdx] || [] : [];
  if (!edges.length && !unresolved.length && !externals.length) {
    return (
      <p className="muted pad">
        {direction === 'out'
          ? 'This file imports no other project files.'
          : 'No project file imports this one.'}
      </p>
    );
  }
  return (
    <div className="dep-list">
      {edges.length > 0 && (
        <ul>
          {edges.map(e => (
            <FileRow
              key={e.to}
              model={model}
              edge={e}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
      {unresolved.length > 0 && (
        <>
          <h4 className="list-heading warn">
            Unresolved imports ({unresolved.length})
          </h4>
          <ul>
            {unresolved.map(([spec, line]) => (
              <li key={`${spec}:${line}`} className="dep-row static warn">
                <span className="dep-name">{spec}</span>
                <span className="dep-line">:{line}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {externals.length > 0 && (
        <>
          <h4 className="list-heading">npm packages ({externals.length})</h4>
          <ul>
            {externals.map(pkg => (
              <li key={pkg} className="dep-row static">
                <span className="dep-name">{pkg}</span>
                <span className="dep-line">
                  {model.payload.packageUsage[pkg]} files
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
