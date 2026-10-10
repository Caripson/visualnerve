import { relayLimits } from "./protocol";
import { RelayError } from "./validation";

export interface PublicDeviceRate {
  deviceId: string;
  window: number;
  count: number;
  bytes: number;
}
export const deviceRateLimits = Object.freeze({
  entries: relayLimits.members * 2 + relayLimits.pendingJoins,
  windowMs: 60_000,
});

/** Only short-lived public identity/counters. Disconnect cannot renew a budget. */
export class DeviceRateLedger {
  constructor(private records: PublicDeviceRate[] = []) {}
  expire(now: number): boolean {
    const live = this.records.filter(
      (record) => now - record.window < deviceRateLimits.windowMs,
    );
    const changed = live.length !== this.records.length;
    this.records = live;
    return changed;
  }
  snapshot(): PublicDeviceRate[] {
    return this.records.map((record) => ({ ...record }));
  }
  clear(): void {
    this.records = [];
  }
  record(
    deviceId: string,
    bytes: number,
    baseline: { count: number; bytes: number },
    now: number,
  ): void {
    this.expire(now);
    let current = this.records.find((record) => record.deviceId === deviceId);
    if (!current) {
      if (this.records.length >= deviceRateLimits.entries)
        throw new RelayError("DEVICE_RATE_ACTOR_LIMIT", 429);
      current = { deviceId, window: now, count: 0, bytes: 0 };
      this.records.push(current);
    }
    // Baseline includes live socket accounting from admission/legacy handlers,
    // never subtracts already consumed traffic when a socket disappears.
    current.count = Math.max(current.count, baseline.count);
    current.bytes = Math.max(current.bytes, baseline.bytes);
    if (
      current.count >= relayLimits.messagesPerMinute ||
      current.bytes + bytes > relayLimits.bytesPerMinute
    )
      throw new RelayError("RATE_LIMIT", 429);
    current.count++;
    current.bytes += bytes;
  }
}
