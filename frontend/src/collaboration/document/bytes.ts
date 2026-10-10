/** Web Crypto/WASM/iframe values can be Uint8Arrays from another JS realm. */
export const isCollaborationBytes = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
