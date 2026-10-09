import { expect, it, vi } from 'vitest';
import { BridgeOperations, type OperationCommand } from '../src/integration/operations';

const command = (changes: Partial<OperationCommand> = {}): OperationCommand => ({
  operationId: 'vnop1.bridge.unique',
  operationAction: 'execute',
  operationNew: true,
  path: '/diagrams',
  method: 'POST',
  data: { name: 'Kept once' },
  ...changes,
});
const permitted = async () => {};

it('coalesces concurrent retries into one write and retains the actual late result', async () => {
  const ledger = new BridgeOperations();
  let finish!: () => void;
  const execute = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { status: 201, body: { id: 'canonical', version: 1 } };
  });
  const first = ledger.request(command(), permitted, execute);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  expect(
    await ledger.request(command({ operationAction: 'status', method: 'GET' }), permitted, execute),
  ).toMatchObject({ body: { state: 'running' } });
  const retry = ledger.request(command({ operationNew: false }), permitted, execute);
  finish();
  expect(await first).toEqual(await retry);
  expect(await ledger.request(command({ operationNew: false }), permitted, execute)).toEqual({
    status: 201,
    body: { id: 'canonical', version: 1 },
  });
  expect(execute).toHaveBeenCalledOnce();
});

it('supports reservation before a write and rejects reuse for changed command content', async () => {
  const ledger = new BridgeOperations();
  const execute = vi.fn(async () => ({ status: 201, body: { id: 'canonical' } }));
  expect(
    await ledger.request(
      command({ operationAction: 'reserve', path: '/operations', data: {} }),
      permitted,
      execute,
    ),
  ).toMatchObject({ status: 201, body: { state: 'reserved' } });
  await ledger.request(command({ operationNew: false, data: { b: 2, a: 1 } }), permitted, execute);
  expect(
    await ledger.request(
      command({ operationNew: false, data: { a: 1, b: 2 } }),
      permitted,
      execute,
    ),
  ).toMatchObject({ status: 201 });
  for (const changes of [{ data: { a: 3, b: 2 } }, { method: 'PATCH' }, { path: '/nodes' }])
    expect(
      await ledger.request(command({ operationNew: false, ...changes }), permitted, execute),
    ).toMatchObject({ status: 409, body: { code: 'OPERATION_CONFLICT' } });
  expect(execute).toHaveBeenCalledOnce();
});

it('never executes absent retry IDs or expired reservations', async () => {
  let now = 0;
  const ledger = new BridgeOperations(() => now, { entries: 2, bytes: 100, retentionMs: 1000 });
  const execute = vi.fn(async () => ({ status: 201, body: {} }));
  expect(await ledger.request(command({ operationNew: false }), permitted, execute)).toMatchObject({
    status: 410,
  });
  await ledger.request(command({ operationAction: 'reserve' }), permitted, execute);
  now = 1000;
  expect(await ledger.request(command({ operationNew: false }), permitted, execute)).toMatchObject({
    status: 410,
    body: { code: 'OPERATION_EXPIRED' },
  });
  expect(execute).not.toHaveBeenCalled();
});

it('does not retain large responses or evict active writes to accept new operations', async () => {
  const ledger = new BridgeOperations(() => 0, { entries: 1, bytes: 10, retentionMs: 1000 });
  const execute = vi.fn(async () => ({ status: 201, body: { text: 'large result' } }));
  await ledger.request(command(), permitted, execute);
  expect(await ledger.request(command({ operationNew: false }), permitted, execute)).toMatchObject({
    status: 409,
    body: { state: 'succeeded', resultAvailable: false, code: 'OPERATION_RESULT_UNAVAILABLE' },
  });
  expect(
    await ledger.request(command({ operationId: 'another' }), permitted, execute),
  ).toMatchObject({ status: 503 });
  expect(execute).toHaveBeenCalledOnce();
});

it('still returns an original large response when completion outruns its publication authorization', async () => {
  const ledger = new BridgeOperations(() => 0, { entries: 1, bytes: 10, retentionMs: 1000 });
  let release!: () => void;
  let calls = 0;
  const authorize = async () => {
    if (++calls === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  };
  const reply = { status: 201, body: { text: 'This result exceeds the retention budget' } };
  const execute = vi.fn(async () => reply);
  const original = ledger.request(command(), authorize, execute);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  expect(
    await ledger.request(
      command({ operationAction: 'status', method: 'GET', operationNew: false }),
      permitted,
      execute,
    ),
  ).toMatchObject({ body: { state: 'succeeded', resultAvailable: false } });
  release();
  expect(await original).toEqual(reply);
  expect(execute).toHaveBeenCalledOnce();
});

it('checks permission again before releasing retained responses and forgets results on revoke', async () => {
  const ledger = new BridgeOperations();
  let allowed = true;
  const authorize = async () => {
    if (!allowed) throw new Error('Grant revoked');
  };
  const execute = vi.fn(async () => ({ status: 201, body: { text: 'Private result' } }));
  await ledger.request(command(), authorize, execute);
  allowed = false;
  await expect(
    ledger.request(command({ operationNew: false }), authorize, execute),
  ).rejects.toThrow('Grant revoked');
  ledger.clear();
  allowed = true;
  expect(await ledger.request(command({ operationNew: false }), authorize, execute)).toMatchObject({
    status: 410,
  });
  expect(execute).toHaveBeenCalledOnce();
});

it('a revoked in-flight write cannot restore its response into a fresh grant ledger', async () => {
  const ledger = new BridgeOperations();
  let finish!: () => void;
  const execute = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { status: 201, body: { text: 'Private late response' } };
  });
  const pending = ledger.request(command(), permitted, execute);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  ledger.clear();
  finish();
  await pending;
  expect(
    await ledger.request(
      command({ operationAction: 'status', method: 'GET', operationNew: false }),
      permitted,
      execute,
    ),
  ).toMatchObject({ status: 410 });
});
