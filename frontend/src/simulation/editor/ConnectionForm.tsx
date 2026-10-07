import { useState } from 'react';
import type { SimulationModel } from '../types';
export function ConnectionForm({
  model,
  add,
}: {
  model: SimulationModel;
  add: (source: string, target: string) => void;
}) {
  const [source, setSource] = useState(
    model.nodes.find((node) => node.type !== 'resource')?.id ?? '',
  );
  const [target, setTarget] = useState(model.nodes.find((node) => node.type === 'work')?.id ?? '');
  return (
    <fieldset>
      <legend>Add a process connection</legend>
      <div className="simulation-row">
        <label>
          From
          <select
            aria-label="Connection from"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            {model.nodes
              .filter((node) => node.type !== 'resource' && node.type !== 'outcome')
              .map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          To
          <select
            aria-label="Connection to"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            {model.nodes
              .filter((node) => node.type !== 'resource' && node.type !== 'source')
              .map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
          </select>
        </label>
        <button
          disabled={!source || !target || source === target}
          onClick={() => add(source, target)}
        >
          Connect process nodes
        </button>
      </div>
    </fieldset>
  );
}
