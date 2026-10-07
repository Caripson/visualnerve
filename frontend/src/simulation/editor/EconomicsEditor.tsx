import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import type { ParticleType, Resource, Improvement, SimulationNode } from '../types';
import type { EditorSectionProps } from './types';
export function EconomicsEditor({ draft, setDraft, scenarioId }: EditorSectionProps) {
  return (
    <>
      <label className="simulation-field">
        Currency
        <input
          aria-label="Simulation currency"
          disabled={!!scenarioId}
          value={draft.currency}
          onChange={(event) => setDraft((model) => ({ ...model, currency: event.target.value }))}
        />
      </label>
      <NumberField
        label="Maximum budget"
        value={draft.economics?.maximumBudget}
        change={(value) =>
          setDraft((model) => ({
            ...model,
            economics: { ...model.economics, maximumBudget: value },
          }))
        }
      />
      <label className="simulation-field">
        Assumptions
        <textarea
          aria-label="Simulation assumptions"
          disabled={!!scenarioId}
          rows={5}
          value={draft.description ?? ''}
          onChange={(event) => setDraft((model) => ({ ...model, description: event.target.value }))}
        />
      </label>
      <p>
        Contribution = realized revenue − operating, resource and scaling costs. Cash impact also
        deducts investment. Lost revenue is reported separately.
      </p>
    </>
  );
}
