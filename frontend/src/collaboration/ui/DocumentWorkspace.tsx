import { useEffect, useId, useRef, useState } from 'react';
import type { Graph } from '../../model/types';
import { useI18n } from '../../i18n';
import {
  collaborationFor,
  type CollaborationAction,
  type CollaborationActionContext,
} from '../model';
import type { CollaborationSnapshot, CollaborationUiController } from '../types';
import { Profiles } from './document/Profiles';
import { Comments } from './document/Comments';
import { Tasks } from './document/Tasks';
import { Activity } from './document/Activity';
import type { DocumentWorkProps } from './document/types';
import './document/document-workspace.css';

const tabs = ['profiles', 'comments', 'tasks', 'activity'] as const;
type Tab = (typeof tabs)[number];
export interface DocumentWorkspaceProps {
  graph: Graph;
  snapshot: Readonly<CollaborationSnapshot>;
  controller: CollaborationUiController;
  selectedNodeId?: string;
}

/** Every document change goes through the shared, versioned controller boundary. */
export function DocumentWorkspace({
  graph,
  snapshot,
  controller,
  selectedNodeId,
}: DocumentWorkspaceProps) {
  const { t } = useI18n();
  const id = useId();
  const [tab, setTab] = useState<Tab>('profiles');
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [localProfile, setLocalProfile] = useState<string>();
  const document = collaborationFor(graph);
  const roomActive = !!snapshot.roomId && snapshot.diagramId === graph.diagram.id;
  let context: CollaborationActionContext | undefined;
  try {
    context = controller.documentContext?.(graph.diagram.id) ?? {
      role: roomActive ? (snapshot.role ?? 'viewer') : 'owner',
      profileId: roomActive ? snapshot.selfProfileId : localProfile,
      source: 'ui',
    };
  } catch {
    /* The room has not established writable document access yet. */
  }
  const actor = context?.profileId ?? (!roomActive ? localProfile : undefined);
  const profileId = document.profiles.some((profile) => profile.id === actor) ? actor : undefined;
  const owner = context?.role === 'owner';
  const writable = !!controller.applyDocumentAction && !!context && context.role !== 'viewer';
  useEffect(() => {
    setLocalProfile(undefined);
    setError('');
    setSaved(false);
  }, [graph.diagram.id]);
  const run = async (action: CollaborationAction, baseVersion = graph.diagram.version) => {
    if (operation.current || !writable || !controller.applyDocumentAction) return false;
    operation.current = true;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await controller.applyDocumentAction(graph.diagram.id, action, baseVersion);
      setSaved(true);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.slice(0, 300)
          : t('collaboration.document.changeFailed'),
      );
      return false;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const work: DocumentWorkProps = {
    graph,
    document,
    profileId,
    owner,
    writable,
    busy,
    selectedNodeId,
    run,
  };
  const select = async (value: string) => {
    if (!controller.selectDocumentProfile || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      await controller.selectDocumentProfile(graph.diagram.id, value);
      setLocalProfile(value);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.slice(0, 300)
          : t('collaboration.document.changeFailed'),
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="document-workspace">
      {!writable && <p className="document-work-notice">{t('collaboration.document.readOnly')}</p>}
      {writable && !roomActive && owner && controller.selectDocumentProfile && (
        <label className="field">
          <span>{t('collaboration.document.actingProfile')}</span>
          <select
            aria-label={t('collaboration.document.actingProfile')}
            value={profileId ?? ''}
            disabled={busy}
            onChange={(event) => void select(event.target.value)}
          >
            <option value="" disabled>
              {t('collaboration.document.chooseProfile')}
            </option>
            {document.profiles.map((profile) => (
              <option value={profile.id} key={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {writable && !profileId && (
        <p className="document-work-notice">{t('collaboration.document.chooseProfile')}</p>
      )}
      <div
        className="document-work-tabs"
        role="tablist"
        aria-label={t('collaboration.documentTab')}
      >
        {tabs.map((value, index) => (
          <button
            type="button"
            role="tab"
            key={value}
            id={`${id}-${value}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => {
              setTab(value);
              setSaved(false);
            }}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              setTab(tabs[next]);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [next].focus();
            }}
          >
            {t(`collaboration.document.${value}`)}
          </button>
        ))}
      </div>
      {error && (
        <p className="document-work-error" role="alert">
          {t('collaboration.document.changeFailed')} {error}
        </p>
      )}
      {saved && <p role="status">{t('common.saved')}</p>}
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
        {tab === 'profiles' ? (
          <Profiles key={graph.diagram.id} {...work} />
        ) : tab === 'comments' ? (
          <Comments key={graph.diagram.id} {...work} />
        ) : tab === 'tasks' ? (
          <Tasks key={graph.diagram.id} {...work} />
        ) : (
          <Activity {...work} />
        )}
      </div>
    </div>
  );
}
