import { useCallback, useEffect, useRef, useState } from 'react';
import { buildModel } from '../model.js';

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/**
 * Loads the dependency graph and keeps it live through the server's
 * Server-Sent Events stream.
 *
 * `lastUpdate` describes the latest change pushed by the server:
 * { at: Date, counts: {added, removed, changed}, changed: string[], removed: string[] }
 */
export function useGraph() {
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const controllerRef = useRef(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const payload = await getJson('/api/graph', controller.signal);
      setModel(buildModel(payload));
      setError(null);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const source = new EventSource('/api/events');
    source.addEventListener('hello', () => setConnected(true));
    source.addEventListener('update', e => {
      const data = JSON.parse(e.data);
      setLastUpdate({ ...data, at: new Date() });
      if (data.graphChanged) load();
    });
    source.onerror = () => setConnected(false);
    return () => {
      source.close();
      controllerRef.current?.abort();
    };
  }, [load]);

  return { model, error, connected, lastUpdate };
}

/**
 * Fetches the source of `path`, and refetches whenever the server reports the
 * file as changed (`refreshKey` changes).
 */
export function useFileContent(path, refreshKey) {
  const [state, setState] = useState({
    path: null,
    status: 'idle',
    file: null,
  });

  useEffect(() => {
    if (!path) {
      setState({ path: null, status: 'idle', file: null });
      return undefined;
    }
    const controller = new AbortController();
    setState(prev => ({
      ...prev,
      path,
      status: prev.path === path ? prev.status : 'loading',
    }));
    getJson(`/api/file?path=${encodeURIComponent(path)}`, controller.signal)
      .then(file => setState({ path, status: 'ready', file }))
      .catch(err => {
        if (err.name !== 'AbortError')
          setState({ path, status: 'error', file: null });
      });
    return () => controller.abort();
  }, [path, refreshKey]);

  return state;
}
