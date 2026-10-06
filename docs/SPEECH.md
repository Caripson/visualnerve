# Local presentation speech

English is the default presentation language. Settings offers US English
LJ Speech high quality, UK English Cori high quality, and Swedish NST medium
quality. Voices produce mono 16-bit WAV at 22,050 Hz. The actual quality and
inference speed depend on the voice and the device.

Narration uses [Piper TTS Web](https://github.com/Mintplex-Labs/piper-tts-web)
1.0.5 with ONNX Runtime Web 1.18.0. A dedicated worker runs the neural VITS
model. The runtime JavaScript is bundled with the application and the pinned
WASM/data files are served from this website under `/editor/speech/`.
No runtime script is downloaded from a CDN. One WASM thread avoids requiring
cross-origin isolation headers from static S3 hosting.

Selecting or saving a voice does not download it. Audio playback, Preload,
or Preview voice explicitly starts loading. Settings shows the model size,
download progress, a cancel action and Clear downloaded voices. The first
download needs Internet access to Hugging Face and roughly 109 MB for either
English voice or 60 MB for Swedish, plus the website's local runtime files.
Once cached, the model can work offline with the offline application shell.
Browser quota or private mode may prevent persistent caching; playback can
still use the downloaded model in memory. Browser storage can be reclaimed.

Only fixed model/config URLs from commit
`c10ece1aade47bb51c153c893d14e5bf8e5b7117` of
[`rhasspy/piper-voices`](https://huggingface.co/rhasspy/piper-voices) are used.
Every downloaded file is bounded to its known byte length and verified using
SHA-256 before use or caching. The separate CacheStorage cache
`visualnerve-piper-models-v1` stores only voice weights and configuration.
The upstream library's unversioned OPFS cache is disabled in the speech worker.
Diagram text never appears in a URL, request body or persistent speech cache.
Worker copies of narration text and generated audio remain local and ephemeral.
The original node description remains part of the saved diagram. Backups contain
no model weights or generated audio.

`SpeechService.prepare(text, voiceId, signal, progress)` returns a WAV Blob.
`preload(voiceId, signal, progress)` loads the model/session. Narration is
serialized: at most one inference runs per service. Changing voice resets the
worker; cancellation terminates it and discards stale queued tasks. The player
keeps its own bounded narration lookahead rather than loading an entire large
diagram into audio memory. Descriptions are read in full up to 12,000 characters;
longer descriptions produce an explicit error. Piper splits them into sentence
and word chunks of roughly 400 characters and joins the generated PCM into
one WAV; it does not silently truncate the text.

`SpeechProgress` has `stage` (`download`, `loading`, `synthesis`), `loaded`,
`total`, and `message`. Download values are bytes; synthesis values are chunk
counts where available. `cancel()` / `dispose()` cancel queued and running
work, `cachedVoices()` lists downloaded models, and `clearCache()` removes
the voice cache. The browser setting `presentation-voice` accepts only the
three catalog IDs and defaults to `en_US-ljspeech-high`.

## Model and runtime notices

| Voice | Model size | Training data notice | Model card |
| --- | --- | --- | --- |
| `en_US-ljspeech-high` (default) | 114,199,011 bytes | Public domain, LJ Speech | [LJ Speech](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/ljspeech/high/MODEL_CARD) |
| `en_GB-cori-high` | 114,219,352 bytes | Public domain, LibriVox | [Cori](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_GB/cori/high/MODEL_CARD) |
| `sv_SE-nst-medium` | 63,104,526 bytes | CC0, NST / KBLab | [NST](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/sv/sv_SE/nst/medium/MODEL_CARD) |

The model repository declares MIT. Runtime components include ONNX Runtime
(MIT), Piper phonemizer (MIT, Michael Hansen), and eSpeak NG (GPL-3.0).
eSpeak generates phoneme identifiers; the neural voice supplies the audio.
The NPM phonemizer manifest's MIT label does not replace eSpeak's GPL notice.
Full license texts and upstream notices are retained in `third_party/licenses/`
and copied to the site's `/licenses/` by production license generation.
[The pinned runtime source and build recipe](https://github.com/diffusionstudio/piper-wasm/tree/022edba0455ef024574747e1134ef893f1d71b76)
links [Piper source](https://github.com/wide-video/piper-phonemize) and
[eSpeak source](https://github.com/rhasspy/espeak-ng). Runtime binaries are
copied verbatim from the pinned NPM packages by `scripts/speech-assets.mjs`.
