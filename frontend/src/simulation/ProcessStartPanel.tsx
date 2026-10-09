import { useI18n } from '../i18n';
import { ArrowRight, CircleCheck, Inbox, Sparkles, Workflow } from 'lucide-react';
import { simulationSetupEvent } from './setup-event';
import './wizard.css';

/** Empty-canvas affordance is independent of the optional setup form. */
export function ProcessStartPanel() {
  const { t } = useI18n();
  return (
    <div className="process-start-panel">
      <div className="process-start-symbols" aria-hidden>
        <Inbox size={23} />
        <ArrowRight size={17} />
        <Workflow size={23} />
        <ArrowRight size={17} />
        <CircleCheck size={23} />
      </div>
      <h2>{t('simulator.wizard.start.buildYourFirstProcess')}</h2>
      <p>
        {t('simulator.wizard.start.chooseWhatArrivesHowItIsHandledAndWhatCompletionMeansGuided')}
      </p>
      <button
        className="primary"
        onClick={() => window.dispatchEvent(new Event(simulationSetupEvent))}
      >
        <Sparkles size={16} />
        {t('simulator.wizard.start.startGuidedSetup')}{' '}
      </button>
      <small>
        {t('simulator.wizard.start.arrivalsWorkCompletedAddSharedStaffOrEquipmentWhenNeeded')}
      </small>
    </div>
  );
}
