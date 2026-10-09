# App languages and browser module boundaries — 9 October 2026

This change follows the verified encrypted-workspace release
`49bfdf36180e715d4cf68f8396bffd3ad7eb490d`. Its publication evidence is in
[the encrypted-workspace report](2026-10-08-encrypted-workspace.md). App language
does not replace that storage/session architecture or create a second API model.

## Implemented boundaries

Eight complete UI catalogues cover English (default), Danish, Norwegian Bokmål,
Swedish, Finnish, German, Spanish and French. The allowlisted technical preference
is available before unlock. User content, model fields, API values, simulation
events, narration and generated specifications remain unchanged. Website, Help
and API reference pages remain English.

`AppLocaleController`, `LocaleCatalogLoader`, `MessageFormatter` and
`AppChromeRenderer` separate preference, loading, formatting and marked header
updates. One stable provider retains private workspace components, drafts, focus
and camera state during language changes. Loading a catalogue cannot unlock a
vault, grant MCP access or renew an idle session.

`PropertyInspectorModule` uses a stable dynamic import. Empty workspaces and
unopened mobile Details panels do not initialize the inspector. After first use,
its forms remain mounted. A failed optional module keeps canvas editing available
and offers a human Save and reload action that waits for pending saves.

Public offline precaching can fetch feature files before use. It does not execute
those features or open an encrypted workspace. All eight languages are included
in the audited offline inventory.

## Actual release-build sizes

The final local production build passed TypeScript, Vite, Hugo, the offline
inventory and static audit. It emitted no ordinary JavaScript chunk-size warning.

| Built module | Minified bytes | Reported gzip size |
| --- | ---: | ---: |
| `editor/app.js` | 326,211 | 95.22 kB |
| `WorkspaceSurface` | 492,819 | 151.13 kB |
| `Properties` | approximately 30.58 kB | 8.19 kB |
| `jspdf.es.min` — separate export import | approximately 379.79 kB | 123.16 kB |

The actual static initial import closure is **828,259 bytes**. Eight distinct
language modules use literal dynamic imports, including English. The separate ELK
worker remains large; it executes outside the browser's main module graph.

`BrowserBundleAudit` parses the built ESM graph without executing it. Every build
and CI run enforces fixed decimal ceilings: entry below 400,000 bytes, main-thread
chunk below 500,000 bytes, and initial static closure below 1,000,000 bytes. No
Vite warning threshold was raised and no filename exemption hides a main-thread
chunk. Twelve fixture tests exercise budgets, import cycles, eager catalogue
regressions, worker distinction and unsafe paths.

## Local verification

The default full native Chrome run used **Chrome 155.0.8059.39**, one worker and
disposable contexts. It completed **253 passed / 5 failed / 11 explicit opt-in
skips**, 29.6 minutes. This initial run is retained as a failed baseline. The
follow-ups below do not relabel it as a passing full-suite run.

| Check | Recorded result |
| --- | --- |
| Complete Go race/vet and frontend checks | Passed. 2,705 unit tests in 265 suites; full formatting check. |
| New inspector boundary and build budgets | 16 additional unit tests in two suites passed. |
| Final inspector, translated properties and language contracts | 17 focused tests passed; TypeScript and full formatting passed. |
| Accessibility follow-up | All eight cases passed: public/Help/API pages, dialogs, workspace, kiosk, selection, Properties and Settings, desktop/mobile and light/dark. A homepage link now has an underline. |
| Understanding and history | Both browser cases passed after exact English expectations were updated to `SQL` and grammatical singular `1 meaningful change`. Full evidence/API equality, read-only denials, restored IDs and safety-copy assertions were retained; 22 relevant units passed. |
| Capacity-card readiness | Three unchanged native repeats passed. The original trace already showed queue 97 and three occupied units; no product change or relaxed assertion was made. |
| All eight languages and authoritative API/MCP parity | Three repeats of both browser cases passed: six total. The test now waits for the genuine initial canvas-fit save before capturing its baseline; full graph equality is retained. |
| Optional inspector loading/recovery | Both real-module browser cases passed, including failed import, continued editing, guarded reload and retained invalid metadata/focus across eight languages. These import-init tests explicitly block service workers to distinguish imports from public precaching. |
| Real encrypted language switching/offline reopen | Both native browser cases passed in the full run. All eight cached language modules work while locked/offline; human unlock restores the same graph. |
| Native 3D language switching | Passed with the same canvas element, unchanged API geometry/camera and captured faces. |
| Help captures | Four genuine encrypted-app images captured in light/dark: Settings and App language. Recovery/password material and bridge grants were absent. |
| Final ordinary-control review | Found and corrected the remaining English New scenario prompt and ephemeral process-card ARIA guidance. Sixty relevant unit tests passed, including ten new checks for all eight languages, exact authored text, cache invalidation and unchanged model/data/geometry/camera. The native prompt case passed for all eight languages with canonical generated defaults, exact authored names, unchanged remaining model and cancel behavior. |
| Complete affected-browser follow-up | **25/25 passed**, 2.4 minutes, on the final build: all accessibility cases, all eight-language UI/API/MCP checks, real scenario prompts, subprocess hierarchy, all twelve simulator UI cases and real 3D faces/camera/model retention. |

The first 14-case follow-up recorded 13 passed and one failed: the language-parity
baseline was captured before the initial camera-fit transaction finished. The
corrected test waits for the saved viewport to match the actual canvas transform;
all six repeated language cases then passed without excluding any graph fields.

The full run also passed encrypted CSV/worker/export capabilities, actual local
Piper WASM under the isolated CSP, 2D/3D video color checks, simulation API/MCP
parity, subprocess/scaling scenarios and the 2,501-card/2,500-link relief case.
Opt-in live-model and screenshot jobs are separate checks rather than silently
counted default coverage. Translation parity and layout testing do not constitute
native-speaker certification.

Local logs are ignored under `tmp/verification/`: `localization-checks-first.log`,
`localization-boundary-budgets.log`, `localization-full-native-e2e.log`,
`localization-final-native-followup.log`, `localization-capacity-native-repeat.log`,
`localization-language-native-repeat.log`, `localization-final-aria-scenario-units.log`,
`localization-build-complete.log` and `localization-native-complete-followup.log`.

## Publication gate

These are local results, not a claim that this revision has been published.
Publication requires successful whole-suite CI for the exact commit, manual
staging and browser review, then manual isolated-app deployment and actual HTTPS
production smoke, followed by manual public-website deployment and verification.
The production smoke includes real encrypted persistence, genuine offline worker
control, all eight catalogue caches, UI/API/MCP language parity and lock/grant
revocation without a certificate or mixed-content bypass.

See [App interface languages](../UI_LANGUAGES.md) for implementation conventions.
