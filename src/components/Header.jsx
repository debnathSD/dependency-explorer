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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="spacer" />
        <button
          className="theme-toggle"
          onClick={toggleMode}
          title={resolvedMode === 'dark' ? 'Switch to light' : 'Switch to dark'}
          aria-label="Toggle theme"
        >
          {resolvedMode === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M6.76 4.84l-1.8-1.79L3.17 4.84l1.79 1.8 1.8-1.8zM1 13h3v-2H1v2zm10 9h2v-3h-2v3zM20.24 4.84l1.79 1.8 1.79-1.79-1.8-1.8-1.78 1.79zM17 13a5 5 0 11-10 0 5 5 0 0110 0zm3.03 6.24l1.79 1.79 1.79-1.8-1.8-1.79-1.78 1.8zM6.76 19.16l-1.79 1.79 1.79 1.8 1.8-1.8-1.8-1.79zM21 11v2h3v-2h-3z" fill="currentColor" />
            </svg>
          )}
        </button>
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
