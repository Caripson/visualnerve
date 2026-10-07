import { useState } from 'react';
import { ArrowRight, CircleCheck, Inbox, Sparkles, Workflow } from 'lucide-react';
import { Modal } from '../components/Modal';
import type { Graph } from '../model/types';
import { useEditor } from '../state/editor';
import { createStarterGraph, starterDefaults, starterValues } from './starter';
import { EconomicsStep, ProcessingStep, WorkloadStep } from './StarterFields';
import { StarterReview } from './StarterReview';
import './wizard.css';

export const simulationSetupEvent = 'visualnerve:simulation-setup';
const steps = ['Workload', 'Process', 'Economics', 'Review'];

/** Empty-canvas UI requests setup; all editable assumptions belong to the authoritative model. */
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

export function ProcessWizard({
  graph,
  close,
  created,
}: {
  graph: Graph;
  close: () => void;
  created?: (options: { durationSeconds: number; untilComplete: boolean }) => void;
}) {
  const [draft, setDraft] = useState(() => starterDefaults(graph.simulation?.currency));
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const change = (patch: Partial<typeof draft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setError('');
  };
  function proceed() {
    try {
      const values = starterValues(draft);
      if (step < steps.length - 1) {
        setStep(step + 1);
        return;
      }
      const current = useEditor.getState().graph;
      if (
        !current ||
        current.diagram.id !== graph.diagram.id ||
        JSON.stringify(current.simulation) !== JSON.stringify(graph.simulation)
      )
        throw new Error(
          'The model changed while setup was open. Close and reopen setup to use the current model.',
        );
      const next = createStarterGraph(current, draft);
      useEditor.getState().command('Create guided process', () => next);
      if (useEditor.getState().graph?.simulation !== next.simulation)
        throw new Error(useEditor.getState().message || 'The process could not be created.');
      useEditor
        .getState()
        .select([next.simulation!.nodes.find((node) => node.type === 'work')!.id]);
      created?.({
        durationSeconds: values.durationSeconds,
        untilComplete: draft.arrivalMode === 'batch',
      });
      close();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <Modal title="Set up your process" close={close} wide className="process-wizard-dialog">
      <form
        className="process-wizard"
        onSubmit={(event) => {
          event.preventDefault();
          proceed();
        }}
      >
        <ol className="process-wizard-progress" aria-label="Setup progress">
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              data-complete={index < step}
            >
              <span>{index < step ? <CircleCheck size={16} /> : index + 1}</span>
              <b>{label}</b>
            </li>
          ))}
        </ol>
        <div className="process-wizard-step" key={step}>
          {step === 0 && <WorkloadStep draft={draft} change={change} />}
          {step === 1 && <ProcessingStep draft={draft} change={change} />}
          {step === 2 && <EconomicsStep draft={draft} change={change} />}
          {step === 3 && <StarterReview draft={draft} seed={graph.simulation?.defaults.seed} />}
        </div>
        {error && (
          <p className="process-wizard-error" role="alert">
            {error}
          </p>
        )}
        <footer className="process-wizard-actions">
          <button
            type="button"
            onClick={
              step
                ? () => {
                    setStep(step - 1);
                    setError('');
                  }
                : close
            }
          >
            {step ? 'Back' : 'Set up later'}
          </button>
          <span>
            Step {step + 1} of {steps.length}
          </span>
          <button className="primary" type="submit">
            {step === steps.length - 1 ? 'Create process' : 'Continue'}
            <ArrowRight size={16} />
          </button>
        </footer>
      </form>
    </Modal>
  );
}
