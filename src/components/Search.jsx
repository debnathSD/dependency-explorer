import { useMemo, useState } from 'react';

const MAX_RESULTS = 12;

/** Space-separated tokens must all appear in the path (case-insensitive). */
function searchFiles(model, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const hits = [];
  for (const f of model.files) {
    const hay = f.p.toLowerCase();
    if (tokens.every(t => hay.includes(t))) {
      // Prefer matches in the file name over matches in the directory part.
      const inName = tokens.every(t => f.name.toLowerCase().includes(t));
      hits.push({ f, score: (inName ? 0 : 1000) + f.p.length });
    }
  }
  return hits
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_RESULTS)
    .map(h => h.f);
}

export default function Search({ model, onPick }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const results = useMemo(() => searchFiles(model, query), [model, query]);

  const pick = file => {
    onPick(file.p);
    setIsOpen(false);
    setQuery('');
  };

  const handleKeyDown = e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="search">
      <input
        type="search"
        placeholder="Find a file…  (e.g. dashboard header)"
        aria-label="Find a file"
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          setActive(0);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {isOpen && results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.map((f, i) => (
            <li key={f.p} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? 'active' : ''}
                // mousedown fires before the input's blur closes the list
                onMouseDown={e => {
                  e.preventDefault();
                  pick(f);
                }}
              >
                <span className="dep-dir">{f.dir}/</span>
                {f.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
