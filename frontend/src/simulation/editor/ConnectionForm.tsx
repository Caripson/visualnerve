import { useI18n } from '../../i18n';
import { useState } from 'react';
import type { SimulationModel } from '../types';
export function ConnectionForm({
  model,
  add,
}: {
  model: SimulationModel;
  add: (source: string, target: string) => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState(
    model.nodes.find((node) => node.type !== 'resource')?.id ?? '',
  );
  const [target, setTarget] = useState(model.nodes.find((node) => node.type === 'work')?.id ?? '');
  return (
    <fieldset>
      <legend>{t('simulator.common.addAProcessConnection')}</legend>
      <div className="simulation-row">
        <label>
          {t('simulator.common.from')}{' '}
          <select
            aria-label={t('simulator.common.connectionFrom')}
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
          {t('simulator.common.to')}{' '}
          <select
            aria-label={t('simulator.common.connectionTo')}
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
          {t('simulator.common.connectProcessNodes')}
        </button>
      </div>
    </fieldset>
  );
}
