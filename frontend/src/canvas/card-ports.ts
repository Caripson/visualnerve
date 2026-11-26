export type CardSide = 'left' | 'right' | 'top' | 'bottom';
export type PortRole = 'source' | 'target';

export function cardPortId(side: CardSide, role: PortRole, topic: boolean): string {
  if (topic) return `${role}-${side}`;
  const prefix = role === 'source' ? 'out' : 'in';
  return side === (role === 'source' ? 'right' : 'left') ? prefix : `${prefix}-${side}`;
}

export function cardPortSide(handle: unknown): CardSide | undefined {
  if (handle === 'out') return 'right';
  if (handle === 'in') return 'left';
  if (typeof handle !== 'string') return;
  const side = /^(?:in|out|source|target)-(left|right|top|bottom)$/.exec(handle)?.[1];
  return side as CardSide | undefined;
}
