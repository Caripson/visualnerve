import { relayOrigin } from './transport/room-transport';

/** Public deployment configuration only. Cloudflare credentials never enter Vite. */
export function collaborationRelayOrigin(): string | undefined {
  const configured =
    document.querySelector<HTMLMetaElement>('meta[name="visual-nerve-collaboration-relay"]')
      ?.content || (import.meta.env.DEV ? import.meta.env.VITE_COLLABORATION_RELAY_ORIGIN : '');
  if (!configured) return undefined;
  return relayOrigin(configured);
}
