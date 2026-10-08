# Repository preparation and public launch

The repository stays private until the owner deliberately changes its visibility.
Repository preparation, a commit and a successful CI run do not publish the repo
or deploy the website.

## Repository information

The project overview belongs in [README](../README.md), including the current
preview site, real screenshot and local setup. GitHub should have a concise
description, the currently available website and relevant discovery topics.
Do not describe `www.visualnerve.com` as launched before production approval.

The repository includes a support policy, three issue forms, contributor guide,
PR template, review ownership, Code of Conduct and security policy. GitHub Issues
is the shared channel for bugs, feature requests and usage/documentation questions;
blank issues are disabled in the chooser. The forms use existing repository labels
plus `needs-triage`. Adding these files does not submit any reports.

## Before opening the repository

- Confirm the private contact in [SUPPORT](../SUPPORT.md) and [SECURITY](../SECURITY.md).
- Review existing issues, attachments and history for information that is not
  intended to become public. Private issue visibility changes with repository
  visibility. Keep credentials in Actions secrets, never source or issue bodies.
- Confirm [LICENSE](../LICENSE), [NOTICE](../NOTICE), third-party notices and actual
  corresponding-source availability described in [LICENSING](LICENSING.md).
- Confirm that the current main revision passes CI and all linked documentation
  is available to the intended readers.

## Immediately after opening

- Enable GitHub private vulnerability reporting and verify the **Report a
  vulnerability** route while signed in as an account without maintainer access.
- Verify the public issue chooser, labels, README images and Help/repository links.
- Review available GitHub dependency-alert, secret-scanning and push-protection
  settings for the account/plan. Record settings actually enabled rather than
  claiming unavailable features are active.
- Update GitHub's website URL and the README site links when the reviewed production
  site is actually launched. Keep historical deployment records distinguishable
  from current instructions.

GitHub private vulnerability reporting is a public-repository feature; the private
preview needs the confirmed contact route. See GitHub's
[configuration instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## Releases and deployment

No tagged release is created by this preparation. When a release is approved,
identify its exact commit, describe its changes and known limitations, retain
license/source notices and make download/setup instructions match the artifacts
actually supplied. Do not advertise binaries that have not been built and verified.

Follow [the deployment gates](DEPLOYMENT.md): successful CI for the exact revision,
manual staging, owner review, then manual production with exact-revision approval.
This document grants no approval to publish, provision AWS infrastructure or deploy.
