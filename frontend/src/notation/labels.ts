import type { NodeNotation } from './types';

const umlKeywords: Readonly<Record<string, string>> = {
  interface: 'interface',
  enumeration: 'enumeration',
  'data-type': 'dataType',
  device: 'device',
  'execution-environment': 'executionEnvironment',
  stereotype: 'stereotype',
  metaclass: 'metaclass',
  model: 'model',
  profile: 'profile',
};

/** Normative keywords distinguish classifier rectangles independently of user stereotypes. */
export function notationPrefix(value: NodeNotation): string | undefined {
  const properties = value.properties as Record<string, unknown> | undefined;
  if (value.collection === 'uml' && value.symbol === 'interaction-use') return 'ref';
  if (value.collection === 'uml' && value.symbol === 'combined-fragment')
    return typeof properties?.operator === 'string' ? properties.operator : undefined;
  const keyword = value.collection === 'uml' ? umlKeywords[value.symbol] : undefined;
  const stereotype = typeof properties?.stereotype === 'string' ? properties.stereotype : undefined;
  const headings = [...new Set([keyword, stereotype].filter(Boolean))].map((text) => `«${text}»`);
  if (headings.length) return headings.join(' ');
  const number = properties?.moduleNumber ?? properties?.number;
  return number == null ? undefined : String(number);
}

/** Guards remain semantic text rather than changing the editable node name. */
export function notationGuard(value: NodeNotation): string | undefined {
  if (value.collection !== 'uml' || value.symbol !== 'combined-fragment') return undefined;
  const guard = value.properties?.guard?.trim();
  return guard ? `[${guard.replace(/^\[|\]$/g, '')}]` : undefined;
}
