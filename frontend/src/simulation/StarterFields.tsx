import type { ProcessStarterDraft } from './starter';

type Props = {
  draft: ProcessStarterDraft;
  change: (patch: Partial<ProcessStarterDraft>) => void;
};

function StarterField({
  draft,
  change,
  field,
  label,
  help,
  number = false,
  min = 0,
  step = 'any',
  optional = false,
}: Props & {
  field: keyof ProcessStarterDraft;
  label: string;
  help?: string;
  number?: boolean;
  min?: number;
  step?: string;
  optional?: boolean;
}) {
  return (
    <label className="process-wizard-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type={number ? 'number' : 'text'}
        min={number ? min : undefined}
        step={number ? step : undefined}
        value={String(draft[field])}
        onChange={(event) => change({ [field]: event.target.value })}
        required={!optional}
      />
      {help && <small>{help}</small>}
    </label>
  );
}

export function WorkloadStep(props: Props) {
  const { draft, change } = props;
  return (
    <>
      <div className="process-wizard-intro">
        <h3>What moves through your process?</h3>
        <p>
          One particle represents one real work item. Give it a familiar name and choose how it
          arrives.
        </p>
      </div>
      <StarterField
        {...props}
        field="itemName"
        label="Work item name"
        help="For example: Customer, Order, Package or Support case."
      />
      <div className="process-arrival-options" role="group" aria-label="Arrival pattern">
        <button
          type="button"
          aria-pressed={draft.arrivalMode === 'regular'}
          onClick={() => change({ arrivalMode: 'regular' })}
        >
          <b>Continuous arrivals</b>
          <span>Items arrive evenly throughout the run.</span>
        </button>
        <button
          type="button"
          aria-pressed={draft.arrivalMode === 'batch'}
          onClick={() => change({ arrivalMode: 'batch' })}
        >
          <b>A fixed batch</b>
          <span>All items arrive together at the start.</span>
        </button>
      </div>
      <div className="process-wizard-grid">
        {draft.arrivalMode === 'regular' ? (
          <StarterField
            {...props}
            field="arrivalsPerHour"
            label="Arrival rate (items/hour)"
            number
            min={0.001}
          />
        ) : (
          <StarterField
            {...props}
            field="batchCount"
            label="Batch size (items)"
            number
            min={1}
            step="1"
            help="Up to 100,000 items in this starter. Adjust larger models in Assumptions."
          />
        )}
        <StarterField
          {...props}
          field="durationHours"
          label="Simulation length (hours)"
          number
          min={0.001}
          help={
            draft.arrivalMode === 'batch'
              ? 'The run also finishes the generated batch. You can change this after setup.'
              : 'Arrivals continue for this simulated period.'
          }
        />
      </div>
    </>
  );
}

export function ProcessingStep(props: Props) {
  const { draft, change } = props;
  return (
    <>
      <div className="process-wizard-intro">
        <h3>Where does the work happen?</h3>
        <p>
          Items wait in a queue when every slot is busy. The first process starts with one work
          step; add more steps directly from its node later.
        </p>
      </div>
      <StarterField
        {...props}
        field="workName"
        label="Work step name"
        help="Use an action, such as Pack order or Serve customer."
      />
      <div className="process-wizard-grid">
        <StarterField
          {...props}
          field="processingMinutes"
          label="Processing time (minutes/item)"
          number
          min={0.001}
        />
        <StarterField
          {...props}
          field="capacity"
          label="Parallel capacity (slots)"
          number
          min={1}
          step="1"
          help="How many items this step can process at once."
        />
        <StarterField
          {...props}
          field="transferSeconds"
          label="Travel time per connection (seconds)"
          number
          help="Real simulated transfer time between steps. Zero means instant transfer."
        />
      </div>
      <label className="process-wizard-check">
        <input
          type="checkbox"
          checked={draft.sharedResource}
          onChange={(event) => change({ sharedResource: event.target.checked })}
        />
        <span>
          <b>Use a shared resource</b>
          <small>Staff or equipment that other work steps can compete for.</small>
        </span>
      </label>
      {draft.sharedResource && (
        <div className="process-wizard-resource">
          <StarterField {...props} field="resourceName" label="Shared resource name" />
          <StarterField
            {...props}
            field="resourceCapacity"
            label="Shared resource capacity (units)"
            number
            min={1}
            step="1"
            help="Each processing item needs one unit. The resource appears as a separate connected card."
          />
        </div>
      )}
    </>
  );
}

export function EconomicsStep(props: Props) {
  const { draft, change } = props;
  return (
    <>
      <div className="process-wizard-intro">
        <h3>What is the business impact?</h3>
        <p>
          Revenue is realized when an item completes. Hourly costs apply to available capacity,
          including idle time. Set zero when money is not relevant.
        </p>
      </div>
      <label className="process-wizard-field">
        <span>Currency</span>
        <input
          aria-label="Currency"
          value={draft.currency}
          maxLength={3}
          required
          pattern="[A-Z]{3}"
          onChange={(event) => change({ currency: event.target.value.toUpperCase() })}
        />
        <small>A three-letter code, such as SEK, EUR or USD.</small>
      </label>
      <div className="process-wizard-grid">
        <StarterField
          {...props}
          field="revenue"
          label={`Revenue per completed item (${draft.currency})`}
          number
        />
        <StarterField
          {...props}
          field="workCostPerHour"
          label={`Work cost per slot/hour (${draft.currency})`}
          number
          help="Use this for the work step itself. Add staff costs separately below to avoid counting them twice."
        />
        {draft.sharedResource && (
          <StarterField
            {...props}
            field="resourceCostPerHour"
            label={`Shared resource cost per unit/hour (${draft.currency})`}
            number
          />
        )}
        <StarterField
          {...props}
          field="patienceMinutes"
          label="Maximum queue wait (minutes)"
          number
          min={0.001}
          optional
          help="Optional. Leave blank if items never abandon the queue. Abandoned items lose their expected revenue."
        />
      </div>
      <p className="process-wizard-note">
        The starter uses FIFO queues and equal item complexity. Advanced routing, priorities,
        schedules, scaling and investments remain available in Assumptions.
      </p>
    </>
  );
}
