/* The browser workspace remains authoritative; this page only presents its API contract. */
(async function () {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const status = document.getElementById("api-load-status");
  let serverObserver;
  let serverDeadline;
  const stopServerLabels = () => {
    serverObserver?.disconnect();
    clearTimeout(serverDeadline);
    window.removeEventListener("pagehide", stopServerLabels);
  };
  const labelServers = () => {
    const root = document.getElementById("swagger-ui");
    const selectors =
      root?.querySelectorAll('select[id="servers"], .servers select') ?? [];
    for (const select of selectors) {
      // A wrapping vendor label may contain only the select. Its option text
      // describes the value, not the control, so it cannot supply the name.
      const hasLabelText = [...(select.labels ?? [])].some((label) => {
        const text = label.cloneNode(true);
        text.querySelectorAll("select, input, textarea").forEach((control) => {
          control.remove();
        });
        return Boolean(text.textContent?.trim());
      });
      if (
        !hasLabelText &&
        !select.getAttribute("aria-label")?.trim() &&
        !select.getAttribute("aria-labelledby")?.trim()
      )
        select.setAttribute("aria-label", "API server");
    }
    if (selectors.length) stopServerLabels();
  };
  if (local) {
    document.getElementById("api-mode").textContent = "Local bridge";
    document.getElementById("api-connection-note").textContent =
      "Try it out sends commands to this local bridge. Keep your workspace open in a connected browser and choose its MCP access in Settings before sending a request.";
  }
  try {
    const response = await fetch("/openapi.yaml");
    if (!response.ok) throw new Error("The API contract could not be loaded.");
    const spec = await response.json();
    if (!spec || !spec.info || !spec.paths)
      throw new Error("The API contract is invalid.");
    const version = document.getElementById("api-version");
    version.textContent = `API ${spec.info.version}`;
    version.hidden = false;
    // The page introduction presents architecture/access clearly. Keep the full
    // description in the downloadable contract and MCP documentation.
    spec.info = { ...spec.info, description: "" };
    if (local) {
      spec.servers = [
        { url: location.origin + "/api/v1", description: "Local bridge" },
      ];
    }
    // Swagger's completion callback can precede React's DOM commit. Observe only
    // its root until the server picker arrives, with a deadline and page cleanup.
    const swaggerRoot = document.getElementById("swagger-ui");
    if (swaggerRoot) {
      serverObserver = new MutationObserver(labelServers);
      serverObserver.observe(swaggerRoot, { childList: true, subtree: true });
      serverDeadline = setTimeout(stopServerLabels, 10000);
      window.addEventListener("pagehide", stopServerLabels, { once: true });
    }
    SwaggerUIBundle({
      spec,
      dom_id: "#swagger-ui",
      validatorUrl: null,
      persistAuthorization: false,
      queryConfigEnabled: false,
      supportedSubmitMethods: local
        ? ["get", "post", "put", "patch", "delete"]
        : [],
      defaultModelsExpandDepth: 0,
      displayRequestDuration: true,
      onComplete: function () {
        status.hidden = true;
        labelServers();
      },
    });
  } catch (error) {
    stopServerLabels();
    status.textContent =
      "The API reference could not be loaded. Reload this page to try again, or use the OpenAPI download above.";
    status.setAttribute("role", "alert");
  }
})();
