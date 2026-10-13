# Help architecture and maintenance

The public Help is a local, static Hugo documentation section at `/help/`. It has 26 task-oriented guides, real application screenshots, topic navigation, per-guide contents, adjacent-guide links and full-text search. It shares `/appearance.js` and the workspace palette. Search and reading require no bridge, backend, workspace consent or diagram access.

## Coverage

| Guide                   | Product surface                                                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| getting-started         | Consent, template choices, first workflow, desktop/mobile navigation, local saving                                                                                                                             |
| editing                 | All visual object kinds, connections, properties, status/quick actions, owners/search/filters, groups, drawing, copy/undo/delete, shortcuts                                                                    |
| layouts                 | Mind map editing, Balanced/directional/radial layout, focus mode, ordinary modes, dated timelines                                                                                                              |
| 3d                      | Styled card relief, camera gizmo/orientations, object placement, synchronized 2D moves, fallback/export/view limits                                                                                            |
| csv                     | Cleanup, numeric formats, row filters, grouping, measures, pagination, source evidence and bounds                                                                                                              |
| connected-data          | Multiple sources, matching, quality, evidence, identity/column mapping, refresh, relationships and analysis views                                                                                              |
| sql                     | SELECT/WITH blocks, joins/aliases/lineage, DDL tables/composite keys, warnings and retained information                                                                                                        |
| code                    | All 50 language capabilities/extensions, script/project detail, Python/COBOL examples, confidence, card scroll/resize and limits                                                                               |
| diagram-import          | draw.io/Visio pages, previews/warnings, native conversion and format bounds                                                                                                                                    |
| understanding           | Semantic overview, questions/evidence, graph paths, named views and safe snapshot history                                                                                                                      |
| presentations           | Numbered order, compact player, subtitles/audio/preload, voices/cache, storyboard/camera and video                                                                                                             |
| simulation              | Guided single/nested setup, process navigation and rollups, all assumption categories, queues/shared resources, routing/scaling/investments/economics, scenarios, controls/metrics/replay and execution bounds |
| infrastructure-capacity | CPU reservations, stage/case RAM, shared multi-site payload transfers, generation/grid/battery supply, combined datacenter assumptions and domain counters                                                     |
| sharing                 | Restorable/visual outputs, scopes/resolution/PDF tiling, Markdown/JSON imports, backups, Lovable specification/handoff                                                                                         |
| settings                | Appearance, storage/offline, portable backup/restore, retention/import limits, speech, MCP grants, conflicts and deletion                                                                                      |
| api-mcp                 | Local process/addresses/setup, discovery, targeting/versioning, practical code/3D/simulation requests and demand stress testing                                                                                |
| collaboration           | Local room creation, device approval, participant roles, shared profiles, comments, tasks and activity on desktop/mobile                                                                                       |
| time-series-analysis    | Local time-series import, semantic charting, saved measurements, causal signals, Signal Lab, explicit Growth & Churn scenarios, API/MCP and bounded encrypted archives                                         |
| ibm-flowcharting        | Original 25-hole and revised 26-hole IBM forms, 43 catalog entries, native object editing, 2D/3D and exports                                                                                                   |
| flowchart-symbols       | Practical use of all 32 completed symbols, two apertures, four arrowheads and five original forms; source-verified distinctions and examples                                                                   |
| notation-collections    | Collection choice, actual palette/Properties editing, sections, ports, attachments, draft review and native export scope                                                                                       |
| hipo                    | Numbered VTOC, linked overview/detail IPO, differentiated relationships and separately sourced classic media                                                                                                   |
| dfd                     | Yourdon–DeMarco and Gane–Sarson dialects, processes/entities/stores, named data flow and manual decomposition consistency                                                                                      |
| uml                     | All fourteen families, specialist examples, compartments, ports, interactions, timing and endpoint semantics                                                                                                   |
| bpmn                    | Process/collaboration/conversation/choreography views, activities/events/gateways, participant structures and valid relationship boundaries                                                                    |
| troubleshooting         | Recovery procedures, missing work, import/save/view/voice/video/simulation/integration/mobile issues                                                                                                           |

## Add or update a guide

1. Edit `hugo/content/help/<slug>.md`. Keep unique weights 1–26, a descriptive title and a one-sentence summary. Use source-verified UI labels and distinguish desktop/mobile routes.
2. Explain purpose, action steps, expected results, examples, common problems, limits and related guides. Do not claim execution/compiler analysis/cloud synchronization where the tool supplies only structure or local state.
3. Capture actual current UI using synthetic data. Use descriptive alt text and a caption matching what is visible. Screenshots are clickable, lazy-loaded and capped at natural dimensions.
4. Keep cross-page hashes valid. `/help/` retains all previous guide anchors for incoming API/Privacy/bookmark links.
5. If a slug or screenshot basename is added, update the strict static audit allowlist in `scripts/audit-static.mjs` and the guide-count expectations where appropriate.

`hugo/layouts/help/list.json` builds `/help/index.json` from the same guide content; no manually maintained search index is needed. `/help/help.js` performs bounded local query matching and constructs results using text nodes. Topic links and contents work without search JavaScript. The offline service worker includes every Help route, search asset and curated screenshot; `/api/` commands remain excluded.

Search results sit immediately below the field on desktop and mobile. Typing collapses the mobile Topics panel so results remain visible. Arrow Down or Enter moves to the first result; Escape clears the query and returns focus to search. The clear button, focus gutters and 16px mobile input text prevent clipped outlines and unwanted touch zoom. `help-search.spec.ts` checks these behaviors at 320, 390 and 1440px.

## Regenerate screenshots

The symbol-use reference embeds small inline SVGs from trusted Hugo data, with `currentColor` outlines that follow Help's saved/system appearance. `scripts/help-flowchart-symbols.mjs` generates `hugo/data/flowchart_symbols.json` from the same TypeScript catalog and recommended proportions as the editor. The normal build runs this before Hugo; run `node scripts/help-flowchart-symbols.mjs --check` to detect drift. `flowchart-help.test.ts` checks all 43 labels, categories, paths, details and proportions plus reference coverage. No application module is loaded by the guide. Its inline vectors are cached with the guide HTML.

Build first. Capture tests use isolated browser storage, synthetic diagrams/profiles and local fixture servers, never a user's browser profile, content or integration token. They do not send a Lovable prompt or download voice assets. The published inventory has **79 Help light/dark pairs (158 WebPs)**, plus **four website device pairs** and one social preview. Counts below are unique contributions after duplicate captures.

```sh
./build.sh
cd frontend
```

Run the required families from `frontend`:

| Family               | Command                                                                                                              | Unique Help pairs | Output                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------: | ------------------------------------------------------------------------------------------- |
| Main Help            | `VN_CAPTURE_HELP=1 npm run test:e2e -- help-screenshots.spec.ts`                                                     |                29 | Help WebPs                                                                                  |
| Guided processes     | `VN_CAPTURE_PROCESS=1 npm run test:e2e -- process-wizard.spec.ts process-building.spec.ts process-hierarchy.spec.ts` |                 6 | Help WebPs                                                                                  |
| Source projects      | `VN_CAPTURE_PROJECT=1 npm run test:e2e -- code-project.spec.ts project-file-limit.spec.ts`                           |                 2 | Help WebPs                                                                                  |
| Time series          | `VN_CAPTURE_ANALYTICS=1 npm run test:e2e -- analytics-ui.spec.ts`                                                    |                 7 | Help WebPs                                                                                  |
| Infrastructure       | `npm run test:e2e -- infrastructure-capacity.spec.ts`                                                                |                 6 | PNGs in `tmp/verification`; promote using the mapping below                                 |
| Language/settings    | `VN_CAPTURE_LANGUAGE_HELP=1 npm run test:e2e -- language-help-screenshots.spec.ts`                                   |                 1 | Help WebPs; also refreshes Settings                                                         |
| Encrypted workspace  | `VN_CAPTURE_VAULT_HELP=1 npm run test:e2e -- vault-help-screenshots.spec.ts`                                         |                 5 | Help WebPs; also refreshes MCP Settings                                                     |
| Presentation voice   | `VN_CAPTURE_VOICE_HELP=1 npm run test:e2e -- voice-help-screenshots.spec.ts`                                         |                 1 | Help WebPs                                                                                  |
| IBM workflow         | `VN_CAPTURE_IBM=1 npm run test:e2e -- ibm-flowcharting.spec.ts --grep 'readable IBM workflow'`                       |                 2 | Help WebPs                                                                                  |
| Notation collections | `VN_CAPTURE_NOTATION=1 npm run test:e2e -- notation-collections.spec.ts`                                             |                 4 | HIPO, Gane–Sarson DFD, UML class and BPMN process Help WebPs; the hub reuses the class view |
| Parallel execution   | `VN_CAPTURE_PARALLEL=1 npm run test:e2e -- simulation-parallel.spec.ts`                                              |                 2 | PNGs in `docs/acceptance`; promote below                                                    |
| Editable export      | `VISUAL_NERVE_CAPTURE_EXCHANGE=1 npm run test:e2e -- exchange-export.spec.ts --grep 'capture editable export UI'`    |                 2 | PNGs in `docs/acceptance`; promote below                                                    |
| App update           | `npm run test:e2e -- app-updates.spec.ts --grep 'real update notice and controls fit'`                               |                 2 | PNGs in Playwright test output; preserve/promote below                                      |
| Collaboration        | From the repository root: `VN_CAPTURE_COLLABORATION=1 node collaboration-crypto/workflow-browser-test.mjs`           |                10 | Actual app/relay workflow; verified PNG pairs promoted to Help WebPs                        |

Infrastructure captures remain diagnostic PNGs during normal tests; promotion is explicit. Use `cwebp -lossless -m 6 -quiet INPUT.png -o OUTPUT.webp` from the repository root. Each input basename below has `-light.png` and `-dark.png` variants under `tmp/verification`; output goes to `hugo/static/help/images` as `NAME.webp` and `NAME-dark.webp`.

| Capture basename                               | Help basename               |
| ---------------------------------------------- | --------------------------- |
| `infrastructure-api-compute-capacity`          | `infrastructure-api`        |
| `infrastructure-network-multi-site-capacity`   | `infrastructure-network`    |
| `infrastructure-energy-power-capacity-metrics` | `infrastructure-energy`     |
| `infrastructure-datacenter-capacity`           | `infrastructure-datacenter` |
| `infrastructure-setup-1440`                    | `infrastructure-setup`      |
| `infrastructure-390`                           | `infrastructure-mobile`     |

Run the whole Main Help file: its final case deliberately replaces the initial layouts, backup and COBOL views with readable examples. Run language and vault captures afterwards so their dedicated Settings/MCP views remain. Leave `VN_CAPTURE_ANALYTICS_SCENARIOS_ONLY` unset for all seven time-series pairs. The collaboration workflow uses disposable local owner/editor/viewer profiles, closes its room and writes a review manifest under `tmp/collaboration-workflow-review`; without its opt-in flag it keeps review PNGs and does not replace Help assets.

Most families convert their genuine PNGs directly into `hugo/static/help/images`. Parallel and editable-export captures require this promotion from the repository root:

```sh
for name in parallel-delivery-desktop parallel-delivery-mobile export-editable-desktop export-editable-mobile
do
  for suffix in '' '-dark'
  do
    cwebp -lossless -m 6 -quiet "docs/acceptance/${name}${suffix}.png" \
      -o "hugo/static/help/images/${name}${suffix}.webp"
  done
done
```

App-update captures use `testInfo.outputPath`; preserve the four fresh PNGs before another Playwright invocation clears its default output directory. Convert each with `cwebp -lossless -m 6 -quiet INPUT.png -o OUTPUT.webp` using this mapping:

| Captured PNG                   | Help WebP basename       |
| ------------------------------ | ------------------------ |
| `update-notice-1440-light.png` | `app-update`             |
| `update-notice-1440-dark.png`  | `app-update-dark`        |
| `update-notice-390-light.png`  | `app-update-mobile`      |
| `update-notice-390-dark.png`   | `app-update-mobile-dark` |

For website images, run `VN_CAPTURE_SITE=1 npm run test:e2e -- site-screenshots.spec.ts` from `frontend`. It creates four ordinary blank diagrams through the real create/bulk/versioned graph APIs and writes actual desktop (1920 × 1080), laptop (1440 × 900), tablet (1024 × 1366) and phone (390 × 844) light/dark pairs to `hugo/static/site/images`. The flowcharts show customer delivery, invoice approval, colleague onboarding and a compact service request, using canonical IBM symbols with distinct saved background colors. It also derives 16 smaller WebP previews with native `dwebp`/`cwebp`: desktop 480/960, laptop 400/800, tablet 256/512 and phone 128/256 pixels wide, in both themes. Their names are `{device}-{width}{-dark}.webp`; the homepage selects them with `srcset` and `sizes`, while full-size image links keep the original capture. The same opt-in suite also refreshes the Help `new-diagram` pair with the Classic Flowcharting gallery label. It derives `social.webp` as a 1200 × 675 resize of the genuine light desktop capture. To repeat that native resize separately from the repository root:

```sh
dwebp hugo/static/site/images/desktop.webp -o /tmp/visual-nerve-social.png
cwebp -resize 1200 675 -q 85 -m 6 -quiet /tmp/visual-nerve-social.png \
  -o hugo/static/site/images/social.webp
```

The capture workflow needs `cwebp` (`dwebp` for the social resize). On this macOS host, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the installed Chrome executable. Normal test runs do not overwrite published screenshots. Review both themes and phone containment before committing. Keep conceptual collaboration illustrations, device-frame vectors and catalog SVG geometry separate from actual UI captures. **Rebuild after all image writes and promotions**, then verify the generated Help/site and offline assets; a successful capture does not update an existing build or production website.

## Verify

Run `./scripts/test.sh`, build, then run `help.spec.ts`, `appearance.spec.ts` and the relevant editor/browser regressions. Help E2E checks the full guide index, screenshot loading/full-size links, local URLs and cross-page anchors, keyboard search/no-results, desktop/390px/320px themes, fresh-page privacy and offline guides/images/search. The overview regression also covers the selection toolbar's discovered overlap with navigation controls.

Publishing remains manual, with separate staging and production workflows and exact revision gates; see [deployment](DEPLOYMENT.md).
