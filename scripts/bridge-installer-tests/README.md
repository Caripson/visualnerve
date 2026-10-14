# Fresh Linux bridge installation acceptance

Run from the repository root with Docker, Node and the frontend dependencies,
Python 3 and OpenSSL available on the test host:

```sh
./scripts/bridge-installer-tests/run.sh
```

Host prerequisites orchestrate the test; the installer runs inside fresh Debian
containers. The baseline container has wget but no Go, curl, unzip, Python or
bridge binary. It downloads the generated installer over a locally trusted HTTPS
fixture, verifies its checksum, then installs pinned Go and builds the actual
bridge. This is not the precompiled-bridge fixture in `scripts/mcp-docker/`.

The second container has no downloader. It first rejects setup without explicit
prerequisite consent, then runs the already-acquired reviewed setup file with
`--install-system-deps`, exercising real apt installation. Receiving that file is
an out-of-band prerequisite for this branch, not an impossible zero-downloader
fetch. Neither container receives a user's home, environment file or credentials.

Results and command logs are written to
`tmp/verification/bridge-installer-linux/`. The test removes its containers and
network, retaining reusable Docker images. No host ports are published normally.
Native macOS and Windows/WSL are not established by this Linux evidence.

For a subsequent browser/MCP journey using this newly installed executable:

```sh
VN_INSTALL_TEST_KEEP=1 ./scripts/bridge-installer-tests/run.sh
```

A successful run retains its owned containers, network and public fixture files;
`result.json` records them. Host port 47417 must be free. Its loopback-only Docker
publication leads to container port 47418, where the follow-on test can run a
test-only TCP relay to the real installed listener at container 127.0.0.1:47417.
The installer never creates that relay, and the native bridge remains bound to
loopback. A failed test always removes its owned containers instead of retaining a
partial setup.

## Real Chrome and MCP through the installed bridge

With Chrome installed and the app built locally, run the complete installation
and browser journey:

```sh
./scripts/bridge-installer-tests/browser.sh
```

To consume a successful retained installation from the command above instead of
repeating the Linux installation tests:

```sh
./scripts/bridge-installer-tests/browser.sh --existing
```

The wrapper verifies the recorded container/network identities, read-only fixture
mounts and host loopback publication. It checks the downloaded installer's hash,
then uses that same script to set the exact test origin. It verifies that the
installed bridge's executable hash is unchanged. Only the test relay is compiled,
using the Go toolchain just installed inside the container; no precompiled bridge
is substituted.

The browser uses a fresh profile and a synthetic workspace at
`https://mcp-docker.test:4342/`. The installed Linux client initializes MCP, reads
the matching guide and endpoint schema, creates a diagram through the user's
explicit UI grant, verifies its appearance in Chrome, and confirms revocation.
The explicit staging target and reviewed asset-hash requirements from
`scripts/mcp-docker/config.mjs` are also supported; production is not an allowed
target.

After success or failure the wrapper removes the exact verified fixture
containers, network and temporary public download directory. Docker images remain
cached. Browser screenshots, assertions and wrapper/cleanup evidence remain under
`tmp/verification/bridge-installer-chrome/`; Playwright failure artifacts remain
under `tmp/verification/installer-mcp-results/`. A retained result can therefore
be consumed only once. This tests Linux Docker and host Chrome, not native WSL
localhost forwarding.
