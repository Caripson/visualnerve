import { ArrowRight, CircleCheck, Inbox, Users, Workflow } from 'lucide-react';
import { starterValues, type ProcessStarterDraft } from './starter';

export function StarterReview({ draft, seed = 42 }: { draft: ProcessStarterDraft; seed?: number }) {
  const value = starterValues(draft);
  const slots = draft.sharedResource
    ? Math.min(value.capacity, value.resourceCapacity)
    : value.capacity;
  const throughput = (slots * 3600) / value.processingSeconds;
  const hourlyCost =
    value.capacity * value.workCostPerHour + value.resourceCapacity * value.resourceCostPerHour;
  const overloaded = draft.arrivalMode === 'regular' && value.arrivalsPerHour > throughput;
  return (
    <>
      <div className="process-wizard-intro">
        <h3>Your first working process</h3>
        <p>
          Review the assumptions, then create an editable diagram. Press Play to watch real work
          move and queues form.
        </p>
      </div>
      <div className="process-starter-preview" aria-label="Process preview">
        <div>
          <Inbox size={20} />
          <b>{value.itemName} arrivals</b>
          <small>
            {draft.arrivalMode === 'batch'
              ? `${value.batchCount} items at the start`
              : `${value.arrivalsPerHour} items/hour`}
          </small>
        </div>
        <ArrowRight aria-hidden size={18} />
        <div>
          <Workflow size={20} />
          <b>{value.workName}</b>
          <small>
            {value.processingSeconds / 60} min/item · {value.capacity}{' '}
            {value.capacity === 1 ? 'slot' : 'slots'}
          </small>
        </div>
        <ArrowRight aria-hidden size={18} />
        <div>
          <CircleCheck size={20} />
          <b>Completed</b>
          <small>
            {value.revenue} {draft.currency}/item
          </small>
        </div>
      </div>
      {draft.sharedResource && (
        <p className="process-wizard-resource-summary">
          <Users size={17} />
          {value.resourceName}: {value.resourceCapacity}{' '}
          {value.resourceCapacity === 1 ? 'unit' : 'units'}, shared by connected work steps.
        </p>
      )}
      <dl className="process-wizard-facts">
        <div>
          <dt>Transfer between steps</dt>
          <dd>{value.transferSeconds} simulated seconds per connection</dd>
        </div>
        <div>
          <dt>Available processing capacity</dt>
          <dd>Up to {Number(throughput.toFixed(2))} items/hour before downstream constraints</dd>
        </div>
        <div>
          <dt>Hourly operating cost</dt>
          <dd>
            {hourlyCost} {draft.currency}/hour
          </dd>
        </div>
        <div>
          <dt>Queue patience</dt>
          <dd>
            {value.patienceSeconds === undefined
              ? 'No abandonment limit'
              : `${value.patienceSeconds / 60} minutes`}
          </dd>
        </div>
        <div>
          <dt>Run</dt>
          <dd>
            {draft.arrivalMode === 'batch'
              ? `Finish the batch; arrival window ${value.durationSeconds / 3600} hours`
              : `${value.durationSeconds / 3600} simulated hours`}{' '}
            · seed {seed}
          </dd>
        </div>
      </dl>
      {overloaded && (
        <p className="process-wizard-warning" role="status">
          Demand exceeds processing capacity. A queue is expected: this is a useful starting point
          for testing extra capacity or shared resources.
        </p>
      )}
      <p className="process-wizard-note">
        After setup, select a node to extend the process. Use Assumptions to refine it, create a
        scenario to try a change, then compare runs. Your model and results stay in this browser.
      </p>
    </>
  );
}
