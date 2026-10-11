#!/usr/bin/env node
/** Executable synthetic Time Series workflow using the existing REST or MCP bridge. */
import { pathToFileURL } from "node:url";

const months = Array.from(
  { length: 12 },
  (_, index) => `2025-${String(index + 1).padStart(2, "0")}-01`,
);
const churn = [
  0.01, 0.02, 0.021, 0.025, 0.027, 0.019, 0.02, 0.03, 0.031, 0.035, 0.038,
  0.019,
];
export const analyticsImportExample = {
  datasetId: "illustrative-history",
  source: {
    kind: "csv",
    name: "Illustrative example data.csv",
    text: [
      "date,churn",
      ...months.map((date, index) => `${date},${churn[index]}`),
    ].join("\n"),
  },
  mapping: {
    format: "wide",
    timeColumn: "date",
    valueColumns: [
      {
        column: "churn",
        seriesId: "churn",
        name: "Customer churn",
        unit: { kind: "ratio", label: "%" },
        semantics: "rate",
        aggregation: "none",
        direction: "lower-is-better",
        riskPopulation: "opening-customers",
      },
    ],
    dimensions: [],
    decimal: ".",
    percent: "ratio",
    dateFormat: "iso",
    timezone: "UTC",
    resolution: "month",
    duplicatePolicy: "reject",
    invalidRows: "reject",
    missingValues: "preserve",
  },
};

/** No blind write retries: reserve once and reconcile an unknown outcome with the same ID. */
export async function runAnalyticsWorkflow(
  command,
  {
    log = console.log,
    poll = () => new Promise((resolve) => setTimeout(resolve, 250)),
  } = {},
) {
  const write = async (path, method, data) => {
    const { operationId } = await command("/operations", "POST", {});
    try {
      return await command(path, method, data, operationId);
    } catch (error) {
      if (error.status === 504 || error.code === "OPERATION_OUTCOME_UNKNOWN") {
        const receipt = await command(`/operations/${operationId}`, "GET");
        if (
          receipt.resultAvailable &&
          receipt.state === "succeeded" &&
          receipt.status < 400
        )
          return receipt.result;
        throw Object.assign(
          new Error(
            `Write outcome unknown. Inspect /operations/${operationId} and the saved document before retrying the identical operation.`,
          ),
          { operationId, code: "OPERATION_OUTCOME_UNKNOWN" },
        );
      }
      throw error;
    }
  };
  const capabilities = await command("/analytics/capabilities", "GET");
  if (capabilities.capability !== "analytics-v1")
    throw new Error(
      "The connected browser does not advertise analytics-v1. Update/reconnect the browser and local bridge.",
    );
  const discovered = await command("/diagrams?analytics=true", "GET");
  log(
    `Found ${discovered.length} existing analysis documents. This example creates one new synthetic document.`,
  );
  const diagram = await write("/diagrams", "POST", {
    name: "Illustrative example data — API workflow",
    template: "time-series-analysis",
    mode: "import",
  });
  const base = `/diagrams/${diagram.id}/analytics`;
  let { baseVersion } = await command(base, "GET");
  const mutate = async (path, method, data) => {
    const reply = await write(`${base}${path}`, method, {
      baseVersion,
      ...data,
    });
    baseVersion = reply.baseVersion;
    return reply;
  };
  const inspected = await command(`${base}/import/inspect`, "POST", {
    source: analyticsImportExample.source,
  });
  log(
    `Preview columns: ${inspected.columns.join(", ")}; ${inspected.rows} synthetic rows.`,
  );
  const preview = await command(
    `${base}/import/preview`,
    "POST",
    analyticsImportExample,
  );
  if (
    !preview.valid ||
    preview.issues.some((issue) => issue.severity === "error")
  )
    throw new Error("Synthetic import validation failed; no data committed.");
  await mutate("/import/commit", "POST", {
    input: analyticsImportExample,
    mode: "create",
    confirmed: true,
  });
  await mutate("/charts", "POST", {
    value: {
      id: "retention-chart",
      name: "Illustrative churn history",
      kind: "line",
      seriesIds: ["churn"],
      resolution: "month",
      normalized: false,
    },
  });
  await mutate("/measurements", "POST", {
    value: {
      id: "churn-change",
      name: "February to August change",
      kind: "point-to-point",
      seriesIds: ["churn"],
      from: "2025-02-01T00:00:00.000Z",
      to: "2025-08-01T00:00:00.000Z",
    },
  });
  const measurement = await command(`${base}/measure`, "POST", {
    id: "churn-change",
  });
  await mutate("/rules", "POST", {
    value: {
      id: "retention-pressure",
      name: "Retention pressure",
      version: 1,
      enabled: true,
      family: "sustained",
      seriesId: "churn",
      severity: "warning",
      parameters: { threshold: 0.02, comparator: ">", consecutive: 3 },
    },
  });
  const signals = await command(`${base}/evaluate`, "POST", {
    ruleIds: ["retention-pressure"],
  });
  await mutate("/backtests", "POST", {
    value: {
      id: "signal-lab",
      name: "Chronological signal history",
      ruleIds: ["retention-pressure"],
      from: "2025-01-01T00:00:00.000Z",
      to: "2025-12-01T00:00:00.000Z",
      trainEnd: "2025-04-01T00:00:00.000Z",
      validationEnd: "2025-08-01T00:00:00.000Z",
      holdoutStart: "2025-09-01T00:00:00.000Z",
      walkForwardPeriods: 1,
      trials: 1,
    },
  });
  const backtest = await command(`${base}/validate`, "POST", {
    id: "signal-lab",
  });
  for (const [id, name, churnRate] of [
    ["baseline", "Baseline", 0.02],
    ["current-trend", "Current trend", 0.03],
    ["stress", "Stress scenario", 0.04],
  ]) {
    await mutate("/scenarios", "POST", {
      value: {
        id,
        name,
        version: 1,
        model: "growth-churn",
        start: "2026-01-01T00:00:00.000Z",
        periods: 12,
        resolution: "month",
        reviewed: true,
        assumptions: {
          openingCustomers: 1000,
          newCustomers: 30,
          reactivatedCustomers: 0,
          churnRate,
          newCustomerGrowth: 0,
          openingMrc: 100000,
          newMrc: 5000,
          expansionMrc: 1000,
          contractionMrc: 2000,
          churnedMrc: 3000,
          currency: "SEK",
        },
      },
    });
  }
  const comparison = await command(`${base}/compare`, "POST", {
    scenarioIds: ["baseline", "current-trend", "stress"],
  });
  const job = await command(`${base}/jobs`, "POST", {
    kind: "signals",
    input: { ruleIds: ["retention-pressure"] },
  });
  let state;
  for (let attempt = 0; attempt < 600; attempt++) {
    state = await command(`${base}/jobs/${job.jobId}`, "GET");
    if (state.state !== "running") break;
    await poll();
  }
  if (state?.state !== "succeeded")
    throw new Error(
      `Signal job did not succeed: ${state?.state ?? "unavailable"}.`,
    );
  const jobResult = await command(
    `${base}/jobs/${job.jobId}/result?offset=0&limit=100`,
    "GET",
  );
  await mutate(`/jobs/${job.jobId}/archive`, "POST", {});
  const history = await command(`${base}/signals?offset=0&limit=100`, "GET");
  const archives = await command(`${base}/results?offset=0&limit=100`, "GET");
  const originalInput = await command(
    `${base}/results/${archives.items.at(-1).id}/input?datasetId=illustrative-history&offset=0&limit=100`,
    "GET",
  );
  log(
    JSON.stringify(
      {
        diagramId: diagram.id,
        baseVersion,
        measurement: measurement.metrics,
        signals: signals.signals.length,
        backtest: backtest.results,
        scenarios: comparison.results.map((result) => ({
          scenarioId: result.scenarioId,
          firstPeriod: result.points[0],
        })),
        retainedOriginalObservations: originalInput.total,
      },
      null,
      2,
    ),
  );
  log(
    "The new editable document contains only illustrative example data. Its projections are assumptions, not forecasts.",
  );
  return {
    diagramId: diagram.id,
    measurement,
    signals,
    backtest,
    comparison,
    jobResult,
    history,
    originalInput,
  };
}

export function createBridgeClient({
  origin = "http://127.0.0.1:4317",
  mcp = false,
  token,
  workspaceId,
} = {}) {
  const address = new URL(origin);
  if (
    !["http:", "https:"].includes(address.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) ||
    !address.port ||
    address.pathname !== "/" ||
    address.search ||
    address.hash ||
    address.username ||
    address.password
  )
    throw new Error(
      "Choose an exact loopback HTTP(S) bridge origin with an explicit port, such as http://127.0.0.1:4317.",
    );
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  let nextId = 1;
  const fetchJson = async (path, data, method = "POST", extra = {}) => {
    const response = await fetch(new URL(path, address), {
      method,
      headers: { ...headers, ...extra },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(value.error ?? `Bridge HTTP ${response.status}`),
        { status: response.status, code: value.code },
      );
    return value;
  };
  const rpc = async (method, params) => {
    const value = await fetchJson(
      "/mcp",
      { jsonrpc: "2.0", id: nextId++, method, params },
      "POST",
      { "MCP-Protocol-Version": "2025-11-25" },
    );
    if (value.error)
      throw new Error(`MCP ${value.error.code}: ${value.error.message}`);
    return value.result;
  };
  const command = async (path, method = "GET", data, operationId) => {
    if (!mcp)
      return fetchJson(`/api/v1${path}`, data, method, {
        ...(workspaceId ? { "X-Visual-Nerve-Workspace": workspaceId } : {}),
        ...(operationId ? { "X-Visual-Nerve-Operation-Id": operationId } : {}),
      });
    const result = await rpc("tools/call", {
      name: "visual_nerve_request",
      arguments: {
        path,
        method,
        ...(data === undefined ? {} : { data }),
        ...(workspaceId ? { workspaceId } : {}),
        ...(operationId ? { operationId } : {}),
      },
    });
    const { status, body } = result.structuredContent;
    if (status >= 400)
      throw Object.assign(new Error(body?.error ?? `Command HTTP ${status}`), {
        status,
        code: body?.code,
      });
    return body;
  };
  const prepare = async () => {
    const health = await fetchJson("/api/v1/health", undefined, "GET");
    if (!health.capabilities?.includes("analytics-v1"))
      throw new Error(
        "This local binary is missing analytics-v1. Update the bridge executable; a website refresh does not update it.",
      );
    if (mcp) {
      await rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "Visual Nerve synthetic analytics example",
          version: "1",
        },
      });
      const discovered = await rpc("tools/list", {});
      for (const name of ["visual_nerve_api_docs", "visual_nerve_request"])
        if (!discovered.tools.some((tool) => tool.name === name))
          throw new Error(`Required MCP tool ${name} is missing.`);
      await rpc("tools/call", {
        name: "visual_nerve_api_docs",
        arguments: { document: "guide" },
      });
      await rpc("tools/call", {
        name: "visual_nerve_api_docs",
        arguments: {
          document: "endpoint",
          path: "/diagrams/{diagramId}/analytics/import/commit",
          method: "POST",
        },
      });
    }
  };
  return { command, prepare };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--mcp"))
      throw new Error(
        "Usage: node scripts/examples/analytics.mjs [--mcp]. Set VISUAL_NERVE_BRIDGE_ORIGIN or VISUAL_NERVE_WORKSPACE_ID only when needed.",
      );
    const client = createBridgeClient({
      origin: process.env.VISUAL_NERVE_BRIDGE_ORIGIN,
      mcp: args.includes("--mcp"),
      token: process.env.VISUAL_NERVE_BRIDGE_TOKEN,
      workspaceId: process.env.VISUAL_NERVE_WORKSPACE_ID,
    });
    await client.prepare();
    await runAnalyticsWorkflow(client.command);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
