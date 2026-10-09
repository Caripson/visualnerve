import { useI18n } from '../i18n';
import type { ProcessStarterDraft } from './starter';
import { StarterProcessFields } from './StarterProcessFields';

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
  const { t } = useI18n();
  const { draft, change } = props;
  return (
    <>
      <div className="process-wizard-intro">
        <h3>{t('simulator.wizard.fields.whatMovesThroughYourProcess')}</h3>
        <p>
          {t('simulator.wizard.fields.oneParticleRepresentsOneRealWorkItemGiveItAFamiliarName')}
        </p>
      </div>
      <StarterField
        {...props}
        field="itemName"
        label={t('simulator.wizard.fields.workItemName')}
        help={t('simulator.wizard.fields.forExampleCustomerOrderPackageOrSupportCase')}
      />
      <div
        className="process-arrival-options"
        role="group"
        aria-label={t('simulator.wizard.fields.arrivalPattern')}
      >
        <button
          type="button"
          aria-pressed={draft.arrivalMode === 'regular'}
          onClick={() => change({ arrivalMode: 'regular' })}
        >
          <b>{t('simulator.wizard.fields.continuousArrivals')}</b>
          <span>{t('simulator.wizard.fields.itemsArriveEvenlyThroughoutTheRun')}</span>
        </button>
        <button
          type="button"
          aria-pressed={draft.arrivalMode === 'batch'}
          onClick={() => change({ arrivalMode: 'batch' })}
        >
          <b>{t('simulator.wizard.fields.aFixedBatch')}</b>
          <span>{t('simulator.wizard.fields.allItemsArriveTogetherAtTheStart')}</span>
        </button>
      </div>
      <div className="process-wizard-grid">
        {draft.arrivalMode === 'regular' ? (
          <StarterField
            {...props}
            field="arrivalsPerHour"
            label={t('simulator.wizard.fields.arrivalRateItemsHour')}
            number
            min={0.001}
          />
        ) : (
          <StarterField
            {...props}
            field="batchCount"
            label={t('simulator.wizard.fields.batchSizeItems')}
            number
            min={1}
            step="1"
            help={t('simulator.wizard.fields.upTo100000ItemsInThisStarterAdjustLargerModelsIn')}
          />
        )}
        <StarterField
          {...props}
          field="durationHours"
          label={t('simulator.wizard.fields.simulationLengthHours')}
          number
          min={0.001}
          help={
            draft.arrivalMode === 'batch'
              ? t(
                  'simulator.wizard.fields.theRunAlsoFinishesTheGeneratedBatchYouCanChangeThisAfter',
                )
              : t('simulator.wizard.fields.arrivalsContinueForThisSimulatedPeriod')
          }
        />
      </div>
    </>
  );
}

export function ProcessingStep(props: Props) {
  const { t } = useI18n();
  const { draft, change } = props;
  return (
    <>
      <div className="process-wizard-intro">
        <h3>{t('simulator.wizard.fields.whereDoesTheWorkHappen')}</h3>
        <p>
          {t(
            'simulator.wizard.fields.startWithOneWorkStepOrAMainProcessContainingIndependentlyConfigured',
          )}
        </p>
      </div>
      <div
        className="process-arrival-options"
        role="group"
        aria-label={t('simulator.wizard.fields.processStructure')}
      >
        <button
          type="button"
          aria-pressed={draft.structure === 'single'}
          onClick={() => change({ structure: 'single' })}
        >
          <b>{t('simulator.wizard.fields.oneWorkStep')}</b>
          <span>{t('simulator.wizard.fields.aSimpleStartingPointYouCanExtendLater')}</span>
        </button>
        <button
          type="button"
          aria-pressed={draft.structure === 'hierarchical'}
          onClick={() => change({ structure: 'hierarchical' })}
        >
          <b>{t('simulator.wizard.fields.mainProcessAndSubprocesses')}</b>
          <span>{t('simulator.wizard.fields.setSeparateCapacityTimeAndCostForEachStage')}</span>
        </button>
      </div>
      {draft.structure === 'hierarchical' ? (
        <StarterProcessFields draft={draft} change={change} />
      ) : (
        <>
          <StarterField
            {...props}
            field="workName"
            label={t('simulator.wizard.fields.workStepName')}
            help={t('simulator.wizard.fields.useAnActionSuchAsPackOrderOrServeCustomer')}
          />
          <div className="process-wizard-grid">
            <StarterField
              {...props}
              field="processingMinutes"
              label={t('simulator.wizard.fields.processingTimeMinutesItem')}
              number
              min={0.001}
            />
            <StarterField
              {...props}
              field="capacity"
              label={t('simulator.wizard.fields.parallelCapacitySlots')}
              number
              min={1}
              step="1"
              help={t('simulator.wizard.fields.howManyItemsThisStepCanProcessAtOnce')}
            />
          </div>
        </>
      )}
      <div className="process-wizard-grid">
        <StarterField
          {...props}
          field="transferSeconds"
          label={t('simulator.wizard.fields.travelTimePerConnectionSeconds')}
          number
          help={t(
            'simulator.wizard.fields.realSimulatedTransferTimeBetweenStepsZeroMeansInstantTransfer',
          )}
        />
      </div>
      <label className="process-wizard-check">
        <input
          type="checkbox"
          checked={draft.sharedResource}
          onChange={(event) => change({ sharedResource: event.target.checked })}
        />
        <span>
          <b>{t('simulator.wizard.fields.useASharedResource')}</b>
          <small>
            {t('simulator.wizard.fields.staffOrEquipmentThatOtherWorkStepsCanCompeteFor')}
          </small>
        </span>
      </label>
      {draft.sharedResource && (
        <div className="process-wizard-resource">
          <StarterField
            {...props}
            field="resourceName"
            label={t('simulator.wizard.fields.sharedResourceName')}
          />
          <StarterField
            {...props}
            field="resourceCapacity"
            label={t('simulator.wizard.fields.sharedResourceCapacityUnits')}
            number
            min={1}
            step="1"
            help={t(
              'simulator.wizard.fields.eachProcessingItemNeedsOneUnitTheResourceAppearsAsASeparate',
            )}
          />
        </div>
      )}
    </>
  );
}

export function EconomicsStep(props: Props) {
  const { t } = useI18n();
  const { draft, change } = props;
  return (
    <>
      <div className="process-wizard-intro">
        <h3>{t('simulator.wizard.fields.whatIsTheBusinessImpact')}</h3>
        <p>
          {t(
            'simulator.wizard.fields.revenueIsRealizedWhenAnItemCompletesHourlyCostsApplyToAvailable',
          )}
        </p>
      </div>
      <label className="process-wizard-field">
        <span>{t('simulator.common.currency')}</span>
        <input
          aria-label={t('simulator.common.currency')}
          value={draft.currency}
          maxLength={3}
          required
          pattern="[A-Z]{3}"
          onChange={(event) => change({ currency: event.target.value.toUpperCase() })}
        />
        <small>{t('simulator.wizard.fields.aThreeLetterCodeSuchAsSekEurOrUsd')}</small>
      </label>
      <div className="process-wizard-grid">
        <StarterField
          {...props}
          field="revenue"
          label={t('simulator.wizard.fields.revenuePerCompletedItem', {
            currency: String(draft.currency),
          })}
          number
        />
        {draft.structure === 'single' && (
          <StarterField
            {...props}
            field="workCostPerHour"
            label={t('simulator.wizard.fields.workCostPerSlotHour', {
              currency: String(draft.currency),
            })}
            number
            help={t(
              'simulator.wizard.fields.useThisForTheWorkStepItselfAddStaffCostsSeparatelyBelow',
            )}
          />
        )}
        {draft.sharedResource && (
          <StarterField
            {...props}
            field="resourceCostPerHour"
            label={t('simulator.wizard.fields.sharedResourceCostPerUnitHour', {
              currency: String(draft.currency),
            })}
            number
          />
        )}
        <StarterField
          {...props}
          field="patienceMinutes"
          label={t('simulator.wizard.fields.maximumQueueWaitMinutes')}
          number
          min={0.001}
          optional
          help={t(
            'simulator.wizard.fields.optionalLeaveBlankIfItemsNeverAbandonTheQueueAbandonedItemsLose',
          )}
        />
      </div>
      <p className="process-wizard-note">
        {t(
          'simulator.wizard.fields.theStarterUsesFifoQueuesAndEqualItemComplexityAdvancedRoutingPriorities',
        )}
      </p>
    </>
  );
}
