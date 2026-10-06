import { useState } from 'react';
import { useEditor } from '../state/editor';
import {
  buildSectionLabels,
  getBuildSpecification,
  setBuildSpecification,
  type ApplicationSpecification,
  type BuildSection,
} from '../export/build-specification';

export function BuildSpecificationEditor({
  specification,
}: {
  specification: ApplicationSpecification;
}) {
  const graph = useEditor((state) => state.graph);
  const [notice, setNotice] = useState('');
  if (!graph) return null;
  const draft = getBuildSpecification(graph);
  const update = (
    change: (
      current: ReturnType<typeof getBuildSpecification>,
    ) => ReturnType<typeof getBuildSpecification>,
  ) => {
    try {
      useEditor
        .getState()
        .command(
          'Edit application specification',
          (current) => setBuildSpecification(current, change(getBuildSpecification(current))),
          true,
        );
      setNotice('');
    } catch (error) {
      setNotice((error as Error).message);
    }
  };
  return (
    <section className="build-specification" aria-label="Application specification review">
      <h3>Review the app specification</h3>
      <p>
        {specification.unresolved} decisions need clarification. Proposed screens and API endpoints
        require review; they describe an app to build.
      </p>
      {(Object.keys(buildSectionLabels) as BuildSection[]).map((key) => (
        <details key={key}>
          <summary>{buildSectionLabels[key]}</summary>
          <pre>{specification.sections[key]}</pre>
          <label className="field">
            Your requirements and corrections
            <textarea
              aria-label={`${buildSectionLabels[key]} requirements`}
              rows={4}
              maxLength={30000}
              value={draft.sections[key] ?? ''}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  sections: { ...current.sections, [key]: event.target.value },
                }))
              }
            />
          </label>
        </details>
      ))}
      <details>
        <summary>Answer open decisions ({specification.unresolved})</summary>
        {specification.decisions.map((decision) => (
          <label className="field" key={decision.id}>
            {decision.question}
            <textarea
              aria-label={decision.question}
              value={draft.answers[decision.id] ?? ''}
              rows={2}
              maxLength={30000}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  answers: { ...current.answers, [decision.id]: event.target.value },
                }))
              }
            />
          </label>
        ))}
        {specification.omittedDecisions > 0 && (
          <p>
            {specification.omittedDecisions} more decisions remain. Choose a smaller scope to review
            them.
          </p>
        )}
      </details>
      {notice && <p role="alert">{notice}</p>}
    </section>
  );
}
