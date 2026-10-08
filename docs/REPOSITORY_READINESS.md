# Public repository and launch maintenance

On 2026-10-08, the owner authorized opening
[Caripson/visualnerve](https://github.com/Caripson/visualnerve). The repository is
public, ordinary Issues are open and GitHub private vulnerability reporting is
enabled. The production address is [www.visualnerve.com](https://www.visualnerve.com/);
[staging](https://visualnerve.caripson.com/) remains a separate review environment.
Repository visibility, a commit and successful CI do not automatically deploy a
website revision.

## Public reporting and source

[README](../README.md) provides the product links, real screenshots and local
setup. [SUPPORT](../SUPPORT.md) directs bugs, feature requests and questions to the
public issue chooser. Three issue forms use existing labels plus `needs-triage`;
blank issues are disabled in the chooser. [CONTRIBUTING](../CONTRIBUTING.md), the PR
template, review ownership and [Code of Conduct](../CODE_OF_CONDUCT.md) define the
contribution workflow.

Security findings use **Report a vulnerability** on the
[GitHub Security page](https://github.com/Caripson/visualnerve/security), following
[SECURITY](../SECURITY.md). That private form does not handle conduct reports.
Ordinary questions, private inquiries and sensitive conduct concerns can use
[hello@visualnerve.com](mailto:hello@visualnerve.com); see
[private contact](../SUPPORT.md#private-contact). Keep public bug reports in Issues
and avoid sending credentials, customer data or full workspace backups by email.

The public repository supplies source revisions alongside [LICENSE](../LICENSE),
[NOTICE](../NOTICE) and third-party notices. Distributed builds still need matching
source and retained notices as described in [LICENSING](LICENSING.md); making the
repository public does not relicense dependencies or resolve all separate runtime
source obligations.

Before publication, a limited check of 44 reachable commits and 2,344 unique
tracked blobs found no high-confidence AWS key IDs, GitHub token patterns or PEM
private-key blocks. Metadata showed no Issues and three merged PRs, with no
indexed common attachment indicators. This was a limited credential and
metadata check, not a complete security audit or guarantee. Continue keeping
credentials in Actions secrets and user data out of source and reports.

## Keep public routes working

- Check the public issue chooser, labels, README images and Help/repository links
  after changes to their names or paths.
- Keep GitHub private vulnerability reporting enabled and verify the **Report a
  vulnerability** route from an account without maintainer permissions.
- Review available dependency-alert, secret-scanning and push-protection settings
  for the account/plan. Record settings actually enabled rather than assuming they
  are active because the repository is public.
- Keep the canonical product links on `https://www.visualnerve.com`; distinguish
  staging and historical verification records from current production instructions.
- Protect personal information in public issues/comments/attachments. Ordinary
  issue forms do not make submitted content private.

See GitHub's [private vulnerability reporting configuration](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## Releases and deployment

Opening the repository does not create a tagged release. When a release is
approved, identify its exact commit, describe its changes and known limitations,
retain license/source notices and make download/setup instructions match the
artifacts actually supplied. Do not advertise unverified binaries.

Follow [the deployment gates](DEPLOYMENT.md): successful CI for the exact revision,
manual staging, owner review, then manual production with exact-revision approval.
The original public website launch reused existing S3 website origins and
CloudFront resources. The separate encrypted app now has an explicitly prepared
private REST origin/OAC and dedicated routing/header controls; preparation does
not establish a successful application release. Its app-only build and manual
revision gates are documented in [app-origin deployment](APP_ORIGIN_DEPLOYMENT.md).
Keep the legacy www workspace accessible for verified human-controlled transfer.
Updating documents alone does not authorize deployment or change AWS resources.
