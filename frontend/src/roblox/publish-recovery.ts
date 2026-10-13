import type {
  RobloxPublishReceipt,
  RobloxPublishSession,
} from '../integration/roblox-publish-types';

export interface RobloxPreparationIdentity {
  nonce?: string;
  sha256: string;
  totalBytes: number;
  target: { universeId: string; placeId: string };
}

/** Recover only this preparation through its original grant, including an interrupted begin. */
export async function recoverRobloxPreparation(
  session: RobloxPublishSession,
  expected: RobloxPreparationIdentity,
  cancelRequested: boolean,
): Promise<RobloxPublishReceipt | undefined> {
  const check = () => {
    session.signal.throwIfAborted();
    session.assertCurrent();
  };
  const matches = (receipt: RobloxPublishReceipt, nonce = expected.nonce) =>
    typeof receipt?.nonce === 'string' &&
    receipt.nonce.length > 0 &&
    (nonce === undefined || receipt.nonce === nonce) &&
    receipt.sha256 === expected.sha256 &&
    receipt.totalBytes === expected.totalBytes &&
    receipt.target?.universeId === expected.target.universeId &&
    receipt.target?.placeId === expected.target.placeId;

  check();
  const receipt = await session.request<RobloxPublishReceipt>(
    'status',
    expected.nonce === undefined ? {} : { nonce: expected.nonce },
    session.signal,
  );
  check();
  if (!matches(receipt)) return undefined;
  if (cancelRequested && ['receiving', 'awaiting-approval', 'publishing'].includes(receipt.state)) {
    const cancelled = await session.request<RobloxPublishReceipt>(
      'cancel',
      { nonce: receipt.nonce },
      session.signal,
    );
    check();
    return matches(cancelled, receipt.nonce) ? cancelled : undefined;
  }
  return receipt;
}
