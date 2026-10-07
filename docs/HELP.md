# Help architecture and maintenance

The public Help is a local, static Hugo documentation section at `/help/`. It has 16 task-oriented guides, real application screenshots, topic navigation, per-guide contents, adjacent-guide links and full-text search. It shares `/appearance.js` and the workspace palette. Search and reading require no bridge, backend, workspace consent or diagram access.

## Coverage

| Guide           | Product surface                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| getting-started | Consent, all eleven templates, first workflow, desktop/mobile navigation, local saving                                                             |
| editing         | All visual object kinds, connections, properties, status/quick actions, owners/search/filters, groups, drawing, copy/undo/delete, shortcuts        |
| layouts         | Mind map editing, Balanced/directional/radial layout, focus mode, ordinary modes, dated timelines                                                  |
| 3d              | Styled card relief, camera gizmo/orientations, object placement, synchronized 2D moves, fallback/export/view limits                                |
| csv             | Cleanup, numeric formats, row filters, grouping, measures, pagination, source evidence and bounds                                                  |
| connected-data  | Multiple sources, matching, quality, evidence, identity/column mapping, refresh, relationships and analysis views                                  |
| sql             | SELECT/WITH blocks, joins/aliases/lineage, DDL tables/composite keys, warnings and retained information                                            |
| code            | All 50 language capabilities/extensions, script/project detail, Python/COBOL examples, confidence, card scroll/resize and limits                   |
| diagram-import  | draw.io/Visio pages, previews/warnings, native conversion and format bounds                                                                        |
| understanding   | Semantic overview, questions/evidence, graph paths, named views and safe snapshot history                                                          |
| presentations   | Numbered order, compact player, subtitles/audio/preload, voices/cache, storyboard/camera and video                                                 |
| simulation      | All assumption categories, queues/shared resources, routing/scaling/investments/economics, scenarios, controls/metrics/replay and execution bounds |
| sharing         | Restorable/visual outputs, scopes/resolution/PDF tiling, Markdown/JSON imports, backups, Lovable specification/handoff                             |
| settings        | Appearance, storage/offline, portable backup/restore, retention/import limits, speech, MCP grants, conflicts and deletion                          |
| api-mcp         | Local process/addresses/setup, discovery, targeting/versioning, practical code/3D/simulation requests and demand stress testing                    |
| troubleshooting | Recovery procedures, missing work, import/save/view/voice/video/simulation/integration/mobile issues                                               |

## Add or update a guide

1. Edit `hugo/content/help/<slug>.md`. Keep unique weights 1–16, a descriptive title and a one-sentence summary. Use source-verified UI labels and distinguish desktop/mobile routes.
2. Explain purpose, action steps, expected results, examples, common problems, limits and related guides. Do not claim execution/compiler analysis/cloud synchronization where the tool supplies only structure or local state.
3. Capture actual current UI using synthetic data. Use descriptive alt text and a caption matching what is visible. Screenshots are clickable, lazy-loaded and capped at natural dimensions.
4. Keep cross-page hashes valid. `/help/` retains all previous guide anchors for incoming API/Privacy/bookmark links.
5. If a slug or screenshot basename is added, update the strict static audit allowlist in `scripts/audit-static.mjs` and the guide-count expectations where appropriate.

`hugo/layouts/help/list.json` builds `/help/index.json` from the same guide content; no manually maintained search index is needed. `/help/help.js` performs bounded local query matching and constructs results using text nodes. Topic links and contents work without search JavaScript. The offline service worker includes every Help route, search asset and curated screenshot; `/api/` commands remain excluded.

Search results sit immediately below the field on desktop and mobile. Typing collapses the mobile Topics panel so results remain visible. Arrow Down or Enter moves to the first result; Escape clears the query and returns focus to search. The clear button, focus gutters and 16px mobile input text prevent clipped outlines and unwanted touch zoom. `help-search.spec.ts` checks these behaviors at 320, 390 and 1440px.

## Regenerate screenshots

Build first. Capture tests use isolated browser storage and local fixture servers, never a user's browser profile, diagram or integration token. They do not send a Lovable prompt or download voice assets.

```sh
./build.sh
cd frontend
VN_CAPTURE_HELP=1 npm run test:e2e -- help-screenshots.spec.ts
```

The guided process setup, connected-node menu and live congestion images come from the corresponding functional tests:

```bash
VN_CAPTURE_PROCESS=1 npm run test:e2e -- process-wizard.spec.ts process-building.spec.ts
```

The opt-in capture suite needs `cwebp` and converts genuine Playwright PNG captures to WebP. On this macOS host, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the installed Chrome executable. Normal test runs skip capture and do not overwrite published screenshots. Review the output visually before committing; regenerate affected images after interface changes.

## Verify

Run `./scripts/test.sh`, build, then run `help.spec.ts`, `appearance.spec.ts` and the relevant editor/browser regressions. Help E2E checks the full guide index, screenshot loading/full-size links, local URLs and cross-page anchors, keyboard search/no-results, desktop/390px/320px themes, fresh-page privacy and offline guides/images/search. The overview regression also covers the selection toolbar's discovered overlap with navigation controls.

Publishing remains manual, with separate staging and production workflows and exact revision gates; see [deployment](DEPLOYMENT.md).
