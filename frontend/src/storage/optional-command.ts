type Kind = 'analysis' | 'diagram-file' | 'simulation' | 'understanding';

export function loadOptionalCommand(
  kind: 'analysis',
): Promise<typeof import('./analysis-commands')>;
export function loadOptionalCommand(
  kind: 'diagram-file',
): Promise<typeof import('./diagram-file-commands')>;
export function loadOptionalCommand(
  kind: 'simulation',
): Promise<typeof import('./simulation-commands')>;
export function loadOptionalCommand(
  kind: 'understanding',
): Promise<typeof import('./understanding-commands')>;
export function loadOptionalCommand(kind: Kind) {
  switch (kind) {
    case 'analysis':
      return import('./analysis-commands');
    case 'diagram-file':
      return import('./diagram-file-commands');
    case 'simulation':
      return import('./simulation-commands');
    case 'understanding':
      return import('./understanding-commands');
  }
}
