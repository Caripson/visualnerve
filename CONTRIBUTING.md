# Contributing to Visual Nerve

Start with the [support guide](SUPPORT.md) for bugs, questions and feature requests.
Use [SECURITY.md](SECURITY.md) for security findings and follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Discuss the problem first

For substantial functionality or architecture changes, open a feature request
with the user workflow and expected outcome before investing in a large patch.
Small, well-scoped fixes and documentation corrections can be proposed directly.
Reports and proposed changes are reviewed by the maintainer; submission does not
promise acceptance or a delivery date.

The repository and issue forms are public. Submit a pull request from your fork
targeting `main`. Report vulnerabilities through the private GitHub Security
route in [SECURITY.md](SECURITY.md), rather than an ordinary issue. Maintainer and
automated work in this checkout follows [AGENTS.md](AGENTS.md): work directly on `main`
without creating feature branches or worktrees unless the owner requests them.

## Set up and verify

Follow [DEVELOPMENT.md](DEVELOPMENT.md) for supported tools, local serving and
browser test installation. Run the checks relevant to your change:

```sh
./scripts/test.sh
# Full production build and browser acceptance suite:
./scripts/test.sh --e2e
```

Use synthetic test data and isolated test browser profiles. Never run destructive
tests against a real workspace. For a documentation-only change, check local
links, examples and any affected Hugo pages; include the production build when
page templates or generated documentation change. CI runs the complete suite on
pull requests and pushes to `main`.

Format frontend changes with `cd frontend && npm run format` and Go changes with
`gofmt`. Describe the checks actually run and any limitations in your PR.

## Keep the architecture coherent

- Preserve the local-first model: IndexedDB owns workspace data; no mandatory
  cloud persistence or AI dependency.
- Keep canonical graph/simulation semantics separate from rendering. UI, API and
  MCP must use the same model and engine.
- Add cohesive modules instead of extending the largest files with unrelated
  responsibilities. See [ARCHITECTURE.md](ARCHITECTURE.md).
- Preserve IDs, versions, undo, transactional writes and old documents. Schema
  changes need migrations and compatibility checks.
- Update user Help, API/MCP documentation and generated OpenAPI together when
  supported behavior changes. `./build.sh` regenerates OpenAPI and license notices.
- Include meaningful regressions for changed behavior. For UI changes, check
  keyboard use, desktop/mobile, Light/Dark and offline behavior where relevant.
- Keep limits, cancellation and aggregation explicit for large inputs. Rendering
  must not become the source of simulation truth.

## Source, privacy and licensing

Do not commit credentials, `.env` files, customer data, real workspace backups,
browser profiles or raw network recordings. The integration token can appear in
a bridge URL. Review test attachments and screenshots before sharing them.

Contributions to original covered source and documentation use the existing
[MPL-2.0 license](LICENSE); preserve [NOTICE](NOTICE) and third-party terms.
Do not relicense bundled dependencies or copy material without permission.
See [licensing and source distribution](docs/LICENSING.md).

## Deployment

Contributing or merging code does not deploy the website. S3/CloudFront deployments are
manual and require successful CI for the exact revision. Production additionally
requires the owner's reviewed approval. Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md);
never trigger a deployment as part of an automatic commit or push.
