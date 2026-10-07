import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import less from 'highlight.js/lib/languages/less';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import scss from 'highlight.js/lib/languages/scss';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { useMemo } from 'react';

const LANGUAGES = {
  bash,
  css,
  javascript,
  json,
  less,
  markdown,
  python,
  scss,
  typescript,
  xml,
  yaml,
};
Object.entries(LANGUAGES).forEach(([name, def]) =>
  hljs.registerLanguage(name, def),
);

const EXT_TO_LANGUAGE = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  less: 'less',
  scss: 'scss',
  sass: 'scss',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  html: 'xml',
  svg: 'xml',
  xml: 'xml',
  sh: 'bash',
  py: 'python',
};
const MAX_HIGHLIGHT_CHARS = 400_000;

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightSource(path, content) {
  const language = EXT_TO_LANGUAGE[path.split('.').pop().toLowerCase()];
  if (!language || content.length > MAX_HIGHLIGHT_CHARS)
    return escapeHtml(content);
  try {
    return hljs.highlight(content, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(content);
  }
}

/**
 * Shows a file's complete source. Lines that hold a resolved import get a
 * clickable gutter arrow that jumps to the imported file.
 *
 * @param {{path: string, state: {status: string, file: object|null}, absolutePath: string,
 *   importLines: Map<number, {target: string}[]>, onNavigate: (p: string) => void}} props
 */
export default function FileViewer({
  path,
  state,
  absolutePath,
  importLines,
  onNavigate,
}) {
  const { file, status } = state;
  // highlight.js escapes the source it emits, and unknown languages go through
  // escapeHtml, so this markup never contains raw file content.
  const html = useMemo(
    () => (file && !file.binary ? highlightSource(path, file.content) : ''),
    [file, path],
  );
  const lineCount = useMemo(
    () => (file ? file.content.split('\n').length : 0),
    [file],
  );

  if (status === 'loading' && !file)
    return <div className="viewer-empty">Loading {path}…</div>;
  if (status === 'error') {
    return (
      <div className="viewer-empty">
        This file no longer exists (or could not be read).
      </div>
    );
  }
  if (!file)
    return (
      <div className="viewer-empty">
        Select a file in the tree to see its source.
      </div>
    );

  return (
    <div className="viewer">
      <div className="viewer-meta">
        <span>{formatBytes(file.size)}</span>
        {file.binary ? (
          <span>binary file</span>
        ) : (
          <span>{lineCount.toLocaleString()} lines</span>
        )}
        {file.truncated && <span className="warn">showing first 1 MB</span>}
        <a href={`vscode://file/${absolutePath}`} title="Open in VS Code">
          Open in VS Code
        </a>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(path)}
        >
          Copy path
        </button>
      </div>
      {file.binary ? (
        <div className="viewer-empty">Binary file — preview not available.</div>
      ) : (
        <div className="code-scroll">
          <div className="gutter" aria-hidden={importLines.size === 0}>
            {Array.from({ length: lineCount }, (_, i) => {
              const line = i + 1;
              const links = importLines.get(line);
              return links ? (
                <button
                  key={line}
                  type="button"
                  className="gutter-line gutter-import"
                  title={links.map(l => `Go to ${l.target}`).join('\n')}
                  aria-label={`Line ${line}: go to ${links[0].target}`}
                  onClick={() => onNavigate(links[0].target)}
                >
                  {line} →
                </button>
              ) : (
                <div key={line} className="gutter-line">
                  {line}
                </div>
              );
            })}
          </div>
          <pre className="code">
            <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        </div>
      )}
    </div>
  );
}
