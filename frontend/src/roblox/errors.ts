import { StorageError } from '../model/errors';

/** Existing transport recognizes StorageError; semantic codes remain machine-readable. */
export class RobloxError extends StorageError {
  constructor(
    status: number,
    message: string,
    readonly code: string,
    readonly issues?: unknown[],
  ) {
    super(status, message);
  }
}
