import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Resolver } from './resolver.js';

const files = new Set([
  'src/components/Button/index.tsx',
  'src/components/Button/Button.tsx',
  'src/utils/format.ts',
  'src/utils/data.json',
  'spec/helpers/render.tsx',
  'packages/superset-ui-core/src/index.ts',
  'packages/superset-ui-core/src/query/index.ts',
  'plugins/plugin-chart-table/src/index.ts',
  'packages/blocknote-editor/index.js',
  'packages/blocknote-editor/ai/Panel.tsx',
  'src/legacy/Only.d.ts',
]);
const workspaces = [
  {
    name: '@superset-ui/core',
    dir: 'packages/superset-ui-core',
    main: 'lib/index.js',
    module: 'esm/index.js',
  },
  {
    name: '@superset-ui/plugin-chart-table',
    dir: 'plugins/plugin-chart-table',
    main: 'lib/index.js',
  },
  {
    name: 'blocknote-editor',
    dir: 'packages/blocknote-editor',
    main: 'index.js',
  },
];
const resolver = new Resolver(files, workspaces, {}, '');
const resolve = (from, spec) => resolver.resolve(from, spec);

test('relative imports: extension probing, directory index, .js -> .ts', () => {
  const from = 'src/components/Button/Button.tsx';
  assert.deepEqual(resolve(from, '../../utils/format'), {
    type: 'file',
    target: 'src/utils/format.ts',
  });
  assert.deepEqual(resolve(from, './'), {
    type: 'file',
    target: 'src/components/Button/index.tsx',
  });
  assert.deepEqual(resolve(from, '../../utils/format.js'), {
    type: 'file',
    target: 'src/utils/format.ts',
  });
  assert.deepEqual(resolve(from, '../../utils/data.json'), {
    type: 'file',
    target: 'src/utils/data.json',
  });
  assert.deepEqual(resolve(from, '../../legacy/Only'), {
    type: 'file',
    target: 'src/legacy/Only.d.ts',
  });
});

test('baseUrl-style imports (src/..., spec/...) resolve against the root', () => {
  assert.deepEqual(resolve('x.ts', 'src/components/Button'), {
    type: 'file',
    target: 'src/components/Button/index.tsx',
  });
  assert.deepEqual(resolve('x.ts', 'spec/helpers/render'), {
    type: 'file',
    target: 'spec/helpers/render.tsx',
  });
});

test('@superset-ui/* aliases point at package sources, including sub-paths', () => {
  assert.deepEqual(resolve('x.ts', '@superset-ui/core'), {
    type: 'file',
    target: 'packages/superset-ui-core/src/index.ts',
  });
  assert.deepEqual(resolve('x.ts', '@superset-ui/core/query'), {
    type: 'file',
    target: 'packages/superset-ui-core/src/query/index.ts',
  });
  assert.deepEqual(resolve('x.ts', '@superset-ui/plugin-chart-table'), {
    type: 'file',
    target: 'plugins/plugin-chart-table/src/index.ts',
  });
});

test('plain workspace packages use package.json main and sub-paths', () => {
  assert.deepEqual(resolve('x.ts', 'blocknote-editor'), {
    type: 'file',
    target: 'packages/blocknote-editor/index.js',
  });
  assert.deepEqual(resolve('x.ts', 'blocknote-editor/ai/Panel'), {
    type: 'file',
    target: 'packages/blocknote-editor/ai/Panel.tsx',
  });
});

test('npm packages and node builtins are external, with scoped names kept whole', () => {
  assert.deepEqual(resolve('x.ts', 'react'), {
    type: 'external',
    pkg: 'react',
  });
  assert.deepEqual(resolve('x.ts', 'lodash/get'), {
    type: 'external',
    pkg: 'lodash',
  });
  assert.deepEqual(resolve('x.ts', '@emotion/react/types/css-prop'), {
    type: 'external',
    pkg: '@emotion/react',
  });
  assert.deepEqual(resolve('x.ts', 'node:fs'), {
    type: 'external',
    pkg: 'node:fs',
  });
});

test('broken local imports are reported as unresolved, not as npm packages', () => {
  assert.deepEqual(resolve('src/a.ts', './missing'), { type: 'unresolved' });
  assert.deepEqual(resolve('src/a.ts', 'src/components/Nope'), {
    type: 'unresolved',
  });
});

test('loader prefixes and query strings are stripped', () => {
  assert.deepEqual(resolve('src/a.ts', '../src/utils/data.json?raw'), {
    type: 'file',
    target: 'src/utils/data.json',
  });
});

test('tsconfig paths wildcards are honoured', () => {
  const r = new Resolver(files, [], { 'alias/*': ['src/utils/*'] }, '');
  assert.deepEqual(r.resolve('x.ts', 'alias/format'), {
    type: 'file',
    target: 'src/utils/format.ts',
  });
});
