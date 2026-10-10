import {
  canonical,
  signingInput,
  type DeviceIdentity,
  type TransportPublicKey,
} from "./protocol";
import { decode, RelayError } from "./validation";

export async function fingerprint(key: TransportPublicKey): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(key)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyIdentity(device: DeviceIdentity) {
  if ((await fingerprint(device.signingKey)) !== device.credentialId)
    throw new RelayError("CREDENTIAL_KEY_MISMATCH", 403);
}
export async function verify(
  key: TransportPublicKey,
  domain: "policy" | "authenticate" | "command",
  value: unknown,
  signature: string,
) {
  let valid = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      decode(signature, 64, 64),
      signingInput(domain, value),
    );
  } catch {
    /* Fail closed; cryptographic errors never echo sensitive inputs. */
  }
  if (!valid) throw new RelayError("INVALID_SIGNATURE", 403);
}
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function binaryHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
