import { ArrowRight, CircleCheck, Inbox, Users, Workflow } from 'lucide-react';
import type { ProcessStarterDraft } from './starter';
import { ProcessStarterAnalysis } from './starter-analysis';

export function StarterReview({ draft, seed = 42 }: { draft: ProcessStarterDraft; seed?: number }) {
  const analysis = new ProcessStarterAnalysis(draft);
  const value = analysis.values;
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
              ? `${value.batchCount} ${value.batchCount === 1 ? 'item' : 'items'} at the start`
              : `${value.arrivalsPerHour} items/hour`}
          </small>
        </div>
        <ArrowRight aria-hidden size={18} />
        <div>
          <Workflow size={20} />
          <b>{value.workName}</b>
          <small>
            {draft.structure === 'hierarchical'
              ? `${value.steps.length} subprocesses with independent settings`
              : `${value.processingSeconds / 60} min/item · ${value.capacity} ${value.capacity === 1 ? 'slot' : 'slots'}`}
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
      {draft.structure === 'hierarchical' && (
        <ol className="process-starter-review-steps" aria-label="Subprocess review">
          {value.steps.map((step, index) => (
            <li key={index}>
              <strong>
                {index + 1}. {step.name}
              </strong>
              <span>
                {step.workName} · {step.processingSeconds / 60} min/item · {step.capacity}{' '}
                {step.capacity === 1 ? 'slot' : 'slots'} · {step.costPerHour} {draft.currency}
                /slot/hour
              </span>
              <span>
                {draft.sharedResource && step.usesSharedResource
                  ? `Shared pool: ${value.resourceName}`
                  : 'No shared pool required'}
              </span>
            </li>
          ))}
        </ol>
      )}
      {draft.sharedResource && (
        <p className="process-wizard-resource-summary">
          <Users size={17} />
          {value.resourceName}: {value.resourceCapacity}{' '}
          {value.resourceCapacity === 1 ? 'unit' : 'units'}, shared by connected work steps.
        </p>
      )}
      {draft.sharedResource && !value.steps.some((step) => step.usesSharedResource) && (
        <p className="process-wizard-warning">
          No step uses this pool. Its available capacity still incurs the configured hourly cost. Go
          back to assign steps or turn off the shared pool.
        </p>
      )}
      <dl className="process-wizard-facts">
        <div>
          <dt>Transfer between steps</dt>
          <dd>{value.transferSeconds} simulated seconds per connection</dd>
        </div>
        <div>
          <dt>Estimated flow capacity</dt>
          <dd>
            Up to {Number(analysis.throughputPerHour.toFixed(2))} items/hour across these steps. Run
            the model to measure waits and transfers.
          </dd>
        </div>
        <div>
          <dt>New capacity cost per hour</dt>
          <dd>
            {analysis.hourlyOperatingCost} {draft.currency}/hour
            <small>Existing model resources and improvements keep their configured costs.</small>
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
      {analysis.overloaded && (
        <p className="process-wizard-warning" role="status">
          Demand exceeds processing capacity. A queue is expected: this is a useful starting point
          for testing extra capacity or shared resources.
        </p>
      )}
      <p className="process-wizard-note">
        {draft.structure === 'hierarchical'
          ? 'After setup, open the main process, then a subprocess to select or add Work steps. '
          : 'After setup, select a node to extend the process. '}
        Use Assumptions to refine it, create a scenario to try a change, then compare runs. Your
        model and results stay in this browser.
      </p>
    </>
  );
}
