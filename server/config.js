import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** target-frontend, unless overridden with SUPERSET_FRONTEND_DIR. */
export const FRONTEND_ROOT = path.resolve(
  process.env.SUPERSET_FRONTEND_DIR || path.join(here, '../../..'),
);

/** Leave the explorer's own sources out of the graph it draws. */
export const EXCLUDE_PREFIXES = ['tools/dependency-explorer/'];
