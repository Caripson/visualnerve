import { localBridgeUrl } from './access';

/** Session credentials are valid only for the exact endpoint the user saved. */
export class BridgeSessionToken {
  constructor(private readonly storage: Storage) {}

  clear() {
    this.storage.removeItem('vn-token');
    this.storage.removeItem('vn-token-address');
  }

  read(address: string): string {
    let target: string;
    try {
      target = localBridgeUrl(address).href;
    } catch {
      this.clear();
      return '';
    }
    if (this.storage.getItem('vn-token-address') !== target) {
      // Older unbound tokens also need an explicit new human connection choice.
      this.clear();
      return '';
    }
    return this.storage.getItem('vn-token') ?? '';
  }

  save(address: string, token: string) {
    const target = localBridgeUrl(address).href;
    this.clear();
    if (!token) return;
    try {
      this.storage.setItem('vn-token-address', target);
      this.storage.setItem('vn-token', token);
    } catch (error) {
      this.clear();
      throw error;
    }
  }
}

export const bridgeSessionToken = () => new BridgeSessionToken(sessionStorage);
