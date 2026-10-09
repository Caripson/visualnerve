import { useI18n } from '../i18n';
import { statusLabel } from './editor-labels';
import { CircleAlert, CircleCheck, CircleDashed, Clock3, Flag } from 'lucide-react';
import { nodeStatuses } from './status';

const statusIcons = {
  planned: CircleDashed,
  'in-progress': Clock3,
  blocked: CircleAlert,
  done: CircleCheck,
};

export function NodeStatus({ status, overview = false }: { status?: string; overview?: boolean }) {
  const { t } = useI18n();
  if (!status) return null;
  const known = nodeStatuses.find((item) => item.value === status)?.value;
  const Icon = known ? statusIcons[known] : Flag;
  const label = statusLabel(t, status);
  return (
    <span
      className={`node-status status-${known ?? 'custom'}${overview ? ' node-status-overview' : ''}`}
      data-testid="node-status"
      role="img"
      aria-label={t('editor.status.accessible', { label })}
      title={label}
    >
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" data-status-icon={known ?? 'custom'} />
      <span>{label}</span>
    </span>
  );
}
