import { useI18n } from '../i18n';
import { ArrowRight, CircleCheck, Inbox, Users, Workflow } from 'lucide-react';
import type { ProcessStarterDraft } from './starter';
import { ProcessStarterAnalysis } from './starter-analysis';

export function StarterReview({ draft, seed = 42 }: { draft: ProcessStarterDraft; seed?: number }) {
  const { t, plural } = useI18n();
  const analysis = new ProcessStarterAnalysis(draft);
  const value = analysis.values;
  return (
    <>
      <div className="process-wizard-intro">
        <h3>{t('simulator.wizard.review.yourFirstWorkingProcess')}</h3>
        <p>
          {t(
            'simulator.wizard.review.reviewTheAssumptionsThenCreateAnEditableDiagramPressPlayToWatch',
          )}
        </p>
      </div>
      <div
        className="process-starter-preview"
        aria-label={t('simulator.wizard.review.processPreview')}
      >
        <div>
          <Inbox size={20} />
          <b>{t('simulator.wizard.review.arrivals', { itemName: value.itemName })}</b>
          <small>
            {draft.arrivalMode === 'batch'
              ? plural(
                  'simulator.wizard.review.batch.one',
                  'simulator.wizard.review.batch.other',
                  value.batchCount,
                )
              : t('simulator.wizard.review.itemsHour', {
                  arrivalsPerHour: String(value.arrivalsPerHour),
                })}
          </small>
        </div>
        <ArrowRight aria-hidden size={18} />
        <div>
          <Workflow size={20} />
          <b>{value.workName}</b>
          <small>
            {draft.structure === 'hierarchical'
              ? t('simulator.wizard.review.subprocessesWithIndependentSettings', {
                  count: String(value.steps.length),
                })
              : plural(
                  'simulator.wizard.review.capacity.one',
                  'simulator.wizard.review.capacity.other',
                  value.capacity,
                  { minutes: value.processingSeconds / 60 },
                )}
          </small>
        </div>
        <ArrowRight aria-hidden size={18} />
        <div>
          <CircleCheck size={20} />
          <b>{t('simulator.common.completed')}</b>
          <small>
            {t('simulator.wizard.review.revenueRate', {
              revenue: value.revenue,
              currency: draft.currency,
            })}
          </small>
        </div>
      </div>
      {draft.structure === 'hierarchical' && (
        <ol
          className="process-starter-review-steps"
          aria-label={t('simulator.wizard.review.subprocessReview')}
        >
          {value.steps.map((step, index) => (
            <li key={index}>
              <strong>
                {index + 1}. {step.name}
              </strong>
              <span>
                {plural(
                  'simulator.wizard.review.workStep.one',
                  'simulator.wizard.review.workStep.other',
                  step.capacity,
                  {
                    workName: step.workName,
                    minutes: step.processingSeconds / 60,
                    cost: step.costPerHour,
                    currency: draft.currency,
                  },
                )}
              </span>
              <span>
                {draft.sharedResource && step.usesSharedResource
                  ? t('simulator.wizard.review.sharedPool', {
                      resourceName: String(value.resourceName),
                    })
                  : t('simulator.wizard.review.noSharedPoolRequired')}
              </span>
            </li>
          ))}
        </ol>
      )}
      {draft.sharedResource && (
        <p className="process-wizard-resource-summary">
          <Users size={17} />
          {plural(
            'simulator.wizard.review.sharedCapacity.one',
            'simulator.wizard.review.sharedCapacity.other',
            value.resourceCapacity,
            { resourceName: value.resourceName },
          )}
        </p>
      )}
      {draft.sharedResource && !value.steps.some((step) => step.usesSharedResource) && (
        <p className="process-wizard-warning">
          {t(
            'simulator.wizard.review.noStepUsesThisPoolItsAvailableCapacityStillIncursTheConfigured',
          )}
        </p>
      )}
      <dl className="process-wizard-facts">
        <div>
          <dt>{t('simulator.wizard.review.transferBetweenSteps')}</dt>
          <dd>{t('simulator.wizard.review.transfer', { seconds: value.transferSeconds })}</dd>
        </div>
        <div>
          <dt>{t('simulator.wizard.review.estimatedFlowCapacity')}</dt>
          <dd>
            {t('simulator.wizard.review.flowCapacity', {
              itemsPerHour: Number(analysis.throughputPerHour.toFixed(2)),
            })}
          </dd>
        </div>
        <div>
          <dt>{t('simulator.wizard.review.newCapacityCostPerHour')}</dt>
          <dd>
            {t('simulator.wizard.review.operatingRate', {
              cost: analysis.hourlyOperatingCost,
              currency: draft.currency,
            })}
            <small>
              {t(
                'simulator.wizard.review.existingModelResourcesAndImprovementsKeepTheirConfiguredCosts',
              )}
            </small>
          </dd>
        </div>
        <div>
          <dt>{t('simulator.wizard.review.queuePatience')}</dt>
          <dd>
            {value.patienceSeconds === undefined
              ? t('simulator.wizard.review.noAbandonmentLimit')
              : t('simulator.wizard.review.minutes', {
                  minutes: String(value.patienceSeconds / 60),
                })}
          </dd>
        </div>
        <div>
          <dt>{t('simulator.wizard.review.run')}</dt>
          <dd>
            {t(
              draft.arrivalMode === 'batch'
                ? 'simulator.wizard.review.runBatch'
                : 'simulator.wizard.review.runRegular',
              { hours: value.durationSeconds / 3600, seed },
            )}
          </dd>
        </div>
      </dl>
      {analysis.overloaded && (
        <p className="process-wizard-warning" role="status">
          {t(
            'simulator.wizard.review.demandExceedsProcessingCapacityAQueueIsExpectedThisIsAUseful',
          )}
        </p>
      )}
      <p className="process-wizard-note">
        {draft.structure === 'hierarchical'
          ? t('simulator.wizard.review.afterSetupOpenTheMainProcessThenASubprocessToSelectOr')
          : t('simulator.wizard.review.afterSetupSelectANodeToExtendTheProcess')}
        {t('simulator.wizard.review.useAssumptionsToRefineItCreateAScenarioToTryAChange')}{' '}
      </p>
    </>
  );
}
