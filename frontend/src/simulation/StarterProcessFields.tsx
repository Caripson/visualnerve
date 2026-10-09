import { useI18n } from '../i18n';
import type { ProcessStarterDraft, ProcessStarterStepDraft } from './starter';

export function StarterProcessFields({
  draft,
  change,
}: {
  draft: ProcessStarterDraft;
  change: (patch: Partial<ProcessStarterDraft>) => void;
}) {
  const { t } = useI18n();
  function update(id: string, patch: Partial<ProcessStarterStepDraft>) {
    change({ steps: draft.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)) });
  }
  return (
    <section
      className="process-starter-subprocesses"
      aria-label={t('simulator.wizard.subprocess.subprocessConfiguration')}
    >
      <label className="process-wizard-field">
        <span>{t('simulator.wizard.subprocess.mainProcessName')}</span>
        <input
          aria-label={t('simulator.wizard.subprocess.mainProcessName')}
          value={draft.mainProcessName}
          required
          onChange={(event) => change({ mainProcessName: event.target.value })}
        />
        <small>
          {t(
            'simulator.wizard.subprocess.openThisProcessOnTheCanvasToInspectItsSubprocessesAndReal',
          )}
        </small>
      </label>
      <ol>
        {draft.steps.map((step, index) => (
          <li key={step.id}>
            <header>
              <strong>
                {' '}
                {t('simulator.wizard.subprocess.subprocess')} {index + 1}
              </strong>
              <button
                type="button"
                disabled={draft.steps.length === 1}
                aria-label={t('simulator.wizard.subprocess.removeSubprocess', {
                  stepNumber: String(index + 1),
                })}
                onClick={() =>
                  change({ steps: draft.steps.filter((entry) => entry.id !== step.id) })
                }
              >
                {t('simulator.common.remove')}
              </button>
            </header>
            <div className="process-wizard-grid">
              <label className="process-wizard-field">
                <span>{t('simulator.wizard.subprocess.subprocessName')}</span>
                <input
                  aria-label={t('simulator.wizard.subprocess.subprocessName.value1', {
                    stepNumber: String(index + 1),
                  })}
                  required
                  value={step.name}
                  onChange={(event) => update(step.id, { name: event.target.value })}
                />
              </label>
              <label className="process-wizard-field">
                <span>{t('simulator.wizard.fields.workStepName')}</span>
                <input
                  aria-label={t('simulator.wizard.subprocess.subprocessWorkStepName', {
                    stepNumber: String(index + 1),
                  })}
                  required
                  value={step.workName}
                  onChange={(event) => update(step.id, { workName: event.target.value })}
                />
              </label>
              <label className="process-wizard-field">
                <span>{t('simulator.wizard.subprocess.minutesPerItem')}</span>
                <input
                  aria-label={t('simulator.wizard.subprocess.subprocessProcessingMinutes', {
                    stepNumber: String(index + 1),
                  })}
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  value={step.processingMinutes}
                  onChange={(event) => update(step.id, { processingMinutes: event.target.value })}
                />
              </label>
              <label className="process-wizard-field">
                <span>{t('simulator.wizard.subprocess.parallelCapacity')}</span>
                <input
                  aria-label={t('simulator.wizard.subprocess.subprocessCapacity', {
                    stepNumber: String(index + 1),
                  })}
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={step.capacity}
                  onChange={(event) => update(step.id, { capacity: event.target.value })}
                />
              </label>
              <label className="process-wizard-field">
                <span>
                  {t('simulator.wizard.subprocess.costLabel', { currency: draft.currency })}
                </span>
                <input
                  aria-label={t('simulator.wizard.subprocess.subprocessHourlyCost', {
                    stepNumber: String(index + 1),
                  })}
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={step.workCostPerHour}
                  onChange={(event) => update(step.id, { workCostPerHour: event.target.value })}
                />
              </label>
              <label className="process-wizard-check">
                <input
                  type="checkbox"
                  aria-label={t('simulator.wizard.subprocess.subprocessUseSharedResource', {
                    stepNumber: String(index + 1),
                    name: String(step.name),
                  })}
                  checked={step.usesSharedResource}
                  onChange={(event) =>
                    update(step.id, { usesSharedResource: event.target.checked })
                  }
                />
                <span>
                  <b>{t('simulator.wizard.subprocess.useSharedResourceInThisStep')}</b>
                  <small>
                    {t('simulator.wizard.subprocess.appliesWhenTheSharedPoolBelowIsEnabled')}
                  </small>
                </span>
              </label>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        disabled={draft.steps.length >= 12}
        onClick={() =>
          change({
            steps: [
              ...draft.steps,
              {
                id: crypto.randomUUID(),
                name: `Subprocess ${draft.steps.length + 1}`,
                workName: 'Process work',
                processingMinutes: '2',
                capacity: '1',
                workCostPerHour: '0',
                usesSharedResource: true,
              },
            ],
          })
        }
      >
        {t('simulator.wizard.subprocess.addSubprocess')}
      </button>
      <p className="process-wizard-note">
        {t(
          'simulator.wizard.subprocess.itemsFollowTheseStepsInOrderEachSubprocessStartsWithOneEditable',
        )}
      </p>
    </section>
  );
}
