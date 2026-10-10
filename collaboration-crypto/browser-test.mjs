/** Exercises the actual browser worker and compiled OpenMLS WASM, never a crypto mock. */
import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";
import {
  chromium,
  firefox,
  webkit,
} from "../frontend/node_modules/playwright-core/index.mjs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const engine = { chromium, firefox, webkit }[
  process.env.COLLABORATION_BROWSER || "chromium"
];
if (!engine) throw new Error("Unknown COLLABORATION_BROWSER.");
const vite = await createServer({
  root: frontend,
  envFile: false,
  configFile: `${frontend}vite.config.ts`,
  server: {
    host: "127.0.0.1",
    port: 0,
    hmr: false,
    fs: { allow: [root] },
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
    },
  },
});
let browser;
// A failed/unsupported browser protocol must fail CI rather than hang indefinitely.
const deadline = setTimeout(() => {
  console.error("Collaboration browser verification exceeded 120 seconds.");
  process.exit(1);
}, 120_000);
try {
  await vite.listen();
  const address = vite.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await engine.launch({
    headless: true,
    ...(process.env.COLLABORATION_BROWSER_EXECUTABLE_PATH ||
    (engine === chromium && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)
      ? {
          executablePath:
            process.env.COLLABORATION_BROWSER_EXECUTABLE_PATH ||
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        }
      : {}),
    args: engine === chromium ? ["--no-sandbox"] : [],
  });
  const page = await browser.newPage();
  await page.route("**/crypto-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
      },
      body: "<!doctype html><title>Isolated MLS browser test</title>",
    }),
  );
  await page.goto(`${origin}/crypto-harness`);
  const result = await page.evaluate(async () => {
    const { MlsSession } = await import("/src/collaboration/crypto.ts");
    const { decodeBytes, encodeBytes } =
      await import("/src/collaboration/transport/identity.ts");
    const sessions = [];
    const passed = [];
    const expect = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const rejects = async (action, message) => {
      let rejected = false;
      try {
        await action();
      } catch {
        rejected = true;
      }
      expect(rejected, message);
    };
    const client = async (deviceId, letter) => {
      const session = await MlsSession.create({
        deviceId,
        credentialId: letter.repeat(64),
      });
      sessions.push(session);
      return session;
    };
    try {
      const owner = await client("owner-device", "a");
      const editor = await client("editor-device", "b");
      const viewer = await client("viewer-device", "c");
      const ownerKey = await owner.signaturePublicKey();
      await owner.createGroup("browser-room");
      const editorKeyPackage = await editor.keyPackage();
      await rejects(
        () =>
          owner.prepareAddMember({
            deviceId: "editor-device",
            credentialId: "b".repeat(64),
            keyPackage: editorKeyPackage,
            expectedSignatureKey: encodeBytes(new Uint8Array(32)),
          }),
        "Substituted admission key must be rejected before committing",
      );
      const addEditor = await owner.prepareAddMember({
        deviceId: "editor-device",
        credentialId: "b".repeat(64),
        keyPackage: editorKeyPackage,
        expectedSignatureKey: await editor.signaturePublicKey(),
      });
      expect(
        (await owner.info()).epoch === 0,
        "Pending add advanced before ACK.",
      );
      await owner.confirmPendingCommit();
      await editor.join({
        welcome: addEditor.welcome,
        roomId: "browser-room",
        ownerDeviceId: "owner-device",
        ownerSignatureKey: ownerKey,
      });
      const addViewer = await owner.prepareAddMember({
        deviceId: "viewer-device",
        credentialId: "c".repeat(64),
        keyPackage: await viewer.keyPackage(),
        expectedSignatureKey: await viewer.signaturePublicKey(),
      });
      await owner.confirmPendingCommit();
      await editor.process({
        ciphertext: addViewer.commit,
        expectedDeviceId: "owner-device",
      });
      await viewer.join({
        welcome: addViewer.welcome,
        roomId: "browser-room",
        ownerDeviceId: "owner-device",
        ownerSignatureKey: ownerKey,
      });
      passed.push("owner-approved MLS membership / pending ACK");
      const encrypted = await editor.encrypt(
        new TextEncoder().encode("Private browser node"),
      );
      const decrypted = await owner.process({
        ciphertext: encrypted,
        expectedDeviceId: "editor-device",
      });
      expect(
        new TextDecoder().decode(decrypted.payload) === "Private browser node",
        "Browser round trip differs.",
      );
      expect(
        decrypted.senderSignaturePublicKey ===
          (await editor.signaturePublicKey()),
        "Authenticated sender key differs.",
      );
      const received = await viewer.process({
        ciphertext: encrypted,
        expectedDeviceId: "editor-device",
      });
      expect(
        new TextDecoder().decode(received.payload) === "Private browser node",
        "Group delivery differs.",
      );
      await rejects(
        () =>
          owner.process({
            ciphertext: encrypted,
            expectedDeviceId: "editor-device",
          }),
        "Replayed generation accepted.",
      );
      passed.push("authenticated group delivery / replay rejection");
      const viewerMessage = await viewer.encrypt(
        new TextEncoder().encode("Viewer presence"),
      );
      await rejects(
        () =>
          owner.process({
            ciphertext: viewerMessage,
            expectedDeviceId: "editor-device",
          }),
        "Viewer forged editor author.",
      );
      await rejects(
        () => viewer.prepareRemoveMember("editor-device"),
        "Viewer changed membership.",
      );
      passed.push("viewer cannot forge another author / owner-only membership");
      const tamper = decodeBytes(
        await owner.encrypt(new Uint8Array([1, 2, 3])),
      );
      tamper[tamper.length - 1] ^= 1;
      await rejects(
        () =>
          editor.process({
            ciphertext: encodeBytes(tamper),
            expectedDeviceId: "owner-device",
          }),
        "Tampered ciphertext accepted.",
      );
      passed.push("tamper rejection");
      const rotation = await owner.prepareRotate();
      await owner.confirmPendingCommit();
      await editor.process({
        ciphertext: rotation.commit,
        expectedDeviceId: "owner-device",
      });
      await viewer.process({
        ciphertext: rotation.commit,
        expectedDeviceId: "owner-device",
      });
      expect(
        (await editor.info()).epoch === 3,
        "Rotation did not advance epoch.",
      );
      passed.push("owner rotation / participant epoch agreement");
      const remove = await owner.prepareRemoveMember("viewer-device");
      await owner.confirmPendingCommit();
      await editor.process({
        ciphertext: remove.commit,
        expectedDeviceId: "owner-device",
      });
      const future = await owner.encrypt(
        new TextEncoder().encode("Future secret"),
      );
      await rejects(
        () =>
          viewer.process({
            ciphertext: future,
            expectedDeviceId: "owner-device",
          }),
        "Removed member read future epoch.",
      );
      await viewer.process({
        ciphertext: remove.commit,
        expectedDeviceId: "owner-device",
      });
      expect(!(await viewer.info()).active, "Removed client remained active.");
      await rejects(
        () => viewer.encrypt(new Uint8Array([5])),
        "Removed client wrote to room.",
      );
      const acceptedFuture = await editor.process({
        ciphertext: future,
        expectedDeviceId: "owner-device",
      });
      expect(
        new TextDecoder().decode(acceptedFuture.payload) === "Future secret",
        "Remaining member lost access.",
      );
      passed.push(
        "revocation excludes future reads and writes / remaining members continue",
      );
      const recreated = await client("fresh-device", "d");
      expect(
        (await recreated.signaturePublicKey()) !==
          (await viewer.signaturePublicKey()),
        "Fresh session reused identity.",
      );
      await rejects(
        () =>
          recreated.process({
            ciphertext: future,
            expectedDeviceId: "owner-device",
          }),
        "Fresh session restored an old ratchet.",
      );
      passed.push(
        "reload creates fresh identity without restoring ratchet secrets",
      );
      const pending = editor.encrypt(new Uint8Array([7]));
      editor.dispose();
      await rejects(
        () => pending,
        "Disposed worker completed an in-flight request.",
      );
      await rejects(() => editor.info(), "Disposed session still usable.");
      passed.push(
        "lock/dispose terminates worker and rejects pending operations",
      );
      return {
        browser: navigator.userAgent,
        passed,
        assertions: passed.length,
        algorithm: "MLS 1.0 / X25519 / ChaCha20-Poly1305 / Ed25519",
      };
    } finally {
      for (const session of sessions) session.dispose();
    }
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await vite.close();
}
