# Getting help and reporting problems

Use the [Visual Nerve Guide](https://www.visualnerve.com/help/) for workflows
and [troubleshooting](https://www.visualnerve.com/help/troubleshooting/) for
saving, imports, speech, exports and API/MCP problems. Developers can start with
the [documentation index](docs/README.md).

## Choose the right report

Open the [issue chooser](https://github.com/Caripson/visualnerve/issues/new/choose):

| Report | Use it for |
| --- | --- |
| Bug report | Reproducible incorrect behavior, broken layouts, failed imports or exports. |
| Feature request | A workflow or outcome that the current tool cannot support well. |
| Usage or documentation question | Unclear instructions or help with a particular workflow. |
| Security finding | Use the private instructions in [SECURITY.md](SECURITY.md), not a public issue. |

The repository and ordinary Issues are public. A GitHub account is needed to
submit a report. Issue descriptions, comments and attachments are public; include
only information you intend to publish.

## Make a bug reproducible

1. Search existing issues and check the relevant Help page.
2. Describe what happened and what you expected.
3. Give repeatable steps, ideally from a bundled example or minimal synthetic file.
4. Include browser/version, operating system and phone/tablet/desktop.
5. Include the site hostname or local setup and revision if known; strip URL
   queries, fragments and tokens. Mention 2D/3D, theme or offline mode when relevant.
6. For scale or simulation problems, include counts, limits, scenario, duration
   and seed using synthetic data.

You may attach a redacted screenshot or short sanitized error excerpt. Do not
upload full workspace backups, private diagrams, real CSV/source data, raw HAR
files or unedited console logs. Network recordings can contain an integration
token in the WebSocket address. Nothing is attached or uploaded automatically
when you choose Report an issue.

## Local data and safe troubleshooting

Visual Nerve has no server copy of your diagrams. Before clearing browser data,
resetting storage, changing origin/profile or trying destructive troubleshooting,
export a backup for your own safekeeping. Do not attach that backup to an issue.
Opening the same website in another browser or profile creates a separate
workspace; it does not recover or synchronize existing content.

The maintainer may ask for a smaller synthetic reproduction or mark duplicates
and out-of-scope requests. There is no guaranteed response or resolution time.
The project is maintained by [Johan Caripson](https://github.com/Caripson).

## Private contact

GitHub private vulnerability reporting is enabled. Report security findings
through **Report a vulnerability** on the
[Security page](https://github.com/Caripson/visualnerve/security), following
[SECURITY.md](SECURITY.md). Keep exploit details out of ordinary Issues.

For ordinary questions, private inquiries or sensitive community-conduct
reports, email [hello@visualnerve.com](mailto:hello@visualnerve.com). Include only
the information needed to explain the matter; do not send credentials, real
customer data or full workspace backups. Public product bugs belong in GitHub
Issues. The vulnerability form is the primary route for security findings and
does not handle conduct concerns.
