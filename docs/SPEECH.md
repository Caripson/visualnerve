# Local presentation speech

English is the default presentation language. **Settings → Presentation voice**
offers Alan (British male, default), US English LJ Speech, UK English Cori and
Swedish NST, with an explicit preview and Save voice. Existing saved choices
are retained; the new default applies when no valid voice has been selected.
Voices produce mono 16-bit WAV at 22,050 Hz. Voice character, pronunciation and
inference speed depend on the model and device. Medium/high identifies the
upstream model tier.

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
109 MiB for LJ Speech/Cori or 61 MiB for Swedish, plus the website's local
runtime files.
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
Diagram text never appears in a URL, request body or persistent speech cache.
Worker copies of narration text and generated audio remain local and ephemeral.
The original node description remains part of the saved diagram. Backups contain
no model weights or generated audio.

`SpeechService.prepare(text, voiceId, signal, progress)` returns a WAV Blob.
`preload(voiceId, signal, progress)` warms the model session and phonemizer.
Narration is serialized: at most one inference runs per service. Changing voice resets the
worker. Cancellation discards stale work; an idle warmed worker is retained,
while interrupting active inference can terminate it. Queued foreground
narration takes priority over background lookahead, and matching requests
share preparation without one consumer aborting the others. The player
keeps its own bounded narration lookahead rather than loading an entire large
diagram into audio memory. Descriptions are read in full up to 12,000 characters;
longer descriptions produce an explicit error. The adapter splits them into
sentence and word chunks of at most 240 characters and joins the generated PCM into
one WAV; it does not silently truncate the text. Local phonemizer WASM/data
files are fetched with byte limits and explicit HTTP/network error handling,
avoiding the upstream package loader's unresolved initialization on failure.

`SpeechProgress` has `stage` (`download`, `loading`, `synthesis`), `loaded`,
`total`, and `message`. Download values combine the model and configuration
bytes without resetting between files; synthesis values count completed chunks. Initialization has no
invented percentage. Player preload reports completed work across the engine
and up to three narrations and reaches 100% only when that work is ready.
If a preload attempt fails, the enabled lookahead can retry when Play resumes at the same step.
`cancel()` / `dispose()` cancel queued and running work, `cachedVoices()` lists downloaded models, and `clearCache()` removes
the voice cache. The browser setting `presentation-voice` accepts only the
four catalog IDs and defaults to `en_GB-alan-medium`.

## Model and runtime notices

| Voice                         | Model size        | Training data notice                      | Model card                                                                                                                               |
| ----------------------------- | ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `en_GB-alan-medium` (default) | 63,201,294 bytes  | Mycroft AI `apope_low`; see source notice | [Alan](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_GB/alan/medium/MODEL_CARD)        |
| `en_US-ljspeech-high`         | 114,199,011 bytes | Public domain, LJ Speech                  | [LJ Speech](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/ljspeech/high/MODEL_CARD) |
| `en_GB-cori-high`             | 114,219,352 bytes | Public domain, LibriVox                   | [Cori](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_GB/cori/high/MODEL_CARD)          |
| `sv_SE-nst-medium`            | 63,104,526 bytes  | CC0, NST / KBLab                          | [NST](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/sv/sv_SE/nst/medium/MODEL_CARD)          |

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
Swedish model downloads and neural WAV synthesis. This is deliberately outside
normal unit tests and CI: it needs Internet access, a Chrome/Playwright browser,
and an available local port. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to choose
Chrome, `PIPER_ACCEPTANCE_PORT` to change port 4328, or `PIPER_STATIC_DIR` to test
another production build. `PIPER_ACCEPTANCE_OUTPUT` defaults to a `visualnerve-piper-acceptance`
folder in the platform temporary directory (`/tmp` on Linux).

The test covers cold/warm narration, monotonic preload progress, repeated
phonemizer renewal with a warm ONNX session, pause/resume, cancellation,
foreground/background deduplication, runtime download errors/retry, unchanged
saved graph and no outbound diagram text. It saves screenshots, real WAVs,
PCM RMS/duration measurements, and model-only recovery fixtures in that
temporary directory. `PIPER_MODEL_FIXTURES` can reuse a directory containing
`en_GB-alan-medium.onnx` and its `.onnx.json` for recovery tests; the first Alan
and Swedish cases always use actual pinned Hugging Face downloads.

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
