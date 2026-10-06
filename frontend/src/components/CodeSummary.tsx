import type { GraphNode } from '../model/types';
import { getCodeObject } from '../code/schema';
import { codeLanguages } from '../code/catalog';
import './code-summary.css';

export function CodeSummary({ node }: { node: GraphNode }) {
  const object = getCodeObject(node);
  if (!object) return null;
  return (
    <div className="code-summary" aria-label="Code object summary">
      <div className="code-object-kind">
        {codeLanguages.find((language) => language.id === object.language)?.name ?? object.language}{' '}
        · {object.kind}
        {object.external && <span> · unresolved</span>}
      </div>
      <div
        className="code-object-path"
        title={`${object.path}${object.line ? `:${object.line}` : ''}`}
      >
        {object.path}
        {object.line ? `:${object.line}` : ''}
      </div>
      {!!object.summary?.length && (
        <ul>
          {object.summary.slice(0, 6).map((name, index) => (
            <li key={index} title={name}>
              {name}
            </li>
          ))}
        </ul>
      )}
      {(object.summary?.length ?? 0) > 6 && (
        <p className="code-object-overflow">+{object.summary!.length - 6} more declarations</p>
      )}
    </div>
  );
}
