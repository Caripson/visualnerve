# Getting help and reporting problems

Use the [Visual Nerve Guide](https://visualnerve.caripson.com/help/) for workflows
and [troubleshooting](https://visualnerve.caripson.com/help/troubleshooting/) for
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

A GitHub account is needed to submit an issue. During the private preview,
only people with repository access can use GitHub reports. Existing private
issues and attachments may become public when the repository opens: treat
everything submitted there as publishable.

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

No external private contact address is currently published. During the private
preview, invited repository participants can use the question form to ask Johan
Caripson for a private contact route. State only that you need a private channel;
do not include vulnerability details, personal allegations or sensitive data in
that request. Keep those details for the private channel once established.

Security findings follow [SECURITY.md](SECURITY.md). GitHub's dedicated private
vulnerability reporting must be enabled when the repository opens. This route
does not handle sensitive community-conduct reports; a separate private contact
remains a launch prerequisite in [repository preparation](docs/REPOSITORY_READINESS.md).
