import { Shapes } from 'lucide-react';
import type { GraphNode } from '../model/types';
import { ToolbarMenu } from '../components/ToolbarMenu';
import { IbmSymbolGlyph } from './IbmSymbol';
import { getIbmSymbol, ibmSymbols, type IBMSymbolId } from './ibm-symbols';
import { ibmSymbolSize } from './template';
import './controls.css';

export function IbmSymbolProperties({
  node,
  update,
}: {
  node: GraphNode;
  update: (patch: Partial<GraphNode>, coalesce?: boolean) => void;
}) {
  const symbol = getIbmSymbol(node.flowchartSymbol);
  return (
    <section className="ibm-symbol-properties" aria-label="IBM symbol appearance">
      <label className="field">
        <span>IBM flowchart symbol</span>
        <select
          aria-label="IBM flowchart symbol"
          value={node.flowchartSymbol ?? ''}
          onChange={(event) =>
            update(
              {
                flowchartSymbol: event.target.value
                  ? (event.target.value as IBMSymbolId)
                  : undefined,
              },
              false,
            )
          }
        >
          <option value="">Default node appearance</option>
          <optgroup label="Completed symbols">
            {ibmSymbols
              .filter((item) => item.category === 'symbol')
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="Stencil outlines and arrowheads">
            {ibmSymbols
              .filter((item) => item.category === 'outline' || item.category === 'arrowhead')
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="Original X20-8020 forms">
            {ibmSymbols
              .filter((item) => item.category === 'legacy')
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
          </optgroup>
        </select>
      </label>
      {symbol && (
        <>
          <div
            className="ibm-symbol-preview"
            style={{ '--node-accent': node.color || '#31766c' } as React.CSSProperties}
          >
            <IbmSymbolGlyph symbol={symbol} size={48} />
            <p>
              {symbol.category === 'legacy'
                ? 'Original stencil form'
                : symbol.physicalCutout
                  ? 'Stencil cutout'
                  : 'Completed sleeve symbol'}{' '}
              · {symbol.label}
            </p>
          </div>
          <button className="full" onClick={() => update(ibmSymbolSize(symbol.id), false)}>
            Use stencil proportions
          </button>
        </>
      )}
      <p className="muted">
        The symbol changes the outline in 2D and 3D. Title, color and node type remain editable.
      </p>
      <a href="/help/ibm-flowcharting/" target="_blank" rel="noreferrer">
        IBM symbol guide
      </a>
    </section>
  );
}

export function IbmSymbolPalette({
  add,
  compact = false,
}: {
  add: (node: Partial<GraphNode>) => void;
  compact?: boolean;
}) {
  return (
    <ToolbarMenu label="IBM symbols" icon={<Shapes size={18} />} text={!compact}>
      <h3>Classic Flowcharting</h3>
      <p>Based on the IBM GX20-8020 stencil.</p>
      <p>26 stencil cutouts, plus completed symbols from the original sleeve.</p>
      <div className="ibm-symbol-palette">
        {ibmSymbols.map((symbol) => (
          <button
            key={symbol.id}
            aria-label={`Add IBM ${symbol.label}`}
            onClick={() =>
              add({
                nodeType: symbol.nodeType,
                flowchartSymbol: symbol.id,
                title: symbol.label,
                ...ibmSymbolSize(symbol.id),
              })
            }
          >
            <IbmSymbolGlyph symbol={symbol} size={36} />
            <span>
              {symbol.label}
              <small>
                {symbol.category === 'legacy'
                  ? 'Original revision'
                  : symbol.physicalCutout
                    ? 'Cutout'
                    : 'Completed symbol'}
              </small>
            </span>
          </button>
        ))}
      </div>
      <p className="muted">
        IBM is a trademark of International Business Machines Corporation. Visual Nerve is not
        affiliated with or endorsed by IBM.
      </p>
    </ToolbarMenu>
  );
}
