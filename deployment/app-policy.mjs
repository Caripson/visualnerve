export const APP_ORIGIN = "https://app.visualnerve.com";
export const WEBSITE_ORIGIN = "https://www.visualnerve.com";

export function appSurfaceOptions(options = {}) {
  const origin = (value) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error(
        "App surface origins must be HTTPS origins without paths or credentials.",
      );
    return url.origin;
  };
  const appOrigin = origin(options.appOrigin ?? APP_ORIGIN);
  const websiteOrigin = origin(options.websiteOrigin ?? WEBSITE_ORIGIN);
  if (
    appOrigin === websiteOrigin ||
    ["www.visualnerve.com", "visualnerve.caripson.com"].includes(
      new URL(appOrigin).hostname,
    )
  )
    throw new Error(
      "The isolated app must use a separate origin from the existing website/workspace.",
    );
  const bridgePorts = options.bridgePorts ?? [4317];
  if (
    !Array.isArray(bridgePorts) ||
    !bridgePorts.length ||
    bridgePorts.length > 4 ||
    new Set(bridgePorts).size !== bridgePorts.length ||
    bridgePorts.some(
      (port) => !Number.isInteger(port) || port < 1 || port > 65535,
    )
  )
    throw new Error(
      "Choose one to four distinct local bridge ports between 1 and 65535.",
    );
  const collaborationRelayOrigin = options.collaborationRelayOrigin;
  if (collaborationRelayOrigin !== undefined) {
    let relay;
    try {
      relay = new URL(collaborationRelayOrigin);
    } catch {
      /* rejected below */
    }
    if (
      typeof collaborationRelayOrigin !== "string" ||
      !relay ||
      relay.protocol !== "https:" ||
      relay.origin !== collaborationRelayOrigin ||
      relay.username ||
      relay.password ||
      relay.search ||
      relay.hash ||
      relay.pathname !== "/" ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        relay.hostname,
      )
    )
      throw new Error(
        "The collaboration relay must be an exact HTTPS origin without paths, credentials, wildcards or whitespace.",
      );
  }
  return {
    appOrigin,
    websiteOrigin,
    bridgePorts: [...bridgePorts],
    ...(collaborationRelayOrigin !== undefined
      ? { collaborationRelayOrigin }
      : {}),
  };
}

export function appContentSecurityPolicy(
  bridgePorts = [4317],
  collaborationRelayOrigin,
) {
  const { bridgePorts: ports } = appSurfaceOptions({
    bridgePorts,
    collaborationRelayOrigin,
  });
  const bridges = ports.flatMap((port) =>
    ["ws", "wss"].flatMap((scheme) =>
      ["127.0.0.1", "localhost"].map(
        (host) => `${scheme}://${host}:${port}/bridge`,
      ),
    ),
  );
  const relay = collaborationRelayOrigin
    ? ` ${collaborationRelayOrigin} ${collaborationRelayOrigin.replace(/^https:/, "wss:")}`
    : "";
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    // WASM compilation is required for local neural narration, not JavaScript eval.
    "script-src 'self' 'wasm-unsafe-eval'",
    // React Flow/Three and generated exports use dynamic element styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    // Voice requests are additionally pinned to exact URLs and checked by SHA-256 in the runtime.
    `connect-src 'self' ${bridges.join(" ")} https://huggingface.co/rhasspy/piper-voices/ https://us.aws.cdn.hf.co${relay}`,
  ].join("; ");
}

export function appResponseHeaders(
  bridgePorts = [4317],
  collaborationRelayOrigin,
) {
  return {
    "Content-Security-Policy": appContentSecurityPolicy(
      bridgePorts,
      collaborationRelayOrigin,
    ),
    "Strict-Transport-Security": "max-age=31536000",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow",
  };
}
