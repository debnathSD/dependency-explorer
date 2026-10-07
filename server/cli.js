/**
 * One-shot scan, handy for checking resolution quality without the UI:
 *   npm run scan                 # summary + unresolved imports
 *   npm run scan -- --json out.json
 */
import fs from 'node:fs';
import { EXCLUDE_PREFIXES, FRONTEND_ROOT } from './config.js';
import { GraphStore } from './store.js';

const args = process.argv.slice(2);
const store = new GraphStore(FRONTEND_ROOT, { exclude: EXCLUDE_PREFIXES });
store.sync();
const g = store.graph;

const unresolvedCount = Object.values(g.unresolved).reduce(
  (n, l) => n + l.length,
  0,
);
console.log(`root:        ${g.root}`);
console.log(`branch:      ${g.branch} @ ${g.commit}`);
console.log(`files:       ${g.files.length}`);
console.log(`edges:       ${g.edges.length}`);
console.log(`external:    ${Object.keys(g.packageUsage).length} npm packages`);
console.log(
  `unresolved:  ${unresolvedCount} imports in ${Object.keys(g.unresolved).length} files`,
);
console.log(`scan time:   ${g.scanMs} ms`);

if (args.includes('--unresolved')) {
  for (const [idx, list] of Object.entries(g.unresolved)) {
    for (const [spec, line] of list)
      console.log(`  ${g.files[idx].p}:${line}  ${spec}`);
  }
}
const out = args.indexOf('--json');
if (out !== -1) {
  fs.writeFileSync(args[out + 1], JSON.stringify(g));
  console.log(`wrote ${args[out + 1]}`);
}
