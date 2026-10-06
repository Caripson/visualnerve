# MCP diagram presentations

Connect Codex to the local HTTP(S) `/mcp` server and keep Visual Nerve open with local storage accepted. The browser stores the diagrams in IndexedDB. Enable **Settings → MCP access → Read + write** to save or control a presentation. Read only permits GET discovery and state requests. The public website serves app files and documentation; the MCP bridge runs on the user's computer.

Call `visual_nerve_api_docs` first. Its default compact guide and full `{"document":"openapi"}` response describe both canonical definitions and playback. Commands use `visual_nerve_request` with paths that omit `/api/v1`.

1. Fetch `/diagrams/{diagramId}` to read current node UUIDs and `diagram.version`.
2. Read `GET /diagrams/{diagramId}/presentation`. An absent definition returns `{version:1,nodeIds:[],secondsPerNode:8,transitionMs:1200}`.
3. Save the desired order using `PUT /diagrams/{diagramId}/presentation` with exactly `{baseVersion,presentation}`. The definition contains `version:1`, ordered unique existing `nodeIds`, `secondsPerNode:2..600`, and `transitionMs:0..10000`. Success returns Graph; stale versions return 409. Use the latest version for the next write.
4. Open with `POST /presentation/open` and `{}` or `{diagramId}`. Play, pause, rewind, forward and close with the respective `POST /presentation/{action}` and an exact `{}` body.
5. Read `GET /presentation` for playback state. Options use `PATCH /presentation` with at least one of boolean `audio`, `subtitles` and `preload`, and no other keys.

For example:

```json
{
  "path": "/presentation/open",
  "method": "POST",
  "data": { "diagramId": "EXISTING_DIAGRAM_UUID" }
}
```

The sequence belongs to `diagram.settings.presentation` and uses the same nodes in 2D and 3D. Array positions are contiguous numbers starting at 1; the maximum is 20,000 nodes. Export and backup preserve it, imported or duplicated diagrams remap IDs, deleted nodes are removed from the sequence, and clipboard copies begin unnumbered.

All runtime mutations require write access and accepted storage, including camera movement and preloading. Playback state is transient: `{open,diagramId,status,index,total,nodeId,audio,subtitles,preload,buffered,progress,message}`. Status is `idle`, `loading`, `moving`, `playing`, `paused`, `ended` or `error`; index is zero-based or -1 for an empty sequence. The state does not replace diagram nodes or their saved geometry.

Audio and preload start disabled; subtitles start enabled. `GET /presentation/voices` returns `{defaultVoiceId,voices}` with model IDs, labels, languages, sample rates, download sizes, licenses and sources. `GET /settings/presentation-voice` reads the saved selection. PUT that path with exact `{value:"en_US-ljspeech-high"}`, `{value:"en_GB-cori-high"}` or `{value:"sv_SE-nst-medium"}` to choose a voice. The US English voice is the default. Speech generation runs locally, while first use can download model assets; explicit `POST /presentation/preload` with `{}` prepares upcoming clips. Generated speech and playback progress are not canonical graph data.

See the [complete API guide](../API.md) and [generated OpenAPI contract](openapi.yaml) for the exact schemas and errors.
