# Dependencies and licenses

Visual Nerve's original code is MPL-2.0; see [LICENSE](LICENSE), [NOTICE](NOTICE) and [source-distribution requirements](docs/LICENSING.md). This inventory covers third-party components, whose terms remain independent.

Versions are locked in frontend/package-lock.json, collaboration-worker/package-lock.json, collaboration-crypto/Cargo.lock and backend/go.mod/go.sum. The complete direct/transitive inventory, including development and platform-specific optional packages, is [docs/third-party-licenses.json](docs/third-party-licenses.json). Regenerate with `node scripts/licenses.mjs /path/to/go` after installing dependencies. Production builds copy available upstream license/notice files to `public/licenses/`. The optional Go communication bridge uses coder/websocket (ISC) and has no persistent storage. Optional realtime collaboration loads a separate OpenMLS 0.9.1 Rust/WASM worker using RFC 9420; its adapter source, pinned toolchain and retained Cargo notices are in collaboration-crypto/. This adapter has not been independently audited.

| Direct dependency | Version | License | Role |
| --- | --- | --- | --- |
| github.com/coder/websocket | v1.8.15 | ISC | direct runtime |
| @diffusionstudio/piper-wasm | 1.0.0 | MIT wrapper / GPL-3.0-or-later eSpeak runtime | direct runtime |
| @playwright/test | 1.63.0 | Apache-2.0 | direct development |
| @testing-library/jest-dom | 6.9.1 | MIT | direct development |
| @testing-library/react | 16.3.3 | MIT | direct development |
| @types/node | 24.19.1 | MIT | direct development |
| @types/papaparse | 5.5.2 | MIT | direct development |
| @types/react | 19.3.0 | MIT | direct development |
| @types/react-dom | 19.3.0 | MIT | direct development |
| @types/three | 0.186.0 | MIT | direct development |
| @vitejs/plugin-react | 5.2.0 | MIT | direct development |
| @xyflow/react | 12.12.0 | MIT | direct runtime |
| axe-core | 4.14.0 | MPL-2.0 | direct development |
| dexie | 4.4.6 | Apache-2.0 | direct runtime |
| elkjs | 0.12.0 | EPL-2.0 OR GPL-3.0-or-later | direct runtime |
| entities | 8.1.0 | BSD-2-Clause | direct runtime |
| fake-indexeddb | 6.2.5 | Apache-2.0 | direct development |
| fflate | 0.8.3 | MIT | direct runtime |
| html-to-image | 1.11.11 | MIT | direct runtime |
| jsdom | 27.4.0 | MIT | direct development |
| jspdf | 4.2.1 | MIT | direct runtime |
| klaro | 0.7.21 | BSD-3-Clause | direct runtime |
| lucide-react | 0.468.0 | ISC | direct runtime |
| mediabunny | 1.61.3 | MPL-2.0 | direct runtime |
| onnxruntime-web | 1.18.0 | MIT | direct runtime |
| papaparse | 5.7.0 | MIT | direct runtime |
| prettier | 3.7.4 | MIT | direct development |
| react | 19.3.0 | MIT | direct runtime |
| react-dom | 19.3.0 | MIT | direct runtime |
| saxes | 6.0.0 | ISC | direct runtime |
| swagger-ui-dist | 5.33.1 | Apache-2.0 | direct runtime |
| three | 0.186.1 | MIT | direct runtime |
| typescript | 5.9.3 | Apache-2.0 | direct development |
| vite | 7.3.6 | MIT | direct development |
| vitest | 4.1.11 | MIT | direct development |
| yjs | 13.6.33 | MIT | direct runtime |
| zustand | 5.0.15 | MIT | direct runtime |
| @cloudflare/vitest-plugin | 1.4.0 | MIT | direct development |
| @cloudflare/workers-types | 5.20261010.1 | MIT OR Apache-2.0 | direct development |
| jsonc-parser | 3.3.1 | MIT | direct development |
| typescript | 5.9.3 | Apache-2.0 | direct development |
| vitest | 4.1.11 | MIT | direct development |
| wrangler | 4.149.0 | MIT OR Apache-2.0 | direct development |

Hugo (Apache-2.0), Go (BSD-3-Clause), Node.js (MIT with bundled third-party notices) and npm (Artistic-2.0) are build/install tools, not browser runtime services. ELK.js is a required layout dependency under EPL-2.0 (with its stated secondary-license conditions); we do not modify its source. The optional local neural voice engine bundles eSpeak-ng under GPL-3.0-or-later; its corresponding-source and build links are in [docs/SPEECH.md](docs/SPEECH.md) and the distributed license notices. Most application dependencies use MIT, BSD or Apache licenses. Lucide icons use ISC, with the upstream Feather notices retained.

Implementation references: [React Flow PNG export](https://reactflow.dev/examples/misc/download-image), [React Flow components](https://reactflow.dev/api-reference), [ELK.js](https://github.com/kieler/elkjs), [Dexie](https://dexie.org/docs/), [jsPDF](https://github.com/parallax/jsPDF), [coder/websocket](https://github.com/coder/websocket). Editor code and assets run locally; optional public-page analytics is separately consent-gated. These implementation-reference links are documentation, not runtime requests.
