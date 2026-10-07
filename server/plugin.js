/**
 * Vite plugin that turns the dev server into the dependency-explorer backend:
 *
 *   GET /api/graph            full graph (files, edges, external, unresolved)
 *   GET /api/file?path=...    source of one file in the graph
 *   GET /api/events           Server-Sent Events: pushed whenever the working
 *                             tree changes (edit, add, delete, git checkout/pull)
 *
 * A chokidar watcher only acts as a trigger; every trigger runs
 * `GraphStore.sync()`, which re-lists files via git, re-parses just the files
 * whose mtime/size changed, and re-resolves the graph.
 */
import chokidar from 'chokidar';
import path from 'node:path';
import { EXCLUDE_PREFIXES, FRONTEND_ROOT } from './config.js';
import { GraphStore } from './store.js';

const DEBOUNCE_MS = 350;
const IGNORED_DIRS =
  /(?:^|[\\/])(?:node_modules|dist|coverage|\.cache|\.turbo)(?:[\\/]|$)/;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default function dependencyExplorer() {
  return {
    name: 'dependency-explorer',
    configureServer(server) {
      const store = new GraphStore(FRONTEND_ROOT, {
        exclude: EXCLUDE_PREFIXES,
      });
      const clients = new Set();

      const log = msg => server.config.logger.info(`  [deps] ${msg}`);
      store.sync();
      log(
        `scanned ${store.graph.files.length} files, ${store.graph.edges.length} dependencies ` +
          `in ${store.graph.scanMs}ms (${store.graph.branch || 'no git'})`,
      );

      const broadcast = (event, data) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const res of clients) res.write(payload);
      };

      // ---- watcher -----------------------------------------------------
      let timer = null;
      let running = false;
      let again = false;
      const resync = () => {
        if (running) {
          again = true;
          return;
        }
        running = true;
        try {
          const diff = store.sync();
          const touched =
            diff.added.length + diff.removed.length + diff.changed.length;
          const branchChanged =
            store.lastBranch !== undefined &&
            store.lastBranch !== store.graph.branch;
          store.lastBranch = store.graph.branch;
          if (touched || branchChanged) {
            log(
              `+${diff.added.length} ~${diff.changed.length} -${diff.removed.length} ` +
                `files, graph ${diff.graphChanged ? 'changed' : 'unchanged'} (${store.graph.scanMs}ms)`,
            );
            broadcast('update', {
              version: store.graph.version,
              graphChanged: diff.graphChanged || branchChanged,
              added: diff.added.slice(0, 500),
              removed: diff.removed.slice(0, 500),
              changed: diff.changed.slice(0, 500),
              counts: {
                added: diff.added.length,
                removed: diff.removed.length,
                changed: diff.changed.length,
              },
              branch: store.graph.branch,
              commit: store.graph.commit,
            });
          }
        } catch (err) {
          server.config.logger.error(
            `[deps] rescan failed: ${err.stack || err}`,
          );
        } finally {
          running = false;
          if (again) {
            again = false;
            schedule();
          }
        }
      };
      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(resync, DEBOUNCE_MS);
      };
      store.lastBranch = store.graph.branch;

      let watcher = null;
      const createWatcher = root =>
        chokidar.watch(root, {
        ignoreInitial: true,
          ignored: p => {
            const rel = path.relative(root, p).split(path.sep).join('/');
            if (IGNORED_DIRS.test(rel)) return true;
            if (rel === '.git' || rel.startsWith('.git/')) {
              return !(
                rel === '.git' ||
                /^\.git\/(HEAD|ORIG_HEAD|refs(\/.*)?)$/.test(rel)
              );
            }
            return EXCLUDE_PREFIXES.some(prefix => `${rel}/`.startsWith(prefix));
          },
          usePolling: process.env.DEP_EXPLORER_POLL === '1',
          awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
        });
      watcher = createWatcher(FRONTEND_ROOT);
      watcher.on('all', schedule);
      watcher.on('error', err =>
        server.config.logger.warn(`[deps] watcher: ${err.message}`),
      );
      server.httpServer?.on('close', () => watcher.close());

      // allow clients to switch the scanned root at runtime
      if (!server._setRootHandlerAdded) {
        server._setRootHandlerAdded = true;
        server.middlewares.use('/api', (req, res, next) => {
          const url = new URL(req.url, 'http://localhost');
          if (url.pathname === '/set-root') {
            const newRoot = url.searchParams.get('root');
            if (!newRoot) return sendJson(res, 400, { error: 'missing root' });
            try {
              const abs = path.resolve(newRoot);
              store.root = abs;
              const diff = store.sync();
              // recreate watcher on the new root
              try {
                watcher.close();
              } catch {}
              watcher = createWatcher(abs);
              watcher.on('all', schedule);
              watcher.on('error', err =>
                server.config.logger.warn(`[deps] watcher: ${err.message}`),
              );
              broadcast('update', {
                version: store.graph.version,
                graphChanged: true,
                added: diff.added.slice(0, 500),
                removed: diff.removed.slice(0, 500),
                changed: diff.changed.slice(0, 500),
                counts: {
                  added: diff.added.length,
                  removed: diff.removed.length,
                  changed: diff.changed.length,
                },
                branch: store.graph.branch,
                commit: store.graph.commit,
              });
              return sendJson(res, 200, { ok: true, root: store.root });
            } catch (err) {
              return sendJson(res, 500, { error: String(err) });
            }
          }
          return next();
        });
      }

      // ---- HTTP API ----------------------------------------------------
      server.middlewares.use('/api', (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');

        if (url.pathname === '/graph') return sendJson(res, 200, store.graph);

        if (url.pathname === '/file') {
          const rel = url.searchParams.get('path') || '';
          const file = store.readFile(rel);
          return file
            ? sendJson(res, 200, file)
            : sendJson(res, 404, { error: `Not a tracked file: ${rel}` });
        }

        if (url.pathname === '/events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.write(
            `event: hello\ndata: ${JSON.stringify({ version: store.graph.version })}\n\n`,
          );
          clients.add(res);
          const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
          req.on('close', () => {
            clearInterval(heartbeat);
            clients.delete(res);
          });
          return undefined;
        }
        return next();
      });
    },
  };
}
