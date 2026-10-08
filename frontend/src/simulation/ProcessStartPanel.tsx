import { ArrowRight, CircleCheck, Inbox, Sparkles, Workflow } from 'lucide-react';
import { simulationSetupEvent } from './setup-event';
import './wizard.css';

/** Empty-canvas affordance is independent of the optional setup form. */
export function ProcessStartPanel() {
  return (
    <div className="process-start-panel">
      <div className="process-start-symbols" aria-hidden>
        <Inbox size={23} />
        <ArrowRight size={17} />
        <Workflow size={23} />
        <ArrowRight size={17} />
        <CircleCheck size={23} />
      </div>
      <h2>Build your first process</h2>
      <p>
        Choose what arrives, how it is handled and what completion means. Guided setup creates
        connected steps you can run and extend.
      </p>
      <button
        className="primary"
        onClick={() => window.dispatchEvent(new Event(simulationSetupEvent))}
      >
        <Sparkles size={16} />
        Start guided setup
      </button>
      <small>Arrivals → Work → Completed. Add shared staff or equipment when needed.</small>
    </div>
  );
}
