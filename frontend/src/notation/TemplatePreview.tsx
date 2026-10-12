import { useId, useMemo } from 'react';
import type { GraphNode } from '../model/types';
import { notationGeometry } from './geometry';
import {
  notationConnectorPaths,
  notationDecoration,
  notationEdgeAppearance,
  notationSourceIsGateway,
} from './edge-geometry';
import { getNotationSymbol } from './registry';
import { notationGuard, notationPrefix } from './labels';
import { createNotationGraph, notationTemplates } from './templates';
import type { NotationSide } from './types';

export const templateCollections = [
  ['all', 'All templates'],
  ['ordinary', 'General diagrams'],
  ['hipo', 'HIPO'],
  ['dfd', 'Classic DFDs'],
  ['uml', 'UML'],
  ['bpmn', 'BPMN'],
  ['simulation', 'Process Simulator'],
  ['analytics', 'Time Series & Signal Analysis'],
] as const;
export type TemplateCollectionFilter = (typeof templateCollections)[number][0];
const structuralUml = new Set([
  'class',
  'object',
  'package',
  'component',
  'composite-structure',
  'deployment',
  'profile',
]);
export const templateGroups = [
  { id: 'ordinary', label: 'General diagrams' },
  { id: 'hipo', label: 'HIPO documentation' },
  { id: 'dfd', label: 'Classic data-flow diagrams' },
  { id: 'uml-structure', label: 'UML · Structure' },
  { id: 'uml-behavior', label: 'UML · Behavior and interactions' },
  { id: 'bpmn', label: 'BPMN · Business processes and participants' },
  { id: 'simulation', label: 'Process Simulator' },
  { id: 'analytics', label: 'Time Series & Signal Analysis' },
] as const;
export function notationTemplate(key: string) {
  return notationTemplates.find((template) => template.key === key);
}
export function templateGroup(key: string) {
  const notation = notationTemplate(key);
  if (notation?.collection === 'uml')
    return structuralUml.has(notation.diagramKind) ? 'uml-structure' : 'uml-behavior';
  if (notation?.collection.startsWith('dfd')) return 'dfd';
  if (notation) return notation.collection;
  if (key === 'time-series-analysis') return 'analytics';
  if (key.includes('simulator')) return 'simulation';
  return 'ordinary';
}
export function templateMatches(
  template: { key: string; name: string; type: string },
  query: string,
  collection: TemplateCollectionFilter,
  displayName = template.name,
) {
  const group = templateGroup(template.key);
  if (
    collection !== 'all' &&
    (collection === 'uml' ? !group.startsWith('uml-') : group !== collection)
  )
    return false;
  const notation = notationTemplate(template.key);
  const haystack = [
    displayName,
    template.name,
    template.key,
    template.type,
    templateGroups.find((value) => value.id === group)?.label,
    notation?.diagramKind,
  ]
    .join(' ')
    .toLocaleLowerCase()
    .replaceAll('-', ' ');
  return query
    .trim()
    .toLocaleLowerCase()
    .replaceAll('-', ' ')
    .split(/\s+/)
    .every((term) => haystack.includes(term));
}

/** A disposable example, never read from or written to the user's workspace. */
export function TemplatePreview({ templateKey }: { templateKey: string }) {
  const graph = useMemo(() => createNotationGraph(templateKey, 'Template preview'), [templateKey]);
  const prefix = useId().replaceAll(':', '');
  if (!graph?.nodes.length) return null;
  const shapes = new Map(graph.nodes.map((node) => [node.id, notationGeometry(node.notation!)]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const left = Math.min(...graph.nodes.map((node) => node.x)) - 20;
  const top = Math.min(...graph.nodes.map((node) => node.y)) - 20;
  const width = Math.max(...graph.nodes.map((node) => node.x + node.width)) - left + 20;
  const height = Math.max(...graph.nodes.map((node) => node.y + node.height)) - top + 20;
  const point = (node: GraphNode, port: string | undefined, fallback: NotationSide) => {
    const shape = shapes.get(node.id)!;
    const anchor =
      shape.anchors.find((anchor) => anchor.id === (port ?? fallback)) ??
      shape.anchors.find((anchor) => anchor.id === fallback)!;
    return [node.x + anchor.x * node.width, node.y + anchor.y * node.height] as const;
  };
  const nodeShape = (node: GraphNode) => {
    const shape = shapes.get(node.id)!;
    const descriptor = getNotationSymbol(node.notation!.collection, node.notation!.symbol)!;
    const textBox = shape.contentBox;
    const clipId = `${prefix}-${node.id}`;
    const sectionLines = node.notation!.compartments?.flatMap((section) => section.lines) ?? [];
    const labelPrefix = notationPrefix(node.notation!);
    const guard = notationGuard(node.notation!);
    return (
      <g
        key={node.id}
        data-preview-symbol={`${node.notation!.collection}:${node.notation!.symbol}`}
        transform={`translate(${node.x} ${node.y})`}
      >
        <title>{node.title}</title>
        <g transform={`scale(${node.width / 100} ${node.height / 100})`}>
          <path
            d={shape.outlinePath}
            fill={
              shape.outlineFill === 'none'
                ? 'none'
                : shape.outlineFill === 'foreground'
                  ? 'currentColor'
                  : 'var(--surface)'
            }
            fillOpacity={descriptor.container ? 0.08 : undefined}
            stroke="currentColor"
            strokeWidth=".8"
            strokeDasharray={shape.stroke === 'dashed' ? '4 3' : undefined}
            vectorEffect="non-scaling-stroke"
          />
          {shape.shadedPaths?.map((path, index) => (
            <path
              key={`shade-${index}`}
              data-preview-shading="true"
              d={path}
              fill="currentColor"
              fillOpacity=".12"
            />
          ))}
          {shape.detailPaths.map((path, index) => (
            <path
              key={`detail-${index}`}
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth=".65"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {shape.dashedPaths?.map((path, index) => (
            <path
              key={`dash-${index}`}
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth=".65"
              strokeDasharray="3 2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {shape.filledPaths.map((path, index) => (
            <path key={`fill-${index}`} d={path} fill="currentColor" />
          ))}
          {shape.contrastPaths?.map((path, index) => (
            <path
              key={`contrast-${index}`}
              d={path}
              fill="none"
              stroke="var(--surface)"
              strokeWidth=".65"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        <defs>
          <clipPath id={clipId}>
            <rect
              x={textBox.x * node.width}
              y={textBox.y * node.height}
              width={textBox.width * node.width}
              height={textBox.height * node.height}
            />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`} fill="currentColor" fontFamily="sans-serif" fontSize="14">
          {shape.titleStyle !== 'hidden' && (
            <text
              x={(textBox.x + textBox.width / 2) * node.width}
              y={
                shape.titleRotation
                  ? (textBox.y + textBox.height / 2) * node.height + 4
                  : textBox.y * node.height + (labelPrefix && !shape.prefixBox ? 32 : 18)
              }
              textAnchor="middle"
              fontWeight="600"
              fontStyle={shape.titleStyle === 'italic' ? 'italic' : undefined}
              textDecoration={shape.titleStyle === 'underlined' ? 'underline' : undefined}
              transform={
                shape.titleRotation
                  ? `rotate(${shape.titleRotation} ${(textBox.x + textBox.width / 2) * node.width} ${(textBox.y + textBox.height / 2) * node.height})`
                  : undefined
              }
            >
              {node.title}
            </text>
          )}
          {!shape.compartmentBoxes?.length &&
            sectionLines.slice(0, 4).map((line, index) => (
              <text
                key={index}
                x={textBox.x * node.width + 4}
                y={textBox.y * node.height + 40 + index * 18}
              >
                {line}
              </text>
            ))}
        </g>
        {labelPrefix != null && (
          <text
            fill="currentColor"
            fontFamily="sans-serif"
            fontSize="12"
            textAnchor="middle"
            x={
              (shape.prefixBox
                ? shape.prefixBox.x + shape.prefixBox.width / 2
                : textBox.x + textBox.width / 2) * node.width
            }
            y={
              (shape.prefixBox ? shape.prefixBox.y + shape.prefixBox.height / 2 : textBox.y) *
                node.height +
              (shape.prefixBox ? 4 : 12)
            }
          >
            {labelPrefix}
          </text>
        )}
        {guard && shape.guardBox && (
          <g fill="currentColor" fontFamily="sans-serif" fontSize="12">
            <defs>
              <clipPath id={`${clipId}-guard`}>
                <rect
                  x={shape.guardBox.x * node.width}
                  y={shape.guardBox.y * node.height}
                  width={shape.guardBox.width * node.width}
                  height={shape.guardBox.height * node.height}
                />
              </clipPath>
            </defs>
            <text
              data-preview-guard="true"
              clipPath={`url(#${clipId}-guard)`}
              textAnchor="middle"
              x={(shape.guardBox.x + shape.guardBox.width / 2) * node.width}
              y={(shape.guardBox.y + shape.guardBox.height / 2) * node.height + 4}
            >
              {guard}
            </text>
          </g>
        )}
        {shape.compartmentBoxes?.map((box, index) => {
          const section =
            node.notation!.compartments?.find((section) => section.id === box.id) ??
            node.notation!.compartments?.[index];
          return (
            <g key={box.id} fill="currentColor" fontFamily="sans-serif" fontSize="14">
              <defs>
                <clipPath id={`${clipId}-section-${index}`}>
                  <rect
                    x={box.x * node.width}
                    y={box.y * node.height}
                    width={box.width * node.width}
                    height={box.height * node.height}
                  />
                </clipPath>
              </defs>
              <g clipPath={`url(#${clipId}-section-${index})`}>
                {section?.title && (
                  <text
                    x={box.x * node.width + 6}
                    y={box.y * node.height + 15}
                    fontWeight="600"
                    fontSize="12"
                  >
                    {section.title}
                  </text>
                )}
                {section?.lines.slice(0, 3).map((line, lineIndex) => (
                  <text
                    key={lineIndex}
                    x={box.x * node.width + 6}
                    y={box.y * node.height + (section.title ? 34 : 20) + lineIndex * 18}
                  >
                    {line}
                  </text>
                ))}
              </g>
            </g>
          );
        })}
      </g>
    );
  };
  return (
    <svg
      viewBox={`${left} ${top} ${width} ${height}`}
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      data-notation-preview={templateKey}
    >
      {graph.nodes
        .filter(
          (node) => getNotationSymbol(node.notation!.collection, node.notation!.symbol)!.container,
        )
        .map(nodeShape)}
      {graph.edges.map((edge, index) => {
        const source = nodes.get(edge.sourceNodeId)!,
          target = nodes.get(edge.targetNodeId)!;
        const a = point(source, edge.notation?.sourcePort, 'right'),
          b = point(target, edge.notation?.targetPort, 'left');
        const context = { sourceIsGateway: notationSourceIsGateway(source.notation) };
        const appearance = notationEdgeAppearance(edge.notation!, context);
        const marker = (end: 'start' | 'end') => `${prefix}-edge-${index}-${end}`;
        const route = [a, ...(edge.notation?.waypoints ?? []), b];
        const geometry = notationConnectorPaths(
          edge.notation!,
          route.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' '),
          context,
        );
        return (
          <g key={edge.id} data-preview-relationship={edge.notation!.symbol}>
            <defs>
              {(['start', 'end'] as const).map((end) => {
                const decoration = notationDecoration(
                  end === 'start' ? appearance.sourceDecoration : appearance.targetDecoration,
                  appearance.hatch && end === 'end',
                  appearance.ribbon && end === 'end',
                );
                return (
                  <marker
                    key={end}
                    id={marker(end)}
                    viewBox="-1 -1 12 12"
                    refX="10"
                    refY="5"
                    markerWidth="12"
                    markerHeight="12"
                    orient="auto-start-reverse"
                    markerUnits="userSpaceOnUse"
                  >
                    <path
                      d={decoration.path}
                      fill={
                        decoration.fill === 'foreground'
                          ? 'currentColor'
                          : decoration.fill === 'background'
                            ? 'var(--surface)'
                            : 'none'
                      }
                      stroke="currentColor"
                    />
                    {decoration.detailPaths.map((path, index) => (
                      <path key={index} d={path} fill="none" stroke="currentColor" />
                    ))}
                  </marker>
                );
              })}
            </defs>
            <path
              d={geometry.path}
              fill="none"
              stroke="currentColor"
              strokeWidth={appearance.double || appearance.ribbon ? 0 : geometry.strokeWidth / 2}
              vectorEffect="non-scaling-stroke"
              strokeDasharray={
                appearance.line === 'dashed'
                  ? '3 2'
                  : appearance.line === 'dotted'
                    ? '1 2'
                    : undefined
              }
              markerStart={
                appearance.sourceDecoration === 'none' ? undefined : `url(#${marker('start')})`
              }
              markerEnd={
                appearance.targetDecoration === 'none' ? undefined : `url(#${marker('end')})`
              }
            />
            {(appearance.double || appearance.ribbon) &&
              geometry.strokePaths.map((path, index) => (
                <path
                  key={`stroke-${index}`}
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={geometry.strokeWidth}
                />
              ))}
            {geometry.detailPaths.map((path, index) => (
              <path
                key={`detail-${index}`}
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            ))}
          </g>
        );
      })}
      {graph.nodes
        .filter(
          (node) => !getNotationSymbol(node.notation!.collection, node.notation!.symbol)!.container,
        )
        .map(nodeShape)}
    </svg>
  );
}
