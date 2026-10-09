# App interface languages

The app supports English (`en`, default), Danish (`da`), Norwegian Bokmål (`nb`),
Swedish (`sv`), Finnish (`fi`), German (`de`), Spanish (`es`) and French (`fr`).
Choose **Settings → App language**, or the selector before unlocking. Website,
Help and API documentation remain English. No remote translation service is used.
Interface language does not select a narrator or translate work.

## Classes and modules

- `i18n/locale-controller.ts`: `AppLocaleController` owns the allowlisted technical
  preference, immutable snapshots, cross-tab changes, request generations,
  requested/active display state and recoverable load failures.
- `i18n/catalog-loader.ts`: `LocaleCatalogLoader` uses eight literal dynamic
  imports, including English. Public catalogues have bounded resolved/pending
  caching; rejected loads can be retried deliberately.
- `i18n/message-formatter.ts`: `MessageFormatter` provides named text parameters,
  display-only plurals and cached Intl number/date formatters.
- `i18n/provider.tsx`: one stable provider above both existing workspace branches.
  Children mount after initial loading and stay mounted through subsequent
  requests/failures. Workspace load/open callback identities remain unchanged.
- `i18n/app-chrome.ts`: `AppChromeRenderer` updates a finite set of marked static
  editor-header leaves and accessible labels. It does not discover English text,
  traverse private content, use HTML interpolation or translate reference pages.
- `i18n/catalogs/*.ts`: complete public UI catalogues with English key and
  named-parameter parity. They contain no user values.
- `components/PropertiesFeature.tsx`: `PropertyInspectorModule` owns a stable lazy
  inspector. Empty workspaces and unopened mobile details do not load it; its
  form state stays mounted after first use. A guarded recovery keeps the editor
  available when an optional chunk fails and settles saves before reloading.
- `scripts/audit-editor-bundle.mjs`: `BrowserBundleAudit` parses the actual built
  ESM graph without executing it. Build/CI reject an entry of 400,000 bytes or
  more, a main-thread chunk of 500,000 bytes or more, and a static boot closure of
  1,000,000 bytes or more. All eight catalogues must remain separate literal
  dynamic imports. Worker-only assets are distinguished by the import graph.

Use `useI18n().t(messageId, namedParameters)` for UI copy. Use whole messages,
explicit canonical option values and stable IDs. React escapes text parameters.
Avoid translated labels as focus selectors or validation identities.
Canvas node accessibility labels are an ephemeral display callback: changing a
language invalidates cached labels while retaining source model/data and geometry.
Pure projection/export callers keep the original canonical default guidance.

## Storage and session boundary

`localStorage['visualnerve-app-language']` contains only an allowlisted language
identifier. Missing/invalid values use English, without browser-language detection.
Blocked storage retains the in-memory selection and shows a save notice.

Like Appearance, this technical preference is needed before decryption. It is not
duplicated in private settings, backups or transfer files. Controller/loader code
imports no vault, IndexedDB, graph, API dispatcher or speech engine. Storage events
never echo writes. The request is persisted before loading; a late completion
cannot broadcast an older choice into another tab.

Human selection follows existing activity rules. Imports and cross-tab events
never renew a session, unlock a vault, acquire a private lease or grant MCP access.
Lock remains effective while a public catalogue downloads.

## Canonical and authored content

Model/API fields, enums, metrics, schemas, validation codes, parser output and
simulation events remain canonical. Known diagnostics can have bounded display
adapters; unknown technical diagnostics remain verbatim. Titles, descriptions,
custom statuses, code/SQL/Markdown/CSV, filenames, generated specifications,
narration and subtitles remain unchanged. Alan and the 20 reviewed Piper voice IDs
are independent of App language. Numeric inputs remain canonical; Intl is for
display only.

## Offline and verification

All eight chunks are in the audited offline inventory. After installation,
previously unopened languages work offline. Loading/failure retains the last
successful interface; the header and `html lang` change only after success.
Offline installation can fetch public feature files into CacheStorage ahead of
use. Their JavaScript modules still initialize at their actual feature boundary;
precache work does not open an inspector or an encrypted workspace.

Unit checks cover catalogue parity, invalid/blocked preferences, out-of-order
completion, cross-tab writes, retry, snapshots, retained drafts/focus/lifecycle and
escaped parameters. Browser checks cover the actual editor, API/MCP parity,
encrypted locking/offline use and long labels on narrow light/dark screens.
Automated parity/layout checks do not constitute native-speaker certification.
