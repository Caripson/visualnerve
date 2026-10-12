import { memo, useCallback, type CSSProperties } from 'react';
import { NodeResizer, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Box } from 'lucide-react';
import type { CanvasNode } from '../canvas/projection';
import { isReadonlyCanvasNode, isReadonlyNodeTitle } from '../canvas/logical-geometry';
import { NodeTitle } from '../nodes/NodeTitle';
import { NodeQuickAdd } from '../nodes/NodeQuickAdd';
import { NodeStatus } from '../ui/NodeStatus';
import { AreaIcon, iconKey } from '../ui/icons';
import { nodeBackgroundColor } from '../nodes/appearance';
import { notationBackgroundStyle, notationTitleHasFill } from './appearance';
import { getNotationSymbol } from './registry';
import { notationGeometry } from './geometry';
import { NotationGlyph } from './Glyph';
import { NotationNodePorts } from './NodePorts';
import { notationGuard, notationPrefix } from './labels';
import './node.css';

export const NotationNode = memo(function NotationNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<CanvasNode>) {
  const { node, exporting } = data;
  const notation = node.notation!;
  const definition = getNotationSymbol(notation.collection, notation.symbol)!;
  const geometry = notationGeometry(notation);
  const titleHasFill = notationTitleHasFill(geometry, definition.container);
  const readonly = isReadonlyCanvasNode(node);
  const resize = useCallback(
    (_: unknown, size: ResizeParams) => data.resize?.(id, size),
    [id, data.resize],
  );
  const prefix = notationPrefix(notation);
  const guard = notationGuard(notation);
  return (
    <div
      className={`vn-node notation-node ${definition.container ? 'notation-container' : ''} ${selected && !exporting ? 'is-selected' : ''}`}
      style={
        {
          '--node-accent': node.color || data.mindmap?.color || '#31766c',
          ...notationBackgroundStyle(node.backgroundColor, titleHasFill),
          '--notation-x': `${geometry.contentBox.x * 100}%`,
          '--notation-y': `${geometry.contentBox.y * 100}%`,
          '--notation-width': `${geometry.contentBox.width * 100}%`,
          '--notation-height': `${geometry.contentBox.height * 100}%`,
        } as CSSProperties
      }
      data-testid="graph-node"
      data-node-id={id}
      data-notation-collection={notation.collection}
      data-notation-symbol={notation.symbol}
      data-notation-title-fill={titleHasFill ? 'node' : 'canvas'}
      data-node-background={nodeBackgroundColor(node.backgroundColor)}
      data-node-status={node.status || undefined}
    >
      <NotationGlyph value={notation} className="notation-node-shape" />
      {prefix != null && geometry.prefixBox && (
        <span
          className="notation-fixed-prefix"
          style={
            {
              left: `${geometry.prefixBox.x * 100}%`,
              top: `${geometry.prefixBox.y * 100}%`,
              width: `${geometry.prefixBox.width * 100}%`,
              height: `${geometry.prefixBox.height * 100}%`,
              '--prefix-x': `${geometry.prefixBox.x * 100}%`,
              '--prefix-width': `${geometry.prefixBox.width * 100}%`,
            } as CSSProperties
          }
        >
          {String(prefix)}
        </span>
      )}
      {guard && geometry.guardBox && (
        <span
          className="notation-fixed-prefix"
          style={
            {
              left: `${geometry.guardBox.x * 100}%`,
              top: `${geometry.guardBox.y * 100}%`,
              width: `${geometry.guardBox.width * 100}%`,
              height: `${geometry.guardBox.height * 100}%`,
              '--prefix-x': `${geometry.guardBox.x * 100}%`,
              '--prefix-width': `${geometry.guardBox.width * 100}%`,
            } as CSSProperties
          }
        >
          {guard}
        </span>
      )}
      <div
        className="notation-node-content"
        data-title-style={geometry.titleStyle}
        data-title-rotation={geometry.titleRotation}
      >
        <div
          className={geometry.titleRotation ? 'notation-rotated-content' : 'notation-content-stack'}
          style={
            geometry.titleRotation
              ? {
                  width: geometry.contentBox.height * (height ?? node.height),
                  height: geometry.contentBox.width * (width ?? node.width),
                }
              : undefined
          }
        >
          {prefix != null && !geometry.prefixBox && (
            <span className="notation-prefix">{String(prefix)}</span>
          )}
          <div className="notation-node-heading">
            {iconKey(node.metadata) && (
              <AreaIcon metadata={node.metadata} fallback={Box} size={16} />
            )}
            <NodeTitle
              id={id}
              title={node.title}
              exporting={exporting}
              readonly={isReadonlyNodeTitle(node)}
            />
          </div>
          <NodeStatus status={node.status} />
          {!geometry.compartmentBoxes?.length && notation.compartments?.length ? (
            <div
              className="notation-sections nodrag nopan nowheel"
              tabIndex={0}
              aria-label={`${node.title} sections`}
            >
              {notation.compartments.map((section) => (
                <section key={section.id} className="notation-section">
                  {section.title && <strong>{section.title}</strong>}
                  {section.lines.map((line, index) => (
                    <div key={index} className="notation-entry">
                      {line || '\u00a0'}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {geometry.compartmentBoxes?.map((box, index) => {
        const section =
          notation.compartments?.find((item) => item.id === box.id) ??
          notation.compartments?.[index];
        if (!section) return null;
        return (
          <section
            key={box.id}
            className="notation-fixed-section nodrag nopan nowheel"
            tabIndex={0}
            aria-label={section.title ?? box.id}
            style={
              {
                '--section-x': `${box.x * 100}%`,
                '--section-width': `${box.width * 100}%`,
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              } as CSSProperties
            }
          >
            {section.title && <strong>{section.title}</strong>}
            {section.lines.map((line, index) => (
              <div key={index} className="notation-entry">
                {line}
              </div>
            ))}
          </section>
        );
      })}
      {selected && !exporting && <NodeQuickAdd id={id} />}
      {selected && !exporting && !readonly && (
        <NodeResizer
          nodeId={id}
          minWidth={80}
          minHeight={50}
          color="#267b6a"
          onResizeEnd={resize}
        />
      )}
      <NotationNodePorts
        id={id}
        value={notation}
        width={width ?? node.width}
        height={height ?? node.height}
        connectable={!readonly}
        exporting={exporting}
        mindmap={!!data.mindmap}
      />
    </div>
  );
});
