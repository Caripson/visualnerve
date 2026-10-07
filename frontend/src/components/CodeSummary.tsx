import type { GraphNode } from '../model/types';
import { getCodeObject } from '../code/schema';
import { codeLanguages } from '../code/catalog';
import './code-summary.css';

export function CodeSummary({
  node,
  exporting = false,
  selected = false,
}: {
  node: GraphNode;
  exporting?: boolean;
  selected?: boolean;
}) {
  const object = getCodeObject(node);
  if (!object) return null;
  return (
    <div className="code-summary" aria-label="Code object summary" data-exporting={exporting}>
      <div className="code-object-kind">
        {codeLanguages.find((language) => language.id === object.language)?.name ?? object.language}{' '}
        · {object.kind}
        {object.external && <span> · unresolved</span>}
      </div>
      <div
        className="code-object-scroll nodrag nopan nowheel"
        data-node-scroll
        role="region"
        aria-label={`Code details for ${node.title}`}
        tabIndex={exporting ? undefined : 0}
        onKeyDown={(event) => {
          if (
            [
              'ArrowUp',
              'ArrowDown',
              'ArrowLeft',
              'ArrowRight',
              'PageUp',
              'PageDown',
              'Home',
              'End',
              ' ',
            ].includes(event.key)
          )
            event.stopPropagation();
        }}
      >
        {object.kind !== 'file' && (
          <div className="code-object-name">
            <span>Symbol</span> {object.name}
          </div>
        )}
        <div className="code-object-path">
          {object.path}
          {object.line ? `:${object.line}` : ''}
          {object.endLine && object.endLine !== object.line ? `–${object.endLine}` : ''}
        </div>
        {!!object.summary?.length && (
          <ul aria-label="Declarations">
            {object.summary.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="code-summary-footer">
        {!!object.summary?.length && <span>{object.summary.length} declarations</span>}
        {!exporting && (
          <span
            className="code-resize-hint"
            title="Scroll to read the details. Select this node and drag a corner to enlarge it."
          >
            {selected ? 'Drag a corner to resize' : 'Select to resize'}
          </span>
        )}
      </div>
    </div>
  );
}
