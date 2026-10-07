import { select, zoom, zoomIdentity } from 'd3';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROW_HEIGHT } from '../layout.js';

const CULL_MARGIN = 200;
const CIRCLE_RADIUS = 5;

function treeLinkPath(link) {
  const sx = link.source.px + link.source.labelWidth - 8;
  const sy = link.source.py;
  const tx = link.target.px;
  const ty = link.target.py;
  const mid = (sx + tx) / 2;
  return `M${sx},${sy}C${mid},${sy} ${mid},${ty} ${tx},${ty}`;
}

function arcPath(a, b) {
  const ax = a.px;
  const bx = b.px;
  const bulge = Math.min(260, 40 + Math.abs(a.py - b.py) * 0.22);
  const cx = Math.min(ax, bx) - bulge;
  return `M${ax},${a.py}Q${cx},${(a.py + b.py) / 2} ${bx},${b.py}`;
}

function TreeNode({ node, mark, onActivate, onToggle }) {
  const { data } = node;
  const isDir = Boolean(data.isDir);
  const hasChildren = isDir ? data.children?.length > 0 : false;
  const isOpen = Boolean(node.children);
  const cls = [
    'node',
    isDir ? 'dir' : `file cat-${data.cat}`,
    mark ? `mark-${mark}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const tooltip = data.tooltip || node.label;
  return (
    <g className={cls} transform={`translate(${node.px},${node.py})`}>
      <title>{tooltip}</title>
      <rect
        className="node-hit"
        x={-CIRCLE_RADIUS}
        y={-ROW_HEIGHT / 2 + 1}
        width={node.labelWidth}
        height={ROW_HEIGHT - 2}
        rx={4}
      />
      <circle
        className="node-dot"
        r={CIRCLE_RADIUS}
        onClick={() => (hasChildren ? onToggle(node) : onActivate(node))}
      />
      {isDir && hasChildren && (
        <text className="node-glyph" y={3.5} textAnchor="middle">
          {isOpen ? '−' : '+'}
        </text>
      )}
      <text
        className="node-label"
        x={CIRCLE_RADIUS + 6}
        y={4}
        role="button"
        tabIndex={0}
        onClick={() => onActivate(node)}
        onDoubleClick={() => !isDir && onActivate(node, true)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate(node);
          }
        }}
      >
        {node.label}
      </text>
    </g>
  );
}

/**
 * Pan/zoomable node-link tree. Presentational: layout, marks and arcs are
 * computed by the caller.
 *
 * Wheel scrolls the tree; ctrl/cmd + wheel (or trackpad pinch) zooms.
 */
export default function TreeView({
  layout,
  marks,
  arcs,
  centerKey,
  centerTick,
  onActivate,
  onToggle,
}) {
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const sizeRef = useRef({ width: 800, height: 600 });
  const [size, setSize] = useState(sizeRef.current);
  const [transform, setTransform] = useState(zoomIdentity);

  useEffect(() => {
    const svg = svgRef.current;
    const behavior = zoom()
      .scaleExtent([0.25, 2.5])
      .filter(e => (e.type === 'wheel' ? e.ctrlKey || e.metaKey : !e.button))
      .on('zoom', e => setTransform(e.transform));
    zoomRef.current = behavior;
    select(svg).call(behavior).on('dblclick.zoom', null);

    const onWheel = e => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      select(svg).call(behavior.translateBy, -e.deltaX, -e.deltaY);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      sizeRef.current = { width, height };
      setSize({ width, height });
    });
    observer.observe(svg);
    return () => {
      svg.removeEventListener('wheel', onWheel);
      observer.disconnect();
      select(svg).on('.zoom', null);
    };
  }, []);

  const moveTo = useCallback((x, y, animate) => {
    const { width, height } = sizeRef.current;
    const k = 1;
    const target = zoomIdentity
      .translate(Math.max(60, width * 0.3) - x * k, height / 2 - y * k)
      .scale(k);
    const sel = select(svgRef.current);
    (animate ? sel.transition().duration(350) : sel).call(
      zoomRef.current.transform,
      target,
    );
  }, []);

  // Re-centre when a caller asks for it (search, hash link, list click).
  useEffect(() => {
    const node = layout.byKey.get(centerKey) || layout.root;
    moveTo(node.px, node.py, centerTick > 0);
    // Only an explicit request (tick) or a new root should re-centre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerTick, layout.root.data.id]);

  const visible = useMemo(() => {
    const top = (-transform.y - CULL_MARGIN) / transform.k;
    const bottom = (size.height - transform.y + CULL_MARGIN) / transform.k;
    const inView = n => n.py >= top && n.py <= bottom;
    return {
      nodes: layout.nodes.filter(inView),
      links: layout.links.filter(l => inView(l.source) || inView(l.target)),
      arcs: arcs.filter(a => inView(a.from) || inView(a.to)),
    };
  }, [layout, arcs, transform, size.height]);

  return (
    <svg
      ref={svgRef}
      className="tree-svg"
      role="tree"
      aria-label="File dependency tree"
    >
      <g
        transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
      >
        <g className="tree-links">
          {visible.links.map(l => (
            <path
              key={`${l.source.data.id}>${l.target.data.id}`}
              d={treeLinkPath(l)}
            />
          ))}
        </g>
        <g className="arcs">
          {visible.arcs.map(a => (
            <path
              key={`${a.dir}:${a.from.data.id}>${a.to.data.id}`}
              className={`arc arc-${a.dir}${a.dashed ? ' arc-dashed' : ''}`}
              d={arcPath(a.from, a.to)}
            />
          ))}
        </g>
        <g className="nodes">
          {visible.nodes.map(n => (
            <TreeNode
              key={n.data.id}
              node={n}
              mark={marks.get(n.data.id)}
              onActivate={onActivate}
              onToggle={onToggle}
            />
          ))}
        </g>
      </g>
    </svg>
  );
}
