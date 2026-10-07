// Run with `npm test`. Named test-*.js (not *.test.js) so the main jest run,
// whose testRegex covers tools/, does not pick these node:test files up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractReferences } from './parser.js';

const refs = (file, code) =>
  extractReferences(file, code).map(r => `${r.kind}:${r.spec}@${r.line}`);

test('classifies static, type-only, re-export, dynamic and require references', () => {
  const code = [
    "import React from 'react';",
    "import type { Foo } from './types';",
    "import { type A, type B } from './onlyTypes';",
    "import { type C, d } from './mixed';",
    "import './side-effect.less';",
    "export * from './barrel';",
    "export type { T } from './t';",
    "const Lazy = React.lazy(() => import('./Lazy'));",
    "const x = require('./legacy');",
    "type Y = import('./typeOnlyDynamic').Y;",
    "new Worker(new URL('./worker.ts', import.meta.url));",
  ].join('\n');
  assert.deepEqual(refs('a.tsx', code), [
    'import:react@1',
    'type:./types@2',
    'type:./onlyTypes@3',
    'import:./mixed@4',
    'import:./side-effect.less@5',
    'reexport:./barrel@6',
    'type:./t@7',
    'dynamic:./Lazy@8',
    'require:./legacy@9',
    'type:./typeOnlyDynamic@10',
    'url:./worker.ts@11',
  ]);
});

test('ignores import-looking text in strings and comments', () => {
  const code = [
    "// import x from './commented'",
    'const s = "import y from \'./string\'";',
    "const t = `require('./template')`;",
    'const dyn = require(someVariable);',
  ].join('\n');
  assert.deepEqual(refs('a.ts', code), []);
});

test('parses JSX inside plain .js files', () => {
  assert.deepEqual(
    refs('a.js', "import A from './A';\nexport default () => <A />;"),
    ['import:./A@1'],
  );
});

test('reads @import from stylesheets, skipping commented-out lines', () => {
  const code =
    "@import './a.less';\n//  @import './b.less';\n/* @import './c.less'; */\n@import (reference) './d.less';";
  assert.deepEqual(refs('x.less', code), [
    'style:./a.less@1',
    'style:./d.less@4',
  ]);
});
