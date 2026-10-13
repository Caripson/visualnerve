# Roblox Game Builder

Visual Nerve stores a declarative Roblox game inside `Diagram.game`. The editor projects that model into ordinary diagram cards and relationships, offers a world view and an incremental rule test, and compiles it into a native Roblox place and an explicit Studio merge importer. A saved diagram remains the editable source of truth.

The supported template ID is `roblox-game-builder`. Its starter introduces jumping, checkpoints, a moving bridge, a per-player score and a finish. The advanced Crystal Island example exercises parameterized prefabs, inventory, quests, shared power, a gate, progression, timers, rounds and multiplayer. Empty and advanced variants receive fresh game and semantic identities when created.

## Canonical model and coordinates

`frontend/src/roblox/types.ts` defines the closed `GameDefinition` format with `schemaVersion: 1`. Unknown fields and executable extensions are rejected. The model contains world entities, reusable prefabs, prefab instances, variables, inventory items, quests, timers and rules. Every declared reference is validated, including disabled rules and unused prefab definitions.

An entity has a stable ID, name, kind, transform, colour, material and explicit anchored/collidable/visible/enabled settings. World positions, sizes and motion offsets use Roblox studs. Rotations use degrees. Diagram card positions use diagram pixels and never move world objects. The supported entity kinds are spawn, platform, checkpoint, hazard, collectible, door, goal, stationary NPC, zone, decoration and moving platform. Special behaviour is expressed by rules; an object name or kind alone does not award points or complete a game. The validator warns about behavioural objects without enabled rules.

Each object transforms with `CFrame.new(position) * CFrame.fromOrientation(rotation)`, using Roblox's Y-X-Z Euler convention. Internally the matrix is `R_y R_x R_z`. For a prefab instance with transform `(t_i, R_i)` and local entity `(t_e, R_e)`:

- World position is `t_i + R_i t_e`.
- World rotation is `R_i R_e`.
- A moving platform's world offset is `R_i offset_e`.
- Size stays in the entity's local axes; instances do not introduce hidden scaling.

Prefab entities and rules have local IDs. Expansion produces `instanceId/localId` references. A prefab parameter has a typed scalar default. Bindings can control entity colour, enabled/visible/collidable state, local position components, size components or movement duration. Prefab rules can read a parameter expression; expansion replaces it with the selected instance literal. Bindings and expanded world transforms must pass normal entity bounds.

IDs are unique within each collection, rather than across unrelated collections. Copying uses collection-scoped maps and independent prefab entity/rule/parameter maps. A literal, message, description, variable initial value or instance parameter value that happens to match an ID stays ordinary user data.

## Diagram projection and persistence

`document.ts` creates diagram cards for each top-level resource and causal links for typed references. Cards store `metadata.roblox = {schemaVersion: 1, kind, id}`, where `kind` is a collection name such as `entities` or `rules`. Generated relationships carry `robloxGenerated` and a typed semantic `robloxKey`. An expanded entity reference points to its instance card.

Game semantics exist once, in `Diagram.game`. Card titles and entity background colours are reconciled back to names and world colours. Layout, annotations and presentation metadata survive a model refresh. Generic operations cannot delete or redirect a managed card without semantic validation; the game commands handle resource removal and references. A game diagram cannot also contain a simulation or analytics model.

The normal graph repository saves the model in IndexedDB or encrypted workspace storage. Duplicate, template-copy and backup-collision paths remap native card/edge IDs and game IDs independently. Tests cover close/reopen, encrypted physical records, annotations, scoped reference copying, collision-safe duplication and backup merge. Build and test results are transient and do not become diagram data.

## Bounded API configuration and collections

`GET /diagrams/{diagramId}/roblox/configuration` permits Read only and returns `{diagramId,baseVersion,configuration:{schemaVersion:1,id,name,description,settings}}`, with complete saved settings and no collections. Full-game GET remains limited to 512 KiB. To reconstruct a larger saved draft, combine configuration with every page of `entities`, `rules`, `variables`, `items`, `quests`, `timers`, `prefabs` and `instances`. Pages permit up to 200 items and remain bounded to 512 KiB. Reduce page size if needed. A single oversized prefab or other entry still returns 413 at `limit=1`; reducing page size cannot split it. Native Visual Nerve diagram JSON export remains the full exchange path; successful builds also expose the raw game model through chunked `game.json`. Compare `baseVersion` from configuration and every page; discard the gathered data and restart if any differ. This works for unfinished drafts that cannot build, including drafts without an enabled spawn.

`PATCH` on the configuration route takes `{baseVersion,value:{name?,description?,settings?}}` with Read + write. Omitted fields stay unchanged and partial settings merge. Null, arrays, unknown fields and edits to `id` or `schemaVersion` reject. The complete resolved model passes canonical validation before an atomic save; success returns `{diagramId,baseVersion,summary}` with the new version and collection counts. Configuration edits use the same uncertain-write recovery as model and collection edits. See [API.md](../API.md#roblox-game-builder) and [MCP examples](MCP.md#roblox-game-builder-through-mcp).

## Rules and values

A rule contains an event, optional condition, ordered actions, cooldown, enabled setting and once-per-player setting. Events are player join, touch, interact, timer expiry, round start and round end. Conditions use matching-type comparisons, all/any groups and negation. Expressions use scalar literals, declared variables, inventory counts, quest progress/state and numeric arithmetic. There is no `eval`, dynamic Luau, arbitrary executable expression or remote asset loader.

The server emits player join once the first character's Humanoid and root are ready, after its initial spawn. This lets join rules teleport, damage or heal that character. Respawning does not emit player join again. A character replaced while waiting, or a player who leaves, cannot receive the old character's delayed settings or join actions. The browser test starts with a ready virtual actor, so its join step immediately runs the same actions.

Rules run in model order; actions run in rule order. Conditions see state produced by earlier rules and actions. A successful rule starts its cooldown. Failed conditions do not consume its once-per-player allowance. Touch and interaction impose a minimum 0.1-second per-rule/per-player debounce. Once-per-player state resets when that player leaves the current server.

Player variables, inventory and quests belong to one player. Shared variables and entity toggles affect this server's world. Variables retain their declared number/string/boolean type. Numeric variables clamp to their declared range, or +/-1e12. Intermediate arithmetic is finite and clamped; nonfinite results and runtime division by zero become zero. A statically literal zero divisor is rejected.

Inventory counts use whole nonnegative amounts and clamp between zero and the item's maximum stack. Quest states are `inactive`, `active` and `complete`. Starting an inactive quest activates it. Advancing an active quest adds whole nonnegative progress and completes it at its target. Completing an active quest sets its progress to the target. Starting a completed quest does not reset it.

Timers start through rule actions. Starting an active timer restarts its deadline; stopping removes it. A player timer fires for its owner; a shared timer runs once with no player actor, so player-dependent shared-timer instructions are rejected. Due timers run in deadline/key order and repeat timers catch up against their scheduled deadlines. Extremely large time steps are bounded to 4096 ticks and produce a visible diagnostic while overdue timers are delayed.

Starting an inactive round sets round state and emits one round-start event per current player, in join order. Ending an active round clears it and emits round-end events in that order. Repeating the same state action does nothing. Queued event chains are bounded and report a diagnostic when recursive rules reach their budget. Progress lasts for the current server session; DataStore saves, purchases, remote assets, free-form scripts and NPC pathfinding are outside format 1.

## Native compilation

`compileRobloxGame` calls strict validation with `playable: true`, requiring an enabled spawn, expands prefab parameters/transforms, and returns deterministic artifacts:

| Artifact                          | Purpose                                         |
| --------------------------------- | ----------------------------------------------- |
| `game.rbxlx`                      | Complete Roblox XML place                       |
| `game.json`                       | Raw GameDefinition data with reusable prefabs  |
| `VisualNerve.server.luau`         | Authoritative generated gameplay                |
| `VisualNerve.client.luau`         | Read-only player HUD                            |
| `VisualNerveImporter.plugin.luau` | Preview/apply importer for an existing world    |
| `README.txt`                      | Studio test, import and publishing instructions |

`game.json` contains only the game model. It is not a native Visual Nerve diagram or a complete backup, and the ordinary Import JSON workflow cannot reopen it. To reopen or move all editable work, export the complete diagram as native Visual Nerve JSON or use an encrypted workspace backup; those preserve `diagram.game`, card layout, notes and relationships together. An API developer can apply raw `game.json` to an existing game diagram through `PUT /diagrams/{id}/roblox` with `{baseVersion, game: <file contents>}` and the current write grant.

The place contains Workspace entities, ServerScriptService gameplay and a LocalScript under StarterPlayer/StarterPlayerScripts. A spawn is a real SpawnLocation. An NPC is an anchored Humanoid model with managed root, torso and head parts; interaction prompts invoke rules. Moving platforms follow the configured offset and duration using TweenService.

Join and respawn select the first currently enabled spawn in entity order. Server-set `Player.RespawnLocation` keeps Roblox's engine selection consistent when a rule toggles a spawn; the ready character is then positioned explicitly. An enabled saved checkpoint overrides the default on respawn. A disabled checkpoint falls back to the current spawn, and no enabled spawn falls back to `(0, 3, 0)`. Generated spawns have integer `Duration = 0`, so the model's health actions are not hidden behind a default spawn ForceField.

XML escapes every string. Native `AttributesSerialize` encodes stable ownership attributes using little-endian lengths and UTF-8 strings. Game data is JSON inside a delimiter-safe Luau long string and is decoded by HttpService. JSON escapes never become executable Luau string escapes. User messages and literals remain data. Native owner attributes are `VNManaged = VisualNerve/Roblox/v1`, `VNGameId`, `VNEntityId` and `VNComponent`.

The server creates a RemoteEvent solely for server-to-client HUD state. It registers no client gameplay command handler. Touch and proximity interactions resolve an actual player character, require a living humanoid and validate proximity to the entity. Rule cooldowns and finite event/action budgets prevent unbounded reward or rule-chain execution. Inventory, progression, shared state, collision, checkpoints, health and win rules execute on the server.

Gravity, walking speed, jump power, respawn delay and ambient light are applied to Roblox settings. `maxPlayers` enforces the game's server join cap. Roblox's own place server-size setting must separately be set to the same value or lower in Creator Dashboard; `Players.MaxPlayers` is read-only and is not falsely serialized as a writable setting.

## Explicit Studio merge

The importer performs no background writes. The creator installs the local plugin, clicks Preview changes, reviews generated creates/updates/removals and then clicks Apply. Applying overwrites the displayed generated objects and scripts. Other world objects, scripts and custom children remain intact. Custom children of a removed generated object are rescued into the managed folder.

All managed objects are located through owner attributes and stable IDs, rather than names. Existing compatible world objects update in place. A world class change replaces only the owned object. Generated server and HUD scripts are replaced as instances; custom children transfer to the replacements. Native NPC components are managed separately. The runtime likewise limits NPC property changes to its owned components and uses the model's managed PrimaryPart.

The importer validates before writing, rejects foreign Visual Nerve game worlds/controllers anywhere in the inspected Workspace and script trees, rejects duplicate owned worlds or IDs, requires a stopped play test and checks that Studio has not changed since the preview. Its fingerprint includes ownership, precise CFrame components, sizes, colours, relevant generated properties and current script editor buffers read with `ScriptEditorService:GetEditorSource()`. A different copied/new blueprint has a different game ID and needs a separate Studio place; two controllers must not compete over Players or Workspace settings. The importer inspects at most 50000 Studio objects and refuses an oversized inspection before writes.

Script source edits are intentionally excluded from Studio's 3D ChangeHistory undo stack. The importer therefore prepares detached replacement scripts through `ScriptEditorService:UpdateSourceAsync()` before touching the place. Its callback does not yield and returns `nil` if unexpected source or state is observed during a retry. Preview and Apply reject reentrant calls while preparation runs. After this asynchronous preparation, the importer checks the complete preview fingerprint and stopped play state again. It then records synchronous geometry, parent and child-transfer changes; existing script sources remain untouched. Cancel/Undo restores the original script instances and recorded world changes. Unused detached replacements are destroyed. This avoids relying on Source assignment limits or on source rollback that ChangeHistory does not provide.

Current Studio publishing labels are File > Publish for a new experience and File > Publish As for selecting an existing experience/place. Older Studio versions may label the latter Publish to Roblox As. The optional publisher requires both explicit browser review and a fresh exact confirmation phrase in the local bridge's foreground terminal before HTTP. A forged browser grant or MCP token alone cannot approve it; non-TTY/MCP-stdio publisher startup fails closed while Studio export remains available. Preparation, terminal approval and network phases each have a 60-second budget. See `ROBLOX_PUBLISH_PROTOCOL.md` for cancellation and unknown-outcome handling.

## Bounded rule-test API

`runRobloxPreview` uses the same pure `RobloxSimulator` as the incremental editor. The async `executeRobloxPreview` wrapper runs it in a revocable worker and checks the originating export/vault/grant authority before dispatch and before revealing its result. Workspace cleanup cancels work; late worker results cannot cross a revoked session. The service retains no completed snapshots.

The typed trace admits only join, leave, respawn, touch, interact and advance steps. It validates the entire trace before execution: player IDs, join/leave lifetime, entity and expanded prefab references, player count, step count and total time. Callers cannot inject timer or round events; those arise from game actions and advancing time. The default response is one final snapshot. Optional history includes the initial state and one snapshot per step.

This preview tests declarative instructions. It does not simulate Roblox physics, animation, contact surfaces, device input, network transport or Studio permissions. Roblox Studio remains the place to test those behaviours.

## Limits

`ROBLOX_LIMITS`, strict validation, capability discovery and the documented protocol define supported limits rather than silently dropping options.

| Limit                                           | Value                             |
| ----------------------------------------------- | --------------------------------- |
| Expanded entities / rules                       | 1000 each                         |
| Variables / items / quests / timers / prefabs   | 128 each                          |
| Prefab instances                                | 256                               |
| Parameters / bindings per prefab                | 64 / 256                          |
| Actions per rule / children per condition group | 64 / 64                           |
| Expression / condition nesting                  | 12                                |
| Owned ID / name / long text                     | 96 / 120 / 2000 characters        |
| Position / positive size component              | +/-100000 studs / 0.05–2048 studs |
| Server player cap                               | 1–100                             |
| Action / event chain budget                     | 8192 actions / 256 events         |
| Native artifact size                            | 16 MiB per artifact               |
| Direct Roblox publishing place limit            | Separate 10 MiB platform limit    |
| Rule-test players / steps / elapsed time        | 16 / 128 / 86400 seconds          |
| Rule-test workers / deadline / result           | 2 / 30 seconds / 8 MiB            |

Enabled rule actions are grouped by event. A group exceeding 8192 possible actions is rejected. Round event groups multiply their action count by the configured player cap before this check, so a valid 100-player round with 64 actions per player executes all 6400 actions. Dynamic recursion still has a runtime budget and clear diagnostic.

## Verification and primary references

Vitest tests exercise the model, numeric and semantic limits, expanded transforms, multiplayer quests and inventory, timer catch-up, recursive rules, adversarial strings, persistent native attributes, projection/copying and encrypted storage. Worker tests exercise strict preview traces, UI/API parity, concurrency, grant revocation and late results.

`npm run verify:roblox-luau` compiles actual generated server/HUD/importer artifacts with pinned official Luau 0.742 and executes generated server logic against a small independent Roblox API test surface. It also executes the generated Studio importer to check explicit preview/apply, current editor buffers, stale world/script guards, callback retries, reentrancy, failure before either staged script is ready, scoped world updates, unmanaged preservation, removal rescue and instance-swap Cancel/Undo. The test surface deliberately does not roll back Source edits. A 1000-entity/1000-rule fixture compiles and stages source exceeding 200000 bytes. This verifies the chosen API flow against test doubles, without claiming an official numeric Script.Source limit or actual Studio acceptance. CI verifies the official Ubuntu archive checksum before running this lane. The tests do not claim real Roblox Studio or physics verification.

- [Roblox client/server boundary](https://create.roblox.com/docs/scripting/security/client-server-boundary)
- [Players.MaxPlayers and settings](https://create.roblox.com/docs/reference/engine/classes/Players#MaxPlayers)
- [ChangeHistoryService recordings and rollback](https://create.roblox.com/docs/reference/engine/classes/ChangeHistoryService#FinishRecording)
- [Script editor source reads and updates](https://create.roblox.com/docs/reference/engine/classes/ScriptEditorService#UpdateSourceAsync)
- [Roblox engineer explanation of separate Source undo](https://devforum.roblox.com/t/changes-to-luasourcecontainersource-are-not-captured-by-changehistoryservice/4590702/4)
- [Publishing games and places](https://create.roblox.com/docs/production/publishing/publish-games-and-places)
- [Place Publishing API](https://create.roblox.com/docs/cloud/guides/usage-place-publishing)
- [Primary rbx-dom XML format](https://github.com/rojo-rbx/rbx-dom/blob/master/docs/xml.md)
- [Primary rbx-dom attribute format](https://github.com/rojo-rbx/rbx-dom/blob/master/docs/attributes.md)
- [Official Luau 0.742 release](https://github.com/luau-lang/luau/releases/tag/0.742)
