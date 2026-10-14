# Roblox Game Builder implementation plan

Status: implementation committed and pushed to main; exact-source CI and collaboration cryptography checks passed for `8b5e36f1c1da49a7323634f822cb935f6431171f`. Real Roblox Studio and account-based verification are deferred by the owner. The goal remains open for those external checks. No production deployment or successful real-world Studio/publication check is claimed.

## Product outcome

A creator can draw a game, configure its world and rules, build a playable Roblox place, test it in Studio and deliberately publish to their own selected test place. The first example teaches the workflow. A second example demonstrates original composition with quests, inventory, player/shared variables, rounds, timers and parameterized reusable prefabs. The product must support editing these concepts beyond the bundled examples.

The primary workflow is **Idea → World → Rules → Check → Build → Studio playtest → Publish**. World coordinates use Roblox studs and degrees; diagram coordinates remain presentation. Diagram 3D relief is distinct from a world preview. Browser logic preview is a bounded explanation/test of the declarative rules, not Roblox physics or an actual Roblox server.

## Architecture decisions

- Stable template ID: `roblox-game-builder` in the existing gallery and creation flow.
- Authoritative model: versioned `Diagram.game: GameDefinition`, stored in the existing encrypted Diagram record. No extra account, server database or browser persistence store.
- Ordinary graph nodes project game entities and rules using stable metadata references. Presentation edits preserve world transforms; semantic edits reconcile both representations through one validated command boundary.
- `frontend/src/roblox/` owns contracts, validation, expansion, declarative behavior, compiler, workers, document projection and UI. Large responsibilities are separate modules/classes.
- Native builds contain explicit Roblox instances and inspected Luau. Strings and XML are escaped; rules are typed data, never arbitrary evaluated code.
- Generated multiplayer code owns progression on the server and validates native touch and interaction-prompt events. The client HUD only renders server state; it has no gameplay command endpoint and cannot grant rewards.
- A Studio importer manages a generated namespace and stable object IDs. It previews changes and applies only after a creator's choice, preserving unmanaged Studio content. Updating a complete place file and merging managed objects are different operations.
- Existing local REST/MCP discover the same model under `/roblox/capabilities` and `/diagrams/{id}/roblox`. The existing documentation/request tools remain the MCP entry points.
- Roblox publishing is a separately reviewed local bridge operation with a pinned official destination. Credentials are machine-local and never part of a diagram, backup, shared document, artifact or API response. A programmatic client cannot substitute for the human's publication confirmation.
- Building, uploading a place version and making the experience publicly accessible are separate steps. Roblox account/content requirements remain Roblox's responsibility.
- Unsupported sharing contracts reject game documents before room creation/publication rather than silently discarding the extension.

## Work sequence and ownership

1. **Contract and acceptance** — freeze strict game types, bounds and semantic reference policy; inspect official Roblox and repository integration boundaries.
2. **Pure engine and build** — implement reusable entity/rule/prefab expansion, validation, bounded deterministic logic preview, native place/Luau compiler and Studio merge tool.
3. **Document integration** — encrypted save/restore, graph projection/reconciliation, copy/import ID remapping, native exchange, operation ownership and permission checks.
4. **Creative UI** — wizard, world tools and numeric placement, nested rule builder, progression, reusable prefabs, validation, artifact review/download and Studio/publication process.
5. **API/MCP and publication** — discovery, model/collection CRUD, validation/build jobs, progress/cancel/bounded results, exact schemas and origin/session-bound publication review.
6. **Help and website** — plain-English teaching flow, reference/tutorials, genuine captures, contextual links, truthful homepage section and developer examples.
7. **Verification** — independent numerical/gameplay fixtures, actual generated Luau/place validation, security/storage/role regressions, desktop/tablet/phone browser workflows and Studio test environment.
8. **Release preparation** — format/types/OpenAPI/build/full relevant suites, main commit/push and exact-SHA CI. Production deployment is separate and manual.

## Acceptance requirements

| ID | Required evidence |
| --- | --- |
| RB01 | Gallery and normal create flow offer a blank/start example and advanced example; consent/unlock and demo reload do not create duplicate documents. |
| RB02 | Users create/edit/remove supported world objects with numeric coordinates, materials, colors and properties without source-code editing. |
| RB03 | Graph positions and world transforms remain distinct across 2D/3D, layout, resizing, world preview and native export. |
| RB04 | Users build original event/condition/action rules, including nested AND/OR/NOT and expressions, through understandable controls. |
| RB05 | Player/shared variables, inventory, quests, timers and rounds have actual tested semantics, not configuration-only fields. |
| RB06 | Parameterized prefabs expand into distinct stable instances, preserve references and support arbitrary validated compositions. |
| RB07 | A bounded deterministic preview reproduces rule behavior with clear state/event explanations and differs explicitly from Roblox physics testing. |
| RB08 | Generated XML passes a strict well-formedness parser; expected instance types, properties, references and encoding are asserted or reviewed against primary format documentation. This does not establish Roblox engine acceptance; that remains part of RB10. |
| RB09 | Generated Luau is parsed/type-checked where the available toolchain permits; independent gameplay fixtures verify every declared action/event family. |
| RB10 | A real exported starter and advanced place open and play in Studio when the arranged environment is available; unverified integration stays explicitly reported. |
| RB11 | Multiplayer state/rewards remain server-owned; invalid/spammed interactions do not bypass permissions, bounds or cooldowns. |
| RB12 | Imported names/strings/JSON, extreme numbers, invalid references, recursive expressions and malicious payloads reject safely without execution or partial writes. |
| RB13 | Studio update preview distinguishes create/update/remove/conflict, preserves unmanaged objects and requires explicit application. |
| RB14 | Repeated builds are deterministic apart from permitted run metadata; no bundled demo-only compiler special case is required. |
| RB15 | UI, REST and MCP read/write the same validated game and produce equivalent numerical behavior/build content. |
| RB16 | All important collections/configuration are programmatically discoverable with accurate schemas, defaults, bounds and rights. |
| RB17 | Builds use bounded jobs/transport and support progress/cancel; canceled or revoked jobs cannot publish late private results. |
| RB18 | Read-only previews cannot mutate; Off/lock/revocation and stale baseVersion retain their existing protections. |
| RB19 | Save/reload/native JSON/duplicate/full backup preserve complete game semantics and correctly remap references. |
| RB20 | Game content is encrypted with the existing vault; known private fixtures never enter plaintext records, caches, logs or unsolicited network requests. |
| RB21 | Collaboration either negotiates the complete contract or clearly refuses unsupported game content without losing it. |
| RB22 | Publication configuration accepts only intended official Roblox endpoints and explicit selected targets; no arbitrary host, cookie or password pathway. |
| RB23 | Local publishing credentials cannot enter diagrams, portable state, generated game scripts, browser storage, diagnostic artifacts or client responses. |
| RB24 | Publishing binds approved content digest/target to a fresh human action and current originating session; MCP cannot replay or manufacture approval. |
| RB25 | A mocked official publishing contract covers successful response, failure and unknown outcome without blind duplicate upload; actual test-place upload is separately verified when authorized credentials exist. |
| RB26 | Desktop, tablet and phone in both appearances can finish meaningful creation/edit/build workflows using keyboard and touch alternatives. |
| RB27 | A 15-year-old can follow the English quick start, understand each step, troubleshoot errors and distinguish Studio upload from public release. |
| RB28 | Help navigation/search/context links, real screenshots and developer/API/MCP examples match tested functionality. |
| RB29 | Homepage section uses genuine product visuals, transparent compatible framing, real HTML copy, correct links and no eager builder/engine load. |
| RB30 | Existing diagrams, simulation, analysis, exports, vault, offline behavior and roles pass relevant regressions; exact-SHA CI passes before release claims. |

## External verification

The owner has said they can arrange Roblox Studio and a separate test experience and has deferred that verification. Actual Studio opening, gameplay, physics, multiplayer, plugin permissions and account-based publication remain explicitly unverified. Continue implementation without reading personal Studio projects or account data. Request only the missing target/setup information when the reviewed artifact is ready; credentials must be configured locally outside chat. Account-based tests and public availability cannot be honestly inferred from mock HTTP tests.

Primary references: [Roblox data model](https://create.roblox.com/docs/projects/data-model), [place publishing](https://create.roblox.com/docs/cloud/guides/usage-place-publishing), [client/server security](https://create.roblox.com/docs/scripting/security/client-server-boundary), [publishing requirements](https://create.roblox.com/docs/production/publishing/publish-games-and-places).

## Verification evidence

The following evidence is repository-local unless explicitly stated otherwise. Synthetic test workspaces are separate from personal browser data. A passing stub or XML test does not establish acceptance by a real Roblox server.

| Requirements | Evidence and limits |
| --- | --- |
| RB01–RB04, RB06 | `roblox-ui.test.tsx`, `roblox-document.test.ts`, `templates.test.ts` and `e2e/roblox-builder.spec.ts` exercise creation, world editing, rules, prefab overrides, semantic naming and projection. Actual keyboard typing caught and fixed a negative-coordinate editing defect. |
| RB05, RB07, RB09, RB11, RB12, RB14 | `roblox-core.test.ts`, `roblox-preview.test.ts` and `verify:roblox-luau` exercise the shared simulator and actual generated code. Official Luau 0.742 compiles 30 generated scripts; nine independent runtime fixtures and two Studio-importer fixtures pass. This includes a 1,000-entity/1,000-rule model with generated source larger than 2 MiB. This is grammar and semantic verification against bounded API stubs, not engine physics or full Roblox type checking. |
| RB08, RB13 | Core fixtures parse generated XML and assert Roblox properties, references and ownership encoding. The actual generated importer runs against independent Studio API stubs for explicit preview/apply, unsaved editor buffers, stale changes, foreign ownership, preservation, staging failures and rollback. The history double deliberately excludes Source edits, matching Roblox's documented limitation; the importer stages replacement scripts and records instance swaps. Real Studio remains pending. |
| RB15, RB16 | `roblox-api.test.ts`, Go Roblox/OpenAPI contract tests and `e2e/roblox-mcp.spec.ts` verify discovery and canonical edits. Bounded configuration plus version-consistent pages reconstruct a 1,000-rule saved draft that cannot yet build, and configuration PATCH preserves its collections. The real MCP/browser test initializes discovery, reads endpoint schemas, edits in both directions, compares REST/MCP rule-test results and retrieves native XML byte-for-byte against the compiler. |
| RB17, RB18 | Worker, API, bridge lifecycle and publisher tests cover bounded jobs, progress, cancellation, stale versions, original-grant authority and late-result rejection. Existing workspace/session regression suites cover shared security boundaries. |
| RB19–RB21 | `roblox-storage.test.ts` and document fixtures cover encrypted physical records, lock/reopen, native JSON, scoped ID remapping, duplicate/backup collisions and lossless notes. Unsupported collaboration is rejected. This does not independently audit every possible cache, log or network sink; existing vault/export security tests remain relevant. |
| RB22–RB25 | Go broker and terminal-approval tests, plus `roblox-publisher.test.tsx`, cover fixed official targets, credential isolation, digest/target review, native UI actions, mandatory independent foreground-terminal confirmation, expiry, revocation and unknown outcomes. Mock HTTP tests perform no account publication. No credentials or real test-place upload have been used. |
| RB26, RB28, RB29 | Actual browser workflows, accessibility assertions and real light/dark captures cover desktop, tablet and phone. Homepage tests cover 320, 390, 768 and 1440 pixels, consent-gated template creation, no document duplication and no eager editor/data traffic. Help captures use the implemented synthetic game. |
| RB27 | English tutorials explain the workflow step by step and distinguish rule tests, Studio playtests, upload and public release. No usability session with an actual teenage participant has been recorded. |
| RB30 | The complete main CI and four collaboration cryptography jobs passed for `8b5e36f1c1da49a7323634f822cb935f6431171f`; the exact-source results are recorded below. Production deployment is a separate manual decision. |

The owner has deferred arranging Roblox Studio and the separate test game. **RB10 and the account-backed portion of RB25 remain unverified.** The goal stays open for those checks; local implementation and mock tests must not be reported as a completed real-world Studio/publication verification.

### Local release checks, 2026-10-14

- `./scripts/test.sh`: Go race tests and vet, notation-generation checks, 402 frontend test files / 4,627 tests, and full frontend formatting passed. The later bounded-configuration addition was checked separately with 66 passing tests across five core/API/storage/publication files, plus regenerated OpenAPI contracts, Go race tests and vet, types and a fresh release build.
- The full browser run exercised 397 cases: 375 passed, 21 opt-in captures/external fixtures were skipped, and one API-reference navigation helper exhausted its deadline after contract growth. Its scroll step was corrected without changing the deadline or assertions. The follow-up appearance/MCP/builder run passed 19 cases with one opt-in capture skipped, including actual desktop/tablet/phone edits and native downloads.
- After the configuration API addition and final build, all 16 appearance/MCP browser checks passed. MCP changed the player cap, the visible UI reflected it, and the shared preview/compiler produced matching state and native bytes. Invalid full records and null-marked unknown fields returned 422 without changing the model or its version.
- Pinned Luau 0.742 compiled 30 generated scripts and passed nine gameplay plus two importer fixtures, including the large-source import case. This remains test-double verification, not real Studio acceptance.
- `./build.sh` regenerated the API contract and built 44 public pages, 227 content-addressed images and 467 offline app assets. Its static audit passed. The builder is lazy-loaded; no new runtime dependency or database migration is required.

### Exact-source CI and independent checks, 2026-10-14

Source commit: `8b5e36f1c1da49a7323634f822cb935f6431171f`.

- [Main CI, run 38482849710](https://github.com/Caripson/visualnerve/actions/runs/38482849710) completed successfully. It passed 402 frontend test files / **4,629 tests**, formatting, Go race tests and vet, generated-contract and production-build checks, and **376 browser tests**. The other 21 browser cases were explicitly skipped opt-in captures/external fixtures, not passing tests. This full committed-source run supersedes the earlier local partial/follow-up browser totals above.
- [Collaboration browser cryptography, run 38482849831](https://github.com/Caripson/visualnerve/actions/runs/38482849831) completed successfully for the same SHA. All four jobs passed: Chromium, Firefox and WebKit worker checks, plus Rust source/reproducible WASM verification. Roblox game documents still intentionally reject unsupported live collaboration.
- The main CI's pinned Luau lane compiled 30 generated scripts and ran nine native semantic fixtures plus two importer fixtures successfully. Roblox API stubs do not establish real Studio, physics, networked gameplay or permission behavior.
- Go 1.26.5 cross-compilation succeeded for Windows/amd64, Darwin/arm64 and Linux/arm64. These binaries were inspected, not executed on all three platforms. Windows direct publishing remains intentionally unsupported; ordinary bridge/export compilation does not change that restriction.
- A separate, one-off local format check used `rbx_xml` 3.0.1 and reflection database `3.0.1+roblox-741`. The first-game, Crystal Island and 1,000-entity/1,000-rule native places decoded without warnings under strict class/property/type checks. Decoded server/client Source bytes matched the generated Luau, including the 2,265,263-byte large server script. Eight corrupt controls were rejected: unknown class, property and value tag; malformed attributes; wrong ownership; changed Source bytes; invalid enum; and mismatched property type. This developer check is not part of the standard CI and is not proof of Studio acceptance.

These results apply to the stated source commit. Later source changes need their own relevant checks. Production deployment remains manual and separate.

### Deferred Studio and test-place acceptance

All rows below remain **not run**. Record the Studio version, operating system, source commit and artifact digest with the outcome of each check. Use only synthetic games and a separate private test experience; do not use the owner's existing projects or record account credentials in evidence.

| Check | Procedure and expected evidence |
| --- | --- |
| Native opening and first-game route (RB10) | Build the unchanged first-game example, open `game.rbxlx` in Studio and inspect Output for load/runtime errors. Play the start, jump, checkpoint, moving bridge, star and finish route. Verify checkpoint respawn after lava damage and that touching the same star repeatedly does not repeat its once-per-player reward. |
| Real two-player state (RB10, RB11) | Use Studio's local multiplayer test with two players. Each player earns an independent star reward and retains an independent checkpoint. Rejoining starts a new player session; no cross-visit persistence is promised. Observe actual touch/prompt behavior and repeated interactions rather than substituting browser rule-test events. |
| Advanced composition (RB10) | Open an unchanged Crystal Island build in a separate place. Verify three distinct crystals advance one player's inventory and quest, the power switch changes shared Island power, and the eligible player can pay crystals to open the shared gate. Check the guide's interaction prompt, round start, two-minute timer and round-end messages. A player without the required quest/inventory must not pay or unlock the gate. |
| Physical movement and settings (RB10) | Check actual spawn/respawn, jumping, collision, moving-platform travel and NPC interaction. Verify the configured gravity, walking speed, jump power and respawn delay. An anchored guide is not a pathfinding NPC. Keep the Creator Dashboard server-size setting consistent with the game's join cap. |
| Real importer permissions and merge (RB13) | Stop the play test and save a Studio backup. Install the generated importer through the documented local-plugin flow and grant only the permissions Studio requests for this test. Add unmanaged objects and custom children. Preview an update of the same game ID, review creates/updates/removals, apply it, and verify preserved unmanaged content. Generated script instances are replaced; existing generated world objects update in place when compatible. |
| Real stale-edit and Undo behavior (RB13) | After Preview, change a managed property or an unsaved generated script buffer; Apply must reject the stale preview. With a fresh unchanged preview, apply a reviewed update, then Undo. Verify original script instances/content, world properties and custom-child parents are restored. ChangeHistory does not roll back ordinary Source edits; record actual ScriptEditorService and instance-swap behavior. |
| Explicit target upload (account-backed RB25) | Only after the owner supplies an authorized private test target, upload a reviewed artifact using Studio or the optional local publisher. For the latter, use locally configured restricted credentials, native browser review and the independent exact foreground-terminal phrase. Record the intended universe/place, approved artifact digest, returned place version and Dashboard confirmation without recording credentials. Opening the resulting private place and joining it is separate evidence from HTTP success. |
| Failure and unknown outcome (account-backed RB25) | Keep deliberately induced error cases in mocks unless a separate private-target experiment is explicitly arranged. A real interrupted upload with unknown outcome requires Dashboard reconciliation before another upload. Do not infer rollback, retry blindly or make the experience public as part of this test. |

The owner has explicitly said the Studio environment will be arranged later. Do not repeatedly request it while these checks are deferred. No further local test or green CI can substitute for the missing real-engine and account-backed evidence.
