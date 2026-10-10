import { StorageError } from '../../model/errors';
import { collaborationDocumentLimits } from './scope';
import { isCollaborationBytes } from './bytes';

const magic = new Uint8Array([86, 78, 67, 1]);
const headerBytes = 12;
export const collaborationUpdateLimits = Object.freeze({ vectorBytes: 64 * 1024, actors: 4096 });
export interface CollaborationUpdateEnvelope {
  baseVector: Uint8Array;
  delta: Uint8Array;
  dependencies: ReadonlyMap<number, number>;
}
export class CollaborationEnvelopeError extends StorageError {
  readonly code = 'COLLABORATION_INVALID_UPDATE';
  constructor(message: string) {
    super(422, message);
  }
}
const invalid = (): never => {
  throw new CollaborationEnvelopeError('Invalid collaboration update envelope.');
};

/** Validate the vector before a Yjs document/update is allocated or decoded. */
export function validateCollaborationStateVector(bytes: Uint8Array): ReadonlyMap<number, number> {
  if (!isCollaborationBytes(bytes) || bytes.byteLength > collaborationUpdateLimits.vectorBytes)
    invalid();
  let offset = 0;
  const uint = () => {
    let result = 0,
      multiplier = 1;
    for (let i = 0; i < 8; i++) {
      if (offset >= bytes.length) invalid();
      const byte = bytes[offset++];
      result += (byte & 127) * multiplier;
      if (!Number.isSafeInteger(result)) invalid();
      if (!(byte & 128)) return result;
      multiplier *= 128;
    }
    return invalid();
  };
  const count = uint();
  if (count > collaborationUpdateLimits.actors) invalid();
  const result = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const actor = uint(),
      clock = uint();
    if (actor > 0xffffffff || result.has(actor)) invalid();
    result.set(actor, clock);
  }
  if (offset !== bytes.length) invalid();
  return result;
}
/** Canonical empty vector denotes a bounded full-state refresh, not a causal delta. */
export function isCollaborationFullStateVector(bytes: Uint8Array): boolean {
  return bytes.byteLength === 1 && bytes[0] === 0;
}
export function encodeCollaborationUpdate(baseVector: Uint8Array, delta: Uint8Array): Uint8Array {
  validateCollaborationStateVector(baseVector);
  const maximum = isCollaborationFullStateVector(baseVector)
    ? collaborationDocumentLimits.stateBytes
    : collaborationDocumentLimits.updateBytes;
  if (!isCollaborationBytes(delta) || delta.byteLength > maximum) invalid();
  const result = new Uint8Array(headerBytes + baseVector.byteLength + delta.byteLength);
  result.set(magic);
  const header = new DataView(result.buffer);
  header.setUint32(4, baseVector.byteLength);
  header.setUint32(8, delta.byteLength);
  result.set(baseVector, headerBytes);
  result.set(delta, headerBytes + baseVector.byteLength);
  return result;
}
export function decodeCollaborationUpdate(bytes: Uint8Array): CollaborationUpdateEnvelope {
  if (
    !isCollaborationBytes(bytes) ||
    bytes.byteLength < headerBytes ||
    bytes.byteLength >
      headerBytes +
        collaborationUpdateLimits.vectorBytes +
        collaborationDocumentLimits.stateBytes ||
    magic.some((byte, index) => bytes[index] !== byte)
  )
    invalid();
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vectorLength = header.getUint32(4),
    deltaLength = header.getUint32(8);
  if (
    vectorLength > collaborationUpdateLimits.vectorBytes ||
    headerBytes + vectorLength + deltaLength !== bytes.byteLength
  )
    invalid();
  const baseVector = bytes.subarray(headerBytes, headerBytes + vectorLength);
  const dependencies = validateCollaborationStateVector(baseVector);
  const maximum = isCollaborationFullStateVector(baseVector)
    ? collaborationDocumentLimits.stateBytes
    : collaborationDocumentLimits.updateBytes;
  if (deltaLength > maximum) invalid();
  return {
    baseVector,
    delta: bytes.subarray(headerBytes + vectorLength),
    dependencies,
  };
}
