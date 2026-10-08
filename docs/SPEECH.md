# Local presentation speech

English is the default presentation language. **Settings → Presentation voice**
offers 20 verified Piper choices across US and UK English, Swedish, French,
Spanish, Portuguese (Portugal and Brazil), Norwegian, Danish, Finnish and German.
Alan remains the default British male narrator, and existing saved choices are
retained. Select a voice, use its language-specific preview, then **Save voice**.
Choosing a voice does not translate narration.

Medium and high are the actual upstream quality tiers; there is no high+ tier.
High options include US LJ Speech and LibriTTS, UK Cori, and German Thorsten.
LibriTTS uses its fixed speaker 0; the current UI does not select its other speakers.
Jenny (Dioco) has an Irish voice despite its upstream UK catalog location.
Voices produce mono 16-bit WAV at 22,050 Hz. Character, pronunciation and speed
still depend on the individual model and device.

Narration uses the same pinned Piper neural models, Piper phonemizer WASM
1.0.0 and ONNX Runtime Web 1.18.0. A dedicated worker runs them through a small
local adapter, adapted from the MIT-licensed
[Piper TTS Web 1.0.5](https://github.com/Mintplex-Labs/piper-tts-web). The adapter
awaits initialization/inference failures, reuses the model session and
phonemizer, and warms both during preload. The pinned phonemizer retains
`callMain` arguments on its WASM stack, so the adapter renews only that module
before 8 KiB of encoded arguments or after 32 calls. The ONNX session stays
warm, and renewal reuses downloaded runtime buffers. The upstream wrapper is no longer
needed. Runtime JavaScript is bundled and the pinned WASM/data files are
served from this website under `/editor/speech/`. No runtime script is loaded
from a CDN. One WASM thread avoids requiring cross-origin isolation on S3.

Selecting or saving a voice does not download it. Audio playback, Preload,
or Preview voice explicitly starts loading. Settings shows the model size,
download progress, a cancel action and Clear downloaded voices. The first
download needs Internet access to Hugging Face and roughly 61 MiB for Alan,
109 MiB for LJ Speech/Cori, and up to 131 MiB for LibriTTS, plus the website's local
runtime files. Other catalog models are approximately 61–109 MiB.
Once cached, the model can work offline with the offline application shell.
Browser quota or private mode may prevent persistent caching; playback can
still use the downloaded model in memory. Browser storage can be reclaimed.

Only fixed model/config URLs from commit
`c10ece1aade47bb51c153c893d14e5bf8e5b7117` of
[`rhasspy/piper-voices`](https://huggingface.co/rhasspy/piper-voices) are used.
Every downloaded file is bounded to its known byte length and verified using
SHA-256 before use or caching. The separate CacheStorage cache
`visualnerve-piper-models-v1` stores only voice weights and configuration.
There is no unversioned OPFS voice cache.
Diagram text never appears in a network URL or request body. Model caching contains
only public assets. Full-presentation preload retains up to 32 MiB of prepared clips
in RAM and spills additional clips into an encrypted temporary CacheStorage
cache, with a 1 GiB aggregate ciphertext ceiling including IV/tag overhead.
One clip during synthesis/decryption can temporarily add up to 32 MiB beyond
the prepared cache; these limits do not bound total browser or inference memory. Each cache/entry has a random identifier;
AES-256-GCM keys remain in RAM and are separate from the workspace key. No readable
WAV, title, description or key is persisted there. Cache writes participate in the
app-cache clear barrier. Closing the presentation, changing voice/tour,
or locking discards the key and removes its cache. A crash can leave ciphertext
without its key; **Clear app cache** also removes these owned temporary caches.
Preloaded audio is not recoverable after reload. Browser quota can stop preparation
before the ciphertext ceiling; an explicit error is shown, never a false 100%.
Worker copies of narration text and generated audio remain local and transient.
The original node description remains part of the saved diagram. Backups contain
no model weights or generated audio.

`SpeechService.prepare(text, voiceId, signal, progress)` returns a WAV Blob.
`preload(voiceId, signal, progress)` warms the model session and phonemizer.
Narration is serialized: at most one inference runs per service. Changing voice resets the
worker. Cancellation discards stale work; an idle warmed worker is retained,
while interrupting active inference can terminate it. Queued foreground
narration takes priority over background lookahead, and matching requests
share preparation without one consumer aborting the others. The player
prepares the entire selected numbered sequence or storyboard when Preload is
requested, starting from its first step even when the playback cursor is later.
Identical voice/text clips may share preparation; all steps count toward readiness.
RAM remains bounded by the encrypted temporary spill strategy above. Descriptions are read in full up to 12,000 characters;
longer descriptions produce an explicit error. The adapter splits them into
sentence and word chunks of at most 240 characters and joins the generated PCM into
one WAV; it does not silently truncate the text. Local phonemizer WASM/data
files are fetched with byte limits and explicit HTTP/network error handling,
avoiding the upstream package loader's unresolved initialization on failure.

`SpeechProgress` has `stage` (`download`, `loading`, `synthesis`), `loaded`,
`total`, and `message`. Download values combine the model and configuration
bytes without resetting between files; synthesis values count completed chunks. Initialization has no
invented percentage. Player preload reports completed work across every step in the selected
sequence, reaching 100% only when all required narration is ready. Blank narration
and already prepared clips need no new inference or engine initialization.
It exposes actual ready/total counts and does not treat current-step preparation
as completion. Retry after correcting a preparation or quota error.
`cancel()` / `dispose()` cancel queued and running work, `cachedVoices()` lists downloaded models, and `clearCache()` removes
the voice cache. The browser setting `presentation-voice` accepts only the
20 catalog IDs and defaults to `en_GB-alan-medium`.

## Model and runtime notices

| Voice                                | Model size        | Source notice                                                                  | Model card                                                                                                                                               |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `en_GB-alan-medium` (default)        | 63,201,294 bytes  | MIT model · Mycroft AI training source (see model card)                        | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_GB/alan/medium/MODEL_CARD)                  |
| `en_US-ljspeech-high`                | 114,199,011 bytes | MIT model · public-domain training data                                        | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/ljspeech/high/MODEL_CARD)                |
| `en_GB-cori-high`                    | 114,219,352 bytes | MIT model · public-domain training data                                        | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_GB/cori/high/MODEL_CARD)                    |
| `sv_SE-nst-medium`                   | 63,104,526 bytes  | MIT model · CC0 training data                                                  | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/sv/sv_SE/nst/medium/MODEL_CARD)                   |
| `en_US-libritts-high`                | 136,673,811 bytes | MIT model · CC BY 4.0 training data                                            | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/libritts/high/MODEL_CARD)                |
| `en_US-joe-medium`                   | 63,201,294 bytes  | MIT model · CC0 training data                                                  | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/joe/medium/MODEL_CARD)                   |
| `en_US-kristin-medium`               | 63,531,379 bytes  | MIT model · public-domain training data                                        | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/kristin/medium/MODEL_CARD)               |
| `en_US-norman-medium`                | 63,531,379 bytes  | MIT model · public-domain training data                                        | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/norman/medium/MODEL_CARD)                |
| `en_GB-alba-medium`                  | 63,201,294 bytes  | MIT model · CC BY 4.0 training data                                            | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_GB/alba/medium/MODEL_CARD)                  |
| `en_GB-northern_english_male-medium` | 63,201,294 bytes  | MIT model · CC BY-SA 4.0 training data                                         | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_GB/northern_english_male/medium/MODEL_CARD) |
| `en_GB-jenny_dioco-medium`           | 63,201,294 bytes  | MIT model · Dioco attribution-required training data; commercial use permitted | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_GB/jenny_dioco/medium/MODEL_CARD)           |
| `en_GB-cori-medium`                  | 63,531,379 bytes  | MIT model · public-domain training data                                        | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_GB/cori/medium/MODEL_CARD)                  |
| `fr_FR-siwis-medium`                 | 63,201,294 bytes  | MIT model · CC BY 4.0 training data                                            | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/fr/fr_FR/siwis/medium/MODEL_CARD)                 |
| `es_ES-davefx-medium`                | 63,201,294 bytes  | MIT model · CC0 training data                                                  | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/es/es_ES/davefx/medium/MODEL_CARD)                |
| `pt_PT-tugão-medium`                 | 63,201,294 bytes  | MIT model · CC0 training data                                                  | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/pt/pt_PT/tugão/medium/MODEL_CARD)                 |
| `pt_BR-faber-medium`                 | 63,201,294 bytes  | MIT model · CC0 training data                                                  | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/pt/pt_BR/faber/medium/MODEL_CARD)                 |
| `no_NO-talesyntese-medium`           | 63,201,294 bytes  | MIT model · CC0 training data                                                  | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/no/no_NO/talesyntese/medium/MODEL_CARD)           |
| `da_DK-talesyntese-medium`           | 63,201,294 bytes  | MIT model · CC0 training data                                                  | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/da/da_DK/talesyntese/medium/MODEL_CARD)           |
| `fi_FI-harri-medium`                 | 63,201,294 bytes  | MIT model · CC0 training data                                                  | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/fi/fi_FI/harri/medium/MODEL_CARD)                 |
| `de_DE-thorsten-high`                | 113,895,201 bytes | MIT model · CC0 training data                                                  | [Model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/de/de_DE/thorsten/high/MODEL_CARD)                |

The model repository declares MIT. Alan’s model card links its Mycroft AI
training source, whose notice remains separate from the model license.
Runtime components include ONNX Runtime (MIT), Piper phonemizer (MIT, Michael Hansen), and eSpeak NG (GPL-3.0).
eSpeak generates phoneme identifiers; the neural voice supplies the audio.
The NPM phonemizer manifest's MIT label does not replace eSpeak's GPL notice.
Full license texts and upstream notices are retained in `third_party/licenses/`
and copied to the site's `/licenses/` by production license generation.
[The pinned runtime source and build recipe](https://github.com/diffusionstudio/piper-wasm/tree/022edba0455ef024574747e1134ef893f1d71b76)
links [Piper source](https://github.com/wide-video/piper-phonemize) and
[eSpeak source](https://github.com/rhasspy/espeak-ng). Runtime binaries are
copied verbatim from the pinned NPM packages by `scripts/speech-assets.mjs`.

## Opt-in browser acceptance

After `./build.sh`, run `node scripts/acceptance-piper.mjs` for real Alan and
Swedish model downloads and neural WAV synthesis. Add `PIPER_HIGH_VOICES=1`
to exercise US LibriTTS (fixed speaker 0) and German Thorsten high-quality
models too; it does not download all 20 voices. This is deliberately outside
normal unit tests and CI: it needs Internet access, a Chrome/Playwright browser,
and an available local port. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to choose
Chrome, `PIPER_ACCEPTANCE_PORT` to change port 4328, or `PIPER_STATIC_DIR` to test
another production build. `PIPER_ACCEPTANCE_OUTPUT` defaults to a `visualnerve-piper-acceptance`
folder in the platform temporary directory (`/tmp` on Linux).

The test starts in the middle of a 35-step presentation, prepares all 35
steps and replays them without new synthesis. It also covers cold/warm
narration, monotonic preload progress, repeated
phonemizer renewal with a warm ONNX session, pause/resume, cancellation,
foreground/background deduplication, runtime download errors/retry, unchanged
saved graph and no outbound diagram text. It saves screenshots, real WAVs,
PCM RMS/duration measurements, and model-only recovery fixtures in that
temporary directory. `PIPER_MODEL_FIXTURES` can reuse a directory containing
`en_GB-alan-medium.onnx` and its `.onnx.json` for recovery tests. Used
Swedish/selected high-model fixtures can also be retained for later reuse;
missing fixtures download from their actual pinned Hugging Face URLs.

The acceptance script also exports a short MP4 from a warm Alan player, decodes
its AVC/AAC tracks and measures real audio energy while checking that the graph
stays unchanged. To run just this final handoff check against an existing model
fixture, run:

```sh
PIPER_MOVIE_ONLY=1 PIPER_MODEL_FIXTURES=/path/to/fixtures \
  node scripts/acceptance-piper.mjs
```

The fixture directory contains the two Alan files listed above; synthesis and
video encoding remain real.

The regular browser suite distinguishes an explicitly mocked speech-protocol
regression (full preload, progress and native audio playback without model
downloads), a native WebCrypto/CacheStorage encrypted-clip proof, and actual
pronunciation/WASM compatibility for every pinned catalog configuration. Those
checks do not claim to measure the neural audio quality of all 20 voices; the
opt-in acceptance above runs real selected ONNX models.
