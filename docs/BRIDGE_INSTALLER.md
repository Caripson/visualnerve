# Hosted-workspace bridge installer

The release build produces a small, reviewable shell installer for the optional
native bridge. It is for connecting a local MCP client to an open hosted browser
workspace. It does not install the editor, move browser data, unlock a vault or
grant MCP access. Publishing these files follows the existing manual staging and
production workflows; creating a build does not make it available on production.

## User workflow

Follow the [user quick start](https://www.visualnerve.com/help/api-mcp/#quick-start-connect-your-local-ai-tool)
for the browser, local-agent and Windows/WSL steps. Copy
**Settings → MCP / API integration → Instructions for your MCP client → Copy MCP instructions**
and paste it into a local agent with terminal access, or follow it yourself. First check
the intended listener. If no compatible Visual Nerve service is running, download
the linked setup file using curl, wget or Python 3, inspect it, and run its exact
command. Do not pipe an unread network response into a shell. The normal
production command after downloading the script is:

```sh
bash ./visual-nerve-bridge-setup.sh \
  --origin https://app.visualnerve.com --addr 127.0.0.1:47417
```

The setup file is `/downloads/visual-nerve-bridge-setup.sh` on the app/website
surface named by Settings. It contains the source ZIP URL and checksum for that
release. The source archive is content-addressed, and the adjacent
`bridge-release.json` records source/installer hashes, sizes, bridge version,
source revision, dirty-tree state and toolchain version. A source revision is
provenance, not a substitute for checking the downloaded bytes.

First setup downloads private Go **1.26.9**, verifies the published Go archive's
pinned SHA-256, verifies the source ZIP's embedded SHA-256, safely extracts the
source and builds the native binary with its matching OpenAPI contract. It needs
internet, Bash, basic system utilities, trusted CA certificates and one HTTPS
downloader. It needs no existing Go, Node, npm, Hugo, git or unzip. ZIP extraction
uses the Go helper with path validation even when unzip is installed.

If no downloader is installed, obtaining the script is a separate bootstrap step:
install curl/wget/Python using the operating system's normal package manager and
required administrator permission, or obtain the reviewed file through another
trusted download method. An already-acquired script accepts
`--install-system-deps` to explicitly permit installing missing curl and CA
certificates with apt, dnf, apk or Homebrew where available. Ordinary setup does
not silently use sudo. This option does not guarantee repair of every proxy or
certificate configuration.

## Installation and process ownership

The default directory is `~/.local/share/visual-nerve/bridge`. Use
`--install-dir /absolute/dedicated/path` to choose another location. Files and logs
belong to this installation; shell profiles and an existing system Go toolchain
are not replaced. No login service, launch agent or systemd service is created.
The bridge starts by default and must be started again after reboot.

```sh
bash ./visual-nerve-bridge-setup.sh --install-only
bash ./visual-nerve-bridge-setup.sh --status
bash ./visual-nerve-bridge-setup.sh --stop
```

`--install-only` builds without starting a bridge. Status and stop use the saved
local setup helper and do not download a new toolchain/source archive. Repeat
setup reuses a healthy process with the same managed release, origin and
address. An update or configuration change can restart only the verified process
owned by this installation. Stored PID alone is insufficient: process identity,
executable/command and start identity must match. A conflicting or unverifiable
process is left running with a diagnostic. A failed download, integrity check or
build must not replace a usable release or stop its existing bridge.

Managed state is in `state.json`; release directories, private toolchains,
build cache and `bridge.log` are underneath the chosen directory. These are
native program files and process metadata, not a browser workspace backup. Do not
post a complete log or installation directory publicly without reviewing it.
To remove the installation, stop its verified process first, then remove only
that installation directory. Never clear browser storage to uninstall a bridge.

## Addresses, permissions and supported environments

The installer chooses a single explicit loopback listener, defaulting to
`127.0.0.1:47417`. It does not scan or fall back to another port. It does not start
the backend's optional legacy alias because it passes an explicit address. A
service on legacy port 4317 is left alone. Custom ports still require the app's
approved HTTP and HTML CSP; setup cannot change those policies.

`--origin` must be the exact hosted browser origin, without an editor path.
`--addr` accepts a supported loopback hostname/address and explicit numeric port.
The initial installer starts HTTP; an existing HTTPS/WSS connection needs its
trusted certificate setup and must not be silently downgraded. Advanced
token/TLS setups remain available through the documented native bridge flags.
Setup does not accept a workspace password, recovery key or browser access grant.

Linux/WSL and macOS x86_64/arm64 are target platforms; native Windows shells are
not supported. A Linux Docker test is not proof that Windows Chrome can reach a
particular WSL instance. Confirm localhost forwarding, firewall, host and browser
local-network permission on that machine. Do not expose the bridge publicly to
work around a connection problem.

After startup, verify JSON health, initialize MCP and discover both tools. Begin
with `visual_nerve_api_docs` and `{"document":"guide"}`. The user must separately
unlock the browser and choose Read only or Read + write. Installation cannot
replace this human boundary; Off, lock, revocation and a closed browser retain
their existing behavior.

## Build and release contract

`scripts/package-bridge-installer.mjs` takes a reviewed source tree and an HTTPS
site origin. It packages a bounded source allowlist: backend source and module
checksums, the build script, notation catalog and license notices. It excludes
credentials, `.env`, browser exports, tests, Git history and unrelated application
assets. The archive has one `visual-nerve-bridge/` root. The generated installer
embeds `scripts/bridge-installer-helper.go` and the release constants from
`scripts/bridge-installer.sh.in`.

The source checksum and pinned toolchain checksum detect changed bytes; they are
not independent signatures against a compromised website serving a replaced
installer. Review downloaded scripts and trust the release origin. Go module
verification still applies to the dependency versions in `go.sum`. Initial source
builds require the configured Go module network services.

Run the packager's tests and artifact audit before publication. Stable installer
and release-metadata URLs must revalidate; content-addressed ZIPs may use immutable
caching. S3 content types must preserve the shell file, JSON and ZIP bytes. No
production deployment follows automatically from packaging or pushing a commit.

## Verification boundaries

The fresh-install acceptance harness is
`scripts/bridge-installer-tests/run.sh`. It creates disposable Debian containers
without Go, curl, unzip or a precompiled bridge. The first scenario has wget,
downloads the generated setup over HTTPS, verifies its advertised checksum and
uses the setup to download Go and compile the actual bridge. A second scenario
has no downloader and verifies the explicit package-manager bootstrap. The HTTPS
fixture uses a test-only CA; the actual Go archive uses its real download origin
and pinned checksum. No certificate validation is disabled.

The harness covers idempotence, source corruption, archive traversal, busy ports
and managed-process ownership. Its logs/result describe the source actually
tested. It never mounts an existing browser profile or home, publishes no port
by default and removes its own resources. Optional `VN_INSTALL_TEST_KEEP=1`
retains a successful source-built installation for a follow-on browser/MCP test;
the result identifies the exact owned container/network for later cleanup.

This is separate from `scripts/mcp-docker/`, whose normal image deliberately
prebuilds a bridge to test browser/client integration. That older journey alone
does not verify installation on a new machine. Real browser integration against
the newly installed executable, native macOS and Windows/WSL results must each
be reported explicitly when exercised; none is implied by passing Linux setup.

### Recorded verification, 14 October 2026

The clean Linux amd64 run passed 12 installation checks using Docker 24.0.6,
including the missing-downloader branch and rejection of inherited Go cache
helpers. The follow-on journey used Chrome 155.0.8059.40 on macOS and the same
Linux executable built by setup, with its binary checksum verified before the
browser test. It exercised local encrypted-workspace creation, actual Settings
clipboard instructions, starting setup after a Read only grant without a page
reload, MCP guide/schema discovery, permission checks, a node created through
MCP and displayed in the UI, operation recovery, and explicit Off.

The website and download origin were isolated HTTPS test fixtures. Download TLS
validation remained enabled; the browser fixture used its separate test
certificate configuration. A test-only Docker relay connected host Chrome to
the installed loopback listener. This is not a production-hosting check or a
Windows Chrome-to-WSL networking result. The wrapper removed its containers,
network and fixture files afterward. Evidence is written under
`tmp/verification/bridge-installer-linux/` and
`tmp/verification/bridge-installer-chrome/`; CI preserves the equivalent artifacts.

Run `./scripts/bridge-installer-tests/browser.sh` to repeat installation and the
browser journey together after building the local website. CI runs this as a
separate job so a precompiled bridge fixture cannot replace installation
coverage. The smaller native helper tests and generated-installer tests also
cover macOS process ownership and system Bash 3.2; they do not establish a full
native macOS installation or any Windows/WSL network configuration.
