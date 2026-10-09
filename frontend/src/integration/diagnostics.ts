interface Diagnostic {
  state: 'disconnected' | 'checking' | 'current' | 'update-required';
  version?: string;
}
/** Public protocol metadata only; never probes a remote server or reads workspace content. */
export class BridgeDiagnostics {
  private value: Diagnostic = { state: 'disconnected' };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: Diagnostic) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
  disconnect() {
    clearTimeout(this.timer);
    this.publish({ state: 'disconnected' });
  }
  connect() {
    clearTimeout(this.timer);
    this.publish({ state: 'checking' });
    this.timer = setTimeout(() => this.publish({ state: 'update-required' }), 5000);
  }
  receive(message: unknown): boolean {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== 'bridge-info'
    )
      return false;
    clearTimeout(this.timer);
    const value = message as Record<string, unknown>;
    const version =
      typeof value.version === 'string' && value.version.length <= 80 ? value.version : undefined;
    const tools = Array.isArray(value.tools) ? value.tools : [];
    const capabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
    const current =
      ['visual_nerve_request', 'visual_nerve_api_docs'].every((tool) => tools.includes(tool)) &&
      ['operations-v1', 'endpoint-docs-v1'].every((capability) =>
        capabilities.includes(capability),
      );
    this.publish({ state: current ? 'current' : 'update-required', version });
    return true;
  }
}
export const bridgeDiagnostics = new BridgeDiagnostics();
