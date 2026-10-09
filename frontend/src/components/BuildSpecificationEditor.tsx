import { useI18n } from '../i18n';
import { useState } from 'react';
import { useEditor } from '../state/editor';
import type { MessageId } from '../i18n';
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
  const { t, number } = useI18n();
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
    <section className="build-specification" aria-label={t('build.reviewAria')}>
      <h3>{t('build.reviewTitle')}</h3>
      <p>{t('build.unresolved', { count: number(specification.unresolved) })}</p>
      {(Object.keys(buildSectionLabels) as BuildSection[]).map((key) => (
        <details key={key}>
          <summary>{t(`build.section.${key}` as MessageId)}</summary>
          <pre>{specification.sections[key]}</pre>
          <label className="field">
            {t('build.requirements')}
            <textarea
              aria-label={t('build.requirementsAria', {
                section: t(`build.section.${key}` as MessageId),
              })}
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
        <summary>{t('build.openDecisions', { count: number(specification.unresolved) })}</summary>
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
          <p>{t('build.omittedDecisions', { count: number(specification.omittedDecisions) })}</p>
        )}
      </details>
      {notice && <p role="alert">{notice}</p>}
    </section>
  );
}
