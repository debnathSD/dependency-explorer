import { neighbors } from './model.js';

const MAX_ARCS = 200;

const combine = (current, next) =>
  current && current !== next ? 'both' : next;

/**
 * Highlights for the selected file: which visible nodes it imports / is
 * imported by, plus the arcs that connect them.
 *
 * In the folder tree a neighbour may sit inside a collapsed directory; the
 * highlight then lands on the nearest visible ancestor and the arc is dashed.
 *
 * @returns {{marks: Map<string, string>, arcs: object[]}}
 */
export function computeOverlay({
  model,
  mode,
  layout,
  tree,
  selectedIdx,
  opts,
  showArcs,
}) {
  const marks = new Map();
  const arcs = [];
  const arcKeys = new Set();
  if (selectedIdx == null) return { marks, arcs };

  if (mode !== 'folders') {
    for (const node of layout.nodes) {
      if (node.data.fileIdx === selectedIdx) marks.set(node.data.id, 'sel');
    }
    return { marks, arcs };
  }

  const visibleNodeFor = path => {
    let node = tree.byId.get(path);
    while (node && !layout.byKey.has(node.id)) node = node.parent;
    return node ? layout.byKey.get(node.id) : null;
  };

  const selected = visibleNodeFor(model.files[selectedIdx].p);
  if (!selected) return { marks, arcs };
  marks.set(selected.data.id, 'sel');

  for (const direction of ['out', 'in']) {
    for (const edge of neighbors(model, selectedIdx, direction, opts)) {
      const target = visibleNodeFor(model.files[edge.to].p);
      if (!target || target === selected) continue;
      const key = target.data.id;
      if (marks.get(key) !== 'sel')
        marks.set(key, combine(marks.get(key), direction));
      const arcKey = `${direction}:${key}`;
      if (showArcs && arcs.length < MAX_ARCS && !arcKeys.has(arcKey)) {
        arcKeys.add(arcKey);
        arcs.push({
          dir: direction,
          from: selected,
          to: target,
          dashed: target.data.isDir || edge.mask === model.typeBit,
        });
      }
    }
  }
  return { marks, arcs };
}
