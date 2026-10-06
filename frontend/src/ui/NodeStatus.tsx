import { CircleAlert, CircleCheck, CircleDashed, Clock3, Flag } from 'lucide-react';
import { nodeStatuses, statusLabel } from './status';

const statusIcons = {
  planned: CircleDashed,
  'in-progress': Clock3,
  blocked: CircleAlert,
  done: CircleCheck,
};

export function NodeStatus({ status, overview = false }: { status?: string; overview?: boolean }) {
  if (!status) return null;
  const known = nodeStatuses.find((item) => item.value === status)?.value;
  const Icon = known ? statusIcons[known] : Flag;
  const label = statusLabel(status);
  return (
    <span
      className={`node-status status-${known ?? 'custom'}${overview ? ' node-status-overview' : ''}`}
      data-testid="node-status"
      role="img"
      aria-label={`Status: ${label}`}
      title={label}
    >
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" data-status-icon={known ?? 'custom'} />
      <span>{label}</span>
    </span>
  );
}
