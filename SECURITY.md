# Security policy

## Reporting a vulnerability

For ordinary product bugs, follow [SUPPORT.md](SUPPORT.md). Report suspected
security vulnerabilities privately; do not put exploit details, tokens, real
customer data, source secrets or sensitive exports in an ordinary issue.

This repository is public and GitHub private vulnerability reporting is enabled.
Use **Report a vulnerability** on the
[Security page](https://github.com/Caripson/visualnerve/security) to send a private
security report to the maintainer. A GitHub account is required.

If GitHub private reporting is unavailable, email
[hello@visualnerve.com](mailto:hello@visualnerve.com) to coordinate a report.
Keep credentials, real customer data and sensitive exports out of the message.
Ordinary questions and private conduct concerns can also use that address;
see [SUPPORT.md](SUPPORT.md#private-contact). The vulnerability form is the primary
route for security findings and does not handle conduct concerns.

In the private report, include the affected revision or site hostname,
browser/device, impact and minimal reproduction using invented data. Redact URL
queries/fragments and screenshots. Do not send complete workspace backups,
original project archives, raw HAR/network recordings or unedited console logs;
the bridge's WebSocket address can contain a session token.

The maintainer reviews reports and coordinates any fix and disclosure. There is
no guaranteed response deadline or bug-bounty commitment.

## Supported revisions

Development and security fixes target the current `main` revision. Identify the
commit when reporting a local build, or the hostname and approximate observation
time for a hosted build. The site at [www.visualnerve.com](https://www.visualnerve.com/)
can lag behind `main` because deployments
are manual. This project does not currently publish a tagged-release support
matrix or promise maintenance of older revisions.

## Local storage and integration boundaries

IndexedDB in the current browser profile and origin contains all application data. The editor at `/app/`, Help and API reference have no accounts, analytics, content telemetry, remote fonts or CDN scripts. Libraries, icons, documentation and Swagger assets are bundled locally. The service worker caches static assets only. Downloaded backups are explicit exports, not a second persistence system.

Optional Google Analytics is isolated to explicitly permitted public product pages and gated by default-off Klaro consent. No Google script or denied-mode ping loads before acceptance; the integration supplies only a public route and fixed title, excluding query strings, fragments, referrers and workspace contents. Configure the Analytics property with Enhanced Measurement disabled and no Connected Site Tags or custom automatic events reading URLs or page content. These account settings cannot be verified from a Measurement ID alone. Advertising consent remains denied. Website choices are separate from the editor's required browser-storage acceptance. See [website configuration](docs/WEBSITE.md) and the [privacy policy](hugo/content/privacy.md).

The optional **Build with Lovable** handoff generates a reviewed text brief locally. Only a user click opens `https://lovable.dev/#prompt=…` in a separate tab with `noopener noreferrer`; there is no API credential or background upload. Source CSV rows, raw SQL scripts and arbitrary metadata are excluded. Recognized SQL schema and foreign-key fields use a typed allowlist, including explicit missing/unresolved references. Written descriptions, notes and schema names/type labels remain part of the previewed content. Oversized briefs stay complete and can be copied or downloaded instead. See [Lovable handoff](docs/LOVABLE.md).

SQL import analyzes SELECT/WITH query structure or DDL schema locally in a Web Worker; it never executes SQL or connects to a database. Files use the selected local import limit: 50 MiB by default, with experimental increases up to 1 GiB in Settings. Schema limits remain 2,000 table objects including external references and 100,000 columns; separate query limits are documented in [SQL import](docs/SQL_IMPORT.md). Pending analysis can be cancelled and times out after 30 seconds. Raising the file limit does not change these structural limits or the bridge's 32 MiB transport envelope. Source scripts are temporary drafts. Query diagrams retain normalized expressions, JOIN conditions and clauses, **including literal values**; sensitive filters can therefore survive persistence and exports. DDL diagrams retain recognized schema fields without INSERT/COPY rows, default/CHECK expressions, comments or procedure bodies. ENUM labels inside data types may remain as schema structure. DDL extraction handles supported CREATE/ADD definitions; it does not apply every migration or validate a database.

The Go server binds to 127.0.0.1:4317 by default and serves static files without application writes. Local integration is disabled unless started with --bridge and enabled in browser Settings. It requires an open browser. Token authentication is optional; when VISUAL_NERVE_BRIDGE_TOKEN is configured, it protects all integration reads/writes, MCP and WebSocket registration. Loopback, Host/Origin checks and the browser's access grant apply with or without a configured token. The browser keeps its token only for the session and excludes it from backups. Tokens and request payloads are not logged by the bridge.

Host and Origin checks protect against untrusted hosts and cross-origin integration requests. Development permits the explicit loopback Vite port 5173. There is no wildcard CORS. Requests and WebSocket messages are limited to 32 MiB; forwarded commands time out. JSON is parsed before forwarding, then the browser validates IDs, references, versions, dates, dimensions and URL schemes transactionally. Metadata is rendered as text; user URLs permit only absolute HTTP(S), with noopener noreferrer. Swagger's remote validator is disabled.

A static-only server can use an explicitly configured remote address. The integration bridge must bind to loopback, even with a token; remote client peers are rejected. The server does not provide multi-user authorization. Browser profiles and origins own separate workspaces; multiple connected workspaces require a target identifier for integration commands.

Use Settings → Data & Privacy → Export all data, then Restore backup. Merge retains current projects; Replace and global deletion each require explicit confirmation. Every restore is atomic. Grants, tokens and storage consent are excluded from backup imports. Keep backups before clearing browser data or changing browser/profile/origin. Unsaved conflict copies remain in the editing tab until resolved. IndexedDB access failures appear as errors, never as successful server saves.

The app can be publicly hosted on S3/CloudFront; those services contain static code only, never diagrams. Deployment verifies an application-file allowlist. No browser AWS credentials, PutObject permission or cloud content endpoints are present. Exact canonical-origin redirects prevent accidental separate workspaces.

Required storage consent precedes opening the workspace and registering offline caches. MCP defaults Off; read-only access rejects all mutation commands before repository dispatch, including attempts to enable write access. URLs are restricted to literal loopback WebSocket hosts; a public app cannot connect its bridge to a cloud URL. The local service checks explicit HTTPS app origins, supports trusted local TLS and has no wildcard CORS. See [privacy](docs/PRIVACY.md), [storage](docs/STORAGE.md) and [deployment](docs/DEPLOYMENT.md).
