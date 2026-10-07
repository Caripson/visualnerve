/* The browser workspace remains authoritative; this page only presents its API contract. */
(async function () {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const status = document.getElementById("api-load-status");
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
      },
    });
  } catch (error) {
    status.textContent =
      "The API reference could not be loaded. Reload this page to try again, or use the OpenAPI download above.";
    status.setAttribute("role", "alert");
  }
})();
