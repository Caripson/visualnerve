import type { ProcessStarterDraft, ProcessStarterStepDraft } from './starter';

export function StarterProcessFields({
  draft,
  change,
}: {
  draft: ProcessStarterDraft;
  change: (patch: Partial<ProcessStarterDraft>) => void;
}) {
  function update(id: string, patch: Partial<ProcessStarterStepDraft>) {
    change({ steps: draft.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)) });
  }
  return (
    <section className="process-starter-subprocesses" aria-label="Subprocess configuration">
      <label className="process-wizard-field">
        <span>Main process name</span>
        <input
          aria-label="Main process name"
          value={draft.mainProcessName}
          required
          onChange={(event) => change({ mainProcessName: event.target.value })}
        />
        <small>
          Open this process on the canvas to inspect its subprocesses and real bottlenecks.
        </small>
      </label>
      <ol>
        {draft.steps.map((step, index) => (
          <li key={step.id}>
            <header>
              <strong>Subprocess {index + 1}</strong>
              <button
                type="button"
                disabled={draft.steps.length === 1}
                aria-label={`Remove subprocess ${index + 1}`}
                onClick={() =>
                  change({ steps: draft.steps.filter((entry) => entry.id !== step.id) })
                }
              >
                Remove
              </button>
            </header>
            <div className="process-wizard-grid">
              <label className="process-wizard-field">
                <span>Subprocess name</span>
                <input
                  aria-label={`Subprocess ${index + 1} name`}
                  required
                  value={step.name}
                  onChange={(event) => update(step.id, { name: event.target.value })}
                />
              </label>
              <label className="process-wizard-field">
                <span>Work step name</span>
                <input
                  aria-label={`Subprocess ${index + 1} work step name`}
                  required
                  value={step.workName}
                  onChange={(event) => update(step.id, { workName: event.target.value })}
                />
              </label>
              <label className="process-wizard-field">
                <span>Minutes per item</span>
                <input
                  aria-label={`Subprocess ${index + 1} processing minutes`}
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  value={step.processingMinutes}
                  onChange={(event) => update(step.id, { processingMinutes: event.target.value })}
                />
              </label>
              <label className="process-wizard-field">
                <span>Parallel capacity</span>
                <input
                  aria-label={`Subprocess ${index + 1} capacity`}
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={step.capacity}
                  onChange={(event) => update(step.id, { capacity: event.target.value })}
                />
              </label>
              <label className="process-wizard-field">
                <span>Cost / slot / hour ({draft.currency})</span>
                <input
                  aria-label={`Subprocess ${index + 1} hourly cost`}
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
                  aria-label={`Subprocess ${index + 1} (${step.name}): use shared resource`}
                  checked={step.usesSharedResource}
                  onChange={(event) =>
                    update(step.id, { usesSharedResource: event.target.checked })
                  }
                />
                <span>
                  <b>Use shared resource in this step</b>
                  <small>Applies when the shared pool below is enabled.</small>
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
        Add subprocess
      </button>
      <p className="process-wizard-note">
        Items follow these steps in order. Each subprocess starts with one editable Work node. Add
        branches, more steps or deeper levels in Assumptions afterwards. Containers summarize their
        children and add no processing time or cost.
      </p>
    </section>
  );
}
