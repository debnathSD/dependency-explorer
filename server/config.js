import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** project root, unless overridden with DEP_EXPLORER_ROOT. */
export const FRONTEND_ROOT = path.resolve(
  process.env.DEP_EXPLORER_ROOT || process.env.FRONTEND_ROOT || path.join(here, '../../..'),
);

/** Leave the explorer's own sources out of the graph it draws. */
export const EXCLUDE_PREFIXES = ['tools/dependency-explorer/'];
