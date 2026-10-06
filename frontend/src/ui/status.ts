export const nodeStatuses = [
  { value: 'planned', label: 'Planned' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
] as const;

export function statusLabel(status?: string): string {
  if (!status) return 'None';
  return nodeStatuses.find((item) => item.value === status)?.label ?? status;
}
