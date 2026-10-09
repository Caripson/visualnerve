import { useI18n } from '../../i18n';
import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import type { ParticleType, Resource, Improvement, SimulationNode } from '../types';
import type { EditorSectionProps } from './types';
export function EconomicsEditor({ draft, setDraft, scenarioId }: EditorSectionProps) {
  const { t } = useI18n();
  return (
    <>
      <label className="simulation-field">
        {t('simulator.common.currency')}{' '}
        <input
          aria-label={t('simulator.editor.economics.simulationCurrency')}
          disabled={!!scenarioId}
          value={draft.currency}
          onChange={(event) => setDraft((model) => ({ ...model, currency: event.target.value }))}
        />
      </label>
      <NumberField
        label={t('simulator.editor.economics.maximumBudget')}
        value={draft.economics?.maximumBudget}
        change={(value) =>
          setDraft((model) => ({
            ...model,
            economics: { ...model.economics, maximumBudget: value },
          }))
        }
      />
      <label className="simulation-field">
        {t('simulator.run.assumptions')}{' '}
        <textarea
          aria-label={t('simulator.editor.economics.simulationAssumptions')}
          disabled={!!scenarioId}
          rows={5}
          value={draft.description ?? ''}
          onChange={(event) => setDraft((model) => ({ ...model, description: event.target.value }))}
        />
      </label>
      <p>
        {t(
          'simulator.editor.economics.contributionRealizedRevenueOperatingResourceAndScalingCostsCashImpactAlsoDeducts',
        )}
      </p>
    </>
  );
}
