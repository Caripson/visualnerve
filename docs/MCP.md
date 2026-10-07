# MCP understanding and diagram presentations

Connect Codex to the local HTTP(S) `/mcp` server and keep Visual Nerve open with local storage accepted. The browser stores the diagrams in IndexedDB. Enable **Settings → MCP access → Read + write** to save or control a presentation. Read only permits GET discovery/state and exact question/app-brief preview requests. The public website serves app files and documentation; the MCP bridge runs on the user's computer.

Call `visual_nerve_api_docs` first. Its default compact guide and full `{"document":"openapi"}` response describe both canonical definitions and playback. Commands use `visual_nerve_request` with paths that omit `/api/v1`.

1. Fetch `/diagrams/{diagramId}` to read current node UUIDs and `diagram.version`.
2. Read `GET /diagrams/{diagramId}/presentation`. An absent definition returns `{version:1,nodeIds:[],secondsPerNode:8,transitionMs:1200}`.
3. Save the desired order using `PUT /diagrams/{diagramId}/presentation` with exactly `{baseVersion,presentation}`. The definition contains `version:1`, ordered unique existing `nodeIds`, `secondsPerNode:2..600`, and `transitionMs:0..10000`. Success returns Graph; stale versions return 409. Use the latest version for the next write.
4. Open with `POST /presentation/open` and optional `{diagramId,source:"nodes"|"storyboard"}` (default source nodes). Play, pause, rewind, forward and close with the respective `POST /presentation/{action}` and an exact `{}` body.
5. Read `GET /presentation` for playback state. Options use `PATCH /presentation` with at least one of boolean `audio`, `subtitles`, `preload` and `minimized`, and no other keys.

For example:

```json
{
  "path": "/presentation/open",
  "method": "POST",
  "data": { "diagramId": "EXISTING_DIAGRAM_UUID" }
}
```

The sequence belongs to `diagram.settings.presentation` and uses the same nodes in 2D and 3D. Array positions are contiguous numbers starting at 1; the maximum is 20,000 nodes. Export and backup preserve it, imported or duplicated diagrams remap IDs, deleted nodes are removed from the sequence, and clipboard copies begin unnumbered.

All runtime mutations require write access and accepted storage, including camera movement and preloading. Playback state is transient: `{open,diagramId,status,index,total,nodeId,audio,subtitles,preload,minimized,buffered,progress,message,source,sceneId,nodeIds,edgeIds,title,narration}`. Status is `idle`, `loading`, `moving`, `playing`, `paused`, `ended` or `error`; index is zero-based or -1 for an empty sequence. The state does not replace diagram nodes or their saved geometry.

Use `PATCH /presentation` with `{minimized:true}` to minimize the controls or `{minimized:false}` to expand them. GET returns the same panel state shown in the UI; opening defaults to expanded on desktop and minimized in compact layouts. This works during playback without pausing or changing audio/subtitles. Captions remain separately over the diagram when subtitles are enabled, including in 3D. The panel state is not persisted in the diagram and is not a video-export option. See the [player guide](PRESENTATION.md).

Audio and preload start disabled; subtitles start enabled. `GET /presentation/voices` returns `{defaultVoiceId,voices}` with model IDs, labels, languages, sample rates, download sizes, licenses and sources. `GET /settings/presentation-voice` reads the saved selection. PUT that path with exact `{value:"en_GB-alan-medium"}`, `{value:"en_US-ljspeech-high"}`, `{value:"en_GB-cori-high"}` or `{value:"sv_SE-nst-medium"}` to choose a voice. Alan, a British male Piper voice, is the default; existing explicit voice choices are retained. Speech generation runs locally, while first use can download model assets; explicit `POST /presentation/preload` with `{}` warms the model and phonemizer and prepares up to three upcoming clips. Read `progress` (0–1) and `message` for the overall preload percentage, ready narration count and actual download/synthesis percentage; opaque initialization remains indeterminate. Generated speech and playback progress are not canonical graph data.

## Export the walkthrough as video

`POST /presentation/video` starts an asynchronous export of the full saved sequence from its first node, in the current 2D or 3D view, at 1280 × 720 and 30 fps. Its exact body accepts optional boolean `audio`/`subtitles` and `source:"nodes"|"storyboard"`; `{}` uses the current player options and source, initially audio off and subtitles on. The player opens to show progress if needed. For example:

```json
{
  "path": "/presentation/video",
  "method": "POST",
  "data": { "audio": true, "subtitles": true }
}
```

Read `GET /presentation/video` for `{status,progress,nodeIndex,total,format,message,fileName,source}`. Status is `idle`, `preparing`, `exporting`, `complete`, `cancelled` or `error`. Progress is 0..1; nodeIndex is zero-based or -1 before an active node. Format is `mp4`, `webm` or null, and fileName may be null. Cancel with `DELETE /presentation/video` and exact `{}`. POST and DELETE require accepted local storage and Read + write; GET permits Read only. Unknown fields or nonboolean options are rejected.

MP4 is preferred, with WebM fallback when the required video and optional audio codecs are supported. Audio is never dropped to produce a file. Completion downloads the video in the connected browser; its **Save video again** control repeats the download. **MCP returns state, never video bytes**. Keep that tab visible; editing, manual camera interaction or closing the player cancel export. `POST /presentation/close` with exact `{}` also cancels it. Competing playback commands and new exports return 409 while export or cancellation cleanup is active; GET state stays available. The graph and its saved sequence remain unchanged.

Export uses local neural speech and inserts WAVs offline, without a screen picker, audible playback or an audio playback gesture. Explicit export with audio may download the selected model assets. Long subtitle descriptions use pages and extend dwell time to at least 3 seconds per page. The file is capped at 256 MiB and the final timeline at 30 minutes, including transitions and completed narration. Output is fixed at 1280 × 720. Native 2D rendering supports at most 5,000 visible cards per frame and a 128 MiB card texture cache. 3D export requires a complete visible projection of at most 8,000 objects and 16,000 relationships; truncated projections fail. Unsupported codecs and exceeded limits fail explicitly without omitting objects or truncating content. Export buffers are temporary and are excluded from IndexedDB, JSON and backups.

See the [complete API guide](../API.md) and [generated OpenAPI contract](openapi.yaml) for the exact schemas and errors.

## Understand large systems through MCP

The compact guide, initialize instructions and tool descriptions also advertise semantic overview, source-backed relationship questions, named local history, storyboards and reviewed Lovable specifications. Read [the five workflows](UNDERSTANDING.md) for exact requests and limits. Discover proxies through `/diagrams/{id}/overview/projection`; never edit summary IDs as ordinary objects. Use exact read-only POST `/diagrams/{id}/questions` or `/build-brief` to inspect modeled paths and generate an unsent app brief. These previews do not change graph versions.

History uses `/diagrams/{id}/history`; review `…/{snapshotId}/compare` before a versioned `…/{snapshotId}/restore`, which atomically checkpoints current work. Storyboards use `/diagrams/{id}/storyboard`; open with `{source:"storyboard"}`, preview paused with POST `/presentation/seek` and `{index}`, or export with optional `{source:"storyboard"}` at `/presentation/video`. Saved scene views require their matching current mode and **Details** (overview off). Preview/playback/video returns 422 otherwise; choose Details or omit `view` to auto-fit, including overview. English remains the default voice; Swedish is available.

Reviewed app additions and decision answers use `/diagrams/{id}/build-specification`. Proposed screens/read endpoints and unresolved assumptions are explicit; do not treat generated proposals as existing services. Saving these definitions and controlling playback require Read + write. Original CSV cells are returned only by an explicit measure evidence request, not by relationship questions or app briefs.
