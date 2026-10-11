import { afterEach, describe, expect, it } from 'vitest';
import { Client, clients, create, device } from './helpers';
afterEach(() => { for (const client of [...clients]) client.close(); });
describe('unauthenticated admission resource isolation', () => {
  it('closes invalid unauthenticated JSON without charging another device admission budget', async () => {
    const fixture=await create();const owner=await(await Client.open(fixture)).authorized();const {invitation}=await owner.invite();
    const malformed=await Client.open(fixture,await device());
    malformed.socket.send('invalid-json');
    await new Promise<void>(resolve => { if (malformed.socket.readyState===3) resolve();else malformed.socket.addEventListener('close',()=>resolve(),{once:true}); });
    const joiner=await Client.open(fixture,await device());await joiner.authenticate(invitation);
    const request=await owner.next('join-request');
    expect(request.request.deviceId).toBe(joiner.device.identity.deviceId);
  });
});
