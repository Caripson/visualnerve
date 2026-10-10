import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { parse } from "jsonc-parser";

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The read-only setup check does not need a chosen public relay hostname. */
export function credentialOptions(environment) {
  const required = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
  for (const name of required)
    if (!environment[name]) throw new Error(`Missing ${name}.`);
  const token = environment.CLOUDFLARE_API_TOKEN;
  const account = environment.CLOUDFLARE_ACCOUNT_ID;
  if (!/^[a-f0-9]{32}$/i.test(account))
    throw new Error("Invalid CLOUDFLARE_ACCOUNT_ID.");
  if (token.length < 20 || token.length > 1024 || /\s/.test(token))
    throw new Error("Invalid CLOUDFLARE_API_TOKEN.");
  return { token, account };
}
/** Public configuration is validated separately from private credentials. */
export function deploymentOptions(environment) {
  const { token, account } = credentialOptions(environment);
  for (const name of [
    "COLLABORATION_WORKER_NAME",
    "COLLABORATION_WORKER_URL",
    "COLLABORATION_ALLOWED_ORIGINS",
  ])
    if (!environment[name]) throw new Error(`Missing ${name}.`);
  const name = environment.COLLABORATION_WORKER_NAME;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name))
    throw new Error("Invalid COLLABORATION_WORKER_NAME.");
  let url;
  try {
    url = new URL(environment.COLLABORATION_WORKER_URL);
  } catch {
    throw new Error("Invalid COLLABORATION_WORKER_URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("COLLABORATION_WORKER_URL must be an HTTPS origin.");
  const allowedOrigins = [
    ...new Set(
      environment.COLLABORATION_ALLOWED_ORIGINS.split(",").map((value) =>
        value.trim(),
      ),
    ),
  ];
  for (const origin of allowedOrigins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("Invalid COLLABORATION_ALLOWED_ORIGINS.");
    }
    if (
      origin !== parsed.origin ||
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password
    )
      throw new Error(
        "COLLABORATION_ALLOWED_ORIGINS must contain exact HTTPS origins.",
      );
  }
  if (!allowedOrigins.includes("https://app.visualnerve.com"))
    throw new Error("The production app Origin must be explicitly allowed.");
  const workersDev = url.hostname.endsWith(".workers.dev");
  if (workersDev && url.hostname.split(".")[0] !== name)
    throw new Error(
      "The workers.dev hostname must match COLLABORATION_WORKER_NAME.",
    );
  return { token, account, name, url, allowedOrigins, workersDev };
}
export function redact(value, secrets) {
  let text = value;
  for (const secret of secrets)
    if (secret) text = text.replaceAll(secret, "[redacted]");
  return text;
}
/** Preserve a contiguous bounded log prefix so truncation cannot leave secret fragments inside it. */
export class DeploymentOutput {
  #chunks = [];
  #bytes = 0;
  #truncated = false;
  #secrets;
  #maximum;
  constructor(secrets, maximum = 1024 * 1024) {
    this.#secrets = secrets.filter(Boolean);
    this.#maximum = maximum;
  }
  collect = (chunk) => {
    if (this.#truncated) return;
    if (this.#bytes + chunk.length > this.#maximum) {
      this.#truncated = true;
      return;
    }
    this.#chunks.push(chunk);
    this.#bytes += chunk.length;
  };
  text() {
    let text = Buffer.concat(this.#chunks).toString("utf8");
    if (this.#truncated)
      text = text.slice(
        0,
        Math.max(
          0,
          text.length -
            Math.max(0, ...this.#secrets.map((secret) => secret.length)),
        ),
      );
    return (
      redact(text, this.#secrets) +
      (this.#truncated ? "\nAdditional CLI output omitted.\n" : "")
    );
  }
}
export async function verifyCredentials(options, fetcher = fetch) {
  const headers = { Authorization: `Bearer ${options.token}` };
  const verified = await fetcher(
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
    { headers, redirect: "error", signal: AbortSignal.timeout(15_000) },
  );
  let body;
  try {
    body = await verified.json();
  } catch {
    throw new Error("Cloudflare token verification failed.");
  }
  if (!verified.ok || !body.success || body.result?.status !== "active")
    throw new Error("Cloudflare token is not active or could not be verified.");
  const account = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${options.account}`,
    { headers, redirect: "error", signal: AbortSignal.timeout(15_000) },
  );
  if (!account.ok)
    throw new Error("The configured Cloudflare account could not be accessed.");
}
async function main() {
  const arguments_ = process.argv.slice(2);
  if (
    arguments_.length &&
    (arguments_.length !== 1 || arguments_[0] !== "--verify")
  )
    throw new Error(
      "Use no arguments for manual deployment, or --verify for read-only credential verification.",
    );
  if (!process.env.CI) {
    const envPath = resolve(directory, "..", ".env");
    if (existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
      } catch {
        throw new Error("The local root .env file could not be loaded.");
      }
    }
  }
  if (arguments_[0] === "--verify") {
    await verifyCredentials(credentialOptions(process.env));
    process.stdout.write(
      "Cloudflare token is active and the configured account is accessible.\n",
    );
    return;
  }
  const options = deploymentOptions(process.env);
  const base = parse(
    await readFile(resolve(directory, "wrangler.jsonc"), "utf8"),
  );
  const configuration = {
    ...base,
    name: options.name,
    main: resolve(directory, "src/index.ts"),
    workers_dev: options.workersDev,
    vars: {
      ...base.vars,
      ENABLED: "true",
      ALLOWED_ORIGINS: options.allowedOrigins.join(","),
    },
    ...(options.workersDev
      ? {}
      : { routes: [{ pattern: options.url.hostname, custom_domain: true }] }),
  };
  const temporary = resolve(
    directory,
    ".wrangler",
    `manual-deployment-${process.pid}.json`,
  );
  await mkdir(dirname(temporary), { recursive: true });
  await writeFile(temporary, JSON.stringify(configuration), { mode: 0o600 });
  try {
    const child = spawn(
      process.execPath,
      [
        resolve(directory, "node_modules/wrangler/bin/wrangler.js"),
        "deploy",
        "--config",
        temporary,
      ],
      {
        cwd: directory,
        shell: false,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: options.token,
          CLOUDFLARE_ACCOUNT_ID: options.account,
          WRANGLER_SEND_METRICS: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const output = new DeploymentOutput([options.token, options.account]);
    child.stdout.on("data", output.collect);
    child.stderr.on("data", output.collect);
    const exit = await new Promise((resolve, reject) => {
      child.on("error", () =>
        reject(new Error("The Wrangler deployment process could not start.")),
      );
      child.on("close", resolve);
    });
    process.stdout.write(output.text());
    if (exit !== 0) throw new Error("Manual Cloudflare deployment failed.");
    process.stdout.write(
      "Manual deployment finished. Verify the relay health, Origin policy and app collaboration flow before release.\n",
    );
  } finally {
    await rm(temporary, { force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    process.stderr.write(
      "Cloudflare setup failed. Check the named .env fields, permissions and deployment configuration; credentials are never printed.\n",
    );
    process.exitCode = 1;
  });
}
