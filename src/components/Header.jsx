const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
import { useAppearance } from '../theme.js';

function describeUpdate({ counts, at }) {
  const parts = [];
  if (counts.changed) parts.push(`${counts.changed} changed`);
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  return `${timeFormat.format(at)} · ${parts.join(', ') || 'branch switched'}`;
}

export default function Header({ model, connected, lastUpdate }) {
  const { payload } = model;
  const unresolved = Object.values(payload.unresolved).reduce(
    (n, l) => n + l.length,
    0,
  );
  const [appearance, updateAppearance] = useAppearance();
  const resolvedMode =
    appearance.mode === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : appearance.mode;

  const toggleMode = () =>
    updateAppearance({ mode: resolvedMode === 'dark' ? 'light' : 'dark' });

  return (
    <header className="header">
      <h1>
        target-frontend <span className="muted">dependency explorer</span>
      </h1>
      <span className="pill" title={`commit ${payload.commit}`}>
        ⎇ {lastUpdate?.branch || payload.branch || 'no git'}
        <span className="muted"> @ {payload.commit}</span>
      </span>
      <span className="stat">{model.files.length.toLocaleString()} files</span>
      <span className="stat">
        {payload.edges.length.toLocaleString()} dependencies
      </span>
      <span className="stat">
        {Object.keys(payload.packageUsage).length} npm packages
      </span>
      {unresolved > 0 && (
        <span
          className="stat warn"
          title="Imports that could not be matched to a file. Select a file and open the Imports tab to see them."
        >
          {unresolved} unresolved
        </span>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
        <label className="theme-switch" title={resolvedMode === 'dark' ? 'Switch to light' : 'Switch to dark'}>
          <input
            type="checkbox"
            checked={resolvedMode === 'dark'}
            onChange={toggleMode}
            aria-label="Toggle theme"
          />
          <span className="slider" />
        </label>
      </div>
      {lastUpdate && (
        <span className="stat" aria-live="polite">
          Updated {describeUpdate(lastUpdate)}
        </span>
      )}
      <span
        className={`live ${connected ? 'on' : 'off'}`}
        title={
          connected
            ? 'Watching for file changes'
            : 'Disconnected from dev server'
        }
      >
        <i /> {connected ? 'Live' : 'Offline'}
      </span>
    </header>
  );
}
