import { hierarchy, tree } from 'd3';

export const ROW_HEIGHT = 24;
const CHAR_WIDTH = 6.7;
const LABEL_PAD = 26;
const COLUMN_GAP = 44;
const MAX_LABEL_CHARS = 44;

export function truncate(text) {
  return text.length > MAX_LABEL_CHARS
    ? `${text.slice(0, MAX_LABEL_CHARS - 1)}…`
    : text;
}

/**
 * Lays out a tree left-to-right. Every depth gets its own column, wide enough
 * for its longest label, so text never overlaps its neighbours.
 *
 * @param {object} rootData
 * @param {(d: object) => object[] | null} childrenOf
 * @param {(d: object) => string} labelOf
 */
export function layoutTree(rootData, childrenOf, labelOf) {
  const root = hierarchy(rootData, childrenOf);
  tree()
    .nodeSize([ROW_HEIGHT, 1])
    .separation(() => 1)(root);

  const nodes = root.descendants();
  const columnWidth = [];
  for (const node of nodes) {
    node.label = truncate(labelOf(node.data));
    node.labelWidth = node.label.length * CHAR_WIDTH + LABEL_PAD;
    columnWidth[node.depth] = Math.max(
      columnWidth[node.depth] || 0,
      node.labelWidth,
    );
  }
  const columnX = [0];
  for (let d = 1; d < columnWidth.length; d += 1) {
    columnX[d] = columnX[d - 1] + columnWidth[d - 1] + COLUMN_GAP;
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    node.px = columnX[node.depth];
    node.py = node.x;
    minY = Math.min(minY, node.py);
    maxY = Math.max(maxY, node.py);
  }
  const byKey = new Map(nodes.map(n => [n.data.id, n]));
  return { root, nodes, links: root.links(), byKey, minY, maxY };
}
