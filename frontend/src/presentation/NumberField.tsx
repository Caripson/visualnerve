import { presentationMessage } from './display-messages';
import { useI18n } from '../i18n';
import { useState } from 'react';
import type { Graph } from '../model/types';
import { useEditor } from '../state/editor';
import { assignPresentationNumber, getPresentation, presentationNumber } from './definition';
export function PresentationNumberField({ graph, nodeId }: { graph: Graph; nodeId: string }) {
  const { t } = useI18n();
  const number = presentationNumber(graph, nodeId);
  const [error, setError] = useState('');
  return (
    <div className="field">
      <label htmlFor="presentation-number">{t('presentation.numberField')}</label>
      <input
        id="presentation-number"
        type="number"
        min="1"
        max={getPresentation(graph).nodeIds.length + (number === null ? 1 : 0)}
        aria-label={t('presentation.numberField')}
        key={`${nodeId}:${number}`}
        defaultValue={number ?? ''}
        placeholder={t('presentation.notInWalkthrough')}
        onBlur={(event) => {
          try {
            const value = event.target.value.trim();
            useEditor
              .getState()
              .command('Number presentation node', (current) =>
                assignPresentationNumber(current, nodeId, value ? Number(value) : null),
              );
            setError('');
          } catch (error) {
            setError((error as Error).message);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <small className="muted">{t('presentation.numberFieldHint')}</small>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
