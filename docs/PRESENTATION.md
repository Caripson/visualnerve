# Diagram player

Open **Player**, number the objects or choose **Storyboard scenes**, then select
**Play**. The camera follows the same diagram in 2D or 3D. **Pause**, **Rewind**
and **Forward** control the walkthrough; **Order** edits its saved sequence.

Use **Minimize player** to leave more room for the diagram while playback
continues. **Expand player** restores the full controls. The player opens expanded
on desktop and minimized on phones and short landscape screens. Minimizing or
expanding does not change audio, subtitles or playback status.

With **Subtitles** enabled and the player minimized, narration appears as separate
video-style captions over the diagram, in both 2D and 3D. Long descriptions are
split into two-line pages across the step's playback time; Pause freezes the cue.
Expand the player to read the complete description. Captions use the configured
step duration, extended by narration duration when audio is enabled; they do not
use word-level speech timestamps. Turn **Subtitles** off to hide them. **Audio**
uses the selected local English or Swedish voice; Alan is the default. **Preload** prepares upcoming
narration and shows progress. Voice models may download on first use; descriptions
and speech generation stay local.

**Export video** records the numbered sequence or storyboard with its audio and
subtitle options. The live player's expanded/minimized state does not affect the
exported video. The saved diagram keeps its sequence and geometry; player panel
state is temporary and excluded from exports and backups.

The UI, local API and MCP share this panel state. `GET /presentation` returns
`minimized`; `PATCH /presentation` accepts `{ "minimized": true }` or
`{ "minimized": false }` alongside boolean `audio`, `subtitles` and `preload`.
GET permits Read only; PATCH requires accepted local storage and Read + write.
See [API contracts](../API.md#numbered-diagram-presentations),
[MCP requests](MCP.md) and [local speech](SPEECH.md) for details.
