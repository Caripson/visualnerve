import { useI18n } from '../i18n';
import { useId } from 'react';
import type { Graph } from '../model/types';
import { importedConnectionStyle } from '../imports/diagram/presentation';

/** Bounded thumbnail of native geometry; the editable canvas opens after import. */
export function DiagramFilePreview({ graph }: { graph: Graph }) {
  const { t } = useI18n();
  const marker = useId().replace(/:/g, '');
  const nodes = graph.nodes.slice(0, 200);
  const ids = new Map(nodes.map((node) => [node.id, node]));
  const left = Math.min(0, ...nodes.map((node) => node.x));
  const top = Math.min(0, ...nodes.map((node) => node.y));
  const right = Math.max(400, ...nodes.map((node) => node.x + node.width));
  const bottom = Math.max(200, ...nodes.map((node) => node.y + node.height));
  return (
    <figure className="diagram-file-preview">
      <svg
        role="img"
        aria-label={t('import.diagramPreview.region')}
        viewBox={`${left - 20} ${top - 20} ${right - left + 40} ${bottom - top + 40}`}
      >
        <defs>
          <marker
            id={marker}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="4"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L8 4 L0 8z" fill="context-stroke" />
          </marker>
        </defs>
        {graph.edges.slice(0, 400).map((edge) => {
          const a = ids.get(edge.sourceNodeId),
            b = ids.get(edge.targetNodeId);
          if (!a || !b) return null;
          const style = importedConnectionStyle(edge);
          return (
            <line
              key={edge.id}
              x1={a.x + a.width / 2}
              y1={a.y + a.height / 2}
              x2={b.x + b.width / 2}
              y2={b.y + b.height / 2}
              stroke={style.color ?? 'var(--muted)'}
              strokeWidth={style.width ?? 2}
              strokeDasharray={
                edge.style === 'dashed' ? '7 4' : edge.style === 'dotted' ? '2 4' : undefined
              }
              markerEnd={
                edge.direction === 'forward' || edge.direction === 'both'
                  ? `url(#${marker})`
                  : undefined
              }
              markerStart={
                edge.direction === 'backward' || edge.direction === 'both'
                  ? `url(#${marker})`
                  : undefined
              }
            />
          );
        })}
        {[...nodes]
          .sort((a, b) => Number(b.nodeType === 'group') - Number(a.nodeType === 'group'))
          .map((node) => (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={node.nodeType === 'start' || node.nodeType === 'end' ? node.height / 2 : 6}
                fill={node.nodeType === 'group' ? 'none' : 'var(--surface)'}
                stroke={node.color ?? 'var(--muted)'}
                strokeWidth="2"
              />
              <text
                x={node.x + 8}
                y={node.y + Math.min(26, node.height - 6)}
                fill="var(--text)"
                fontSize="14"
              >
                {node.title.replace(/\n/g, ' ').slice(0, Math.max(5, Math.floor(node.width / 8)))}
              </text>
            </g>
          ))}
      </svg>
      <figcaption>
        {graph.nodes.length > nodes.length
          ? t('import.diagramPreview.bounded')
          : t('import.diagramPreview.editable')}
      </figcaption>
    </figure>
  );
}
