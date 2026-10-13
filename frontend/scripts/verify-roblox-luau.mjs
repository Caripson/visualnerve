import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(frontend, '../tmp/verification/roblox-native');
const compiler = process.env.ROBLOX_LUAU_COMPILE;
const interpreter = process.env.ROBLOX_LUAU_CLI;
if (!compiler || !interpreter)
  throw new Error('Set ROBLOX_LUAU_COMPILE and ROBLOX_LUAU_CLI to the official pinned Luau tools.');
await mkdir(output, { recursive: true });
const bundle = resolve(output, 'core.mjs');
await build({
  entryPoints: [resolve(frontend, 'src/roblox/index.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});
const core = await import(pathToFileURL(bundle).href);
const stub = await readFile(resolve(frontend, 'tests/fixtures/roblox-engine-stub.luau'), 'utf8');
function luauData(value) {
  if (Array.isArray(value)) return `{${value.map(luauData).join(',')}}`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, entry]) => `[${JSON.stringify(key)}]=${luauData(entry)}`)
      .join(',')}}`;
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'string')
    return JSON.stringify(value).replace(/\\u([\da-f]{4})/gi, '\\u{$1}');
  return String(value);
}
function run(tool, args) {
  const result = spawnSync(tool, args, {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', tool === compiler ? 'ignore' : 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${tool} failed: ${result.stderr || result.stdout}`);
  return result.stdout?.trim() ?? '';
}
const literal = (value) => ({ kind: 'literal', value });
const rule = (id, event, actions, extra = {}) => ({
  id,
  name: id,
  enabled: true,
  event,
  actions,
  cooldown: 0,
  oncePerPlayer: false,
  ...extra,
});
const adversarial = core.createRobloxStarterGame();
adversarial.name = '<tag> & Åäö 🎮 ]=] ]==]';
adversarial.rules[0].actions = [
  { kind: 'message', text: '</ProtectedString> "]===] local injected = true --\n🎮\\u2028' },
];
const multiplayer = core.createRobloxEmptyGame('100 player round');
multiplayer.settings.maxPlayers = 100;
multiplayer.entities = [core.createGameEntity('spawn', 'start')];
multiplayer.variables = [{ id: 'points', name: 'Points', scope: 'player', initial: 0 }];
multiplayer.rules = [
  rule('start', { kind: 'interact', entityId: 'start' }, [{ kind: 'startRound' }]),
  rule(
    'reward',
    { kind: 'roundStart' },
    Array.from({ length: 64 }, () => ({
      kind: 'addVariable',
      variableId: 'points',
      value: literal(1),
    })),
  ),
];
const repeating = core.createRobloxStarterGame();
repeating.items = [{ id: 'coin', name: 'Coin', maxStack: 3 }];
repeating.timers = [{ id: 'tick', name: 'Tick', scope: 'player', duration: 2, repeat: true }];
repeating.rules.push(
  rule('start-timer', { kind: 'playerJoin' }, [{ kind: 'startTimer', timerId: 'tick' }]),
);
repeating.rules.push(
  rule('tick', { kind: 'timer', timerId: 'tick' }, [
    { kind: 'addVariable', variableId: 'score', value: literal(2) },
  ]),
);
repeating.rules.push(
  rule('clamp', { kind: 'interact', entityId: 'start' }, [
    { kind: 'giveItem', itemId: 'coin', amount: literal(99.5) },
    {
      kind: 'addVariable',
      variableId: 'score',
      value: { kind: 'arithmetic', operator: '*', left: literal(1e12), right: literal(1e12) },
    },
  ]),
);
const recursive = core.createRobloxEmptyGame('Recursive rules are bounded');
recursive.entities = [core.createGameEntity('spawn', 'start')];
recursive.rules = [
  rule('go', { kind: 'playerJoin' }, [{ kind: 'startRound' }]),
  rule('end', { kind: 'roundStart' }, [{ kind: 'endRound' }]),
  rule('repeat', { kind: 'roundEnd' }, [{ kind: 'startRound' }]),
];
const spawning = core.createRobloxEmptyGame('Deterministic currently enabled spawns');
spawning.entities = [
  core.createGameEntity('spawn', 'first'),
  core.createGameEntity('spawn', 'second'),
  core.createGameEntity('checkpoint', 'saved'),
];
for (const [index, entity] of spawning.entities.entries())
  entity.transform.position.x = 10 + index * 30;
spawning.rules = [
  rule('disable-first', { kind: 'interact', entityId: 'first' }, [
    { kind: 'setEntityEnabled', entityId: 'first', value: false },
  ]),
  rule('disable-second', { kind: 'interact', entityId: 'second' }, [
    { kind: 'setEntityEnabled', entityId: 'second', value: false },
  ]),
  rule('save', { kind: 'touch', entityId: 'saved' }, [
    { kind: 'setCheckpoint', entityId: 'saved' },
  ]),
  rule('disable-checkpoint', { kind: 'interact', entityId: 'saved' }, [
    { kind: 'setEntityEnabled', entityId: 'saved', value: false },
  ]),
];
const readiness = core.createRobloxEmptyGame('Join after the first ready character');
readiness.entities = [
  core.createGameEntity('spawn', 'start'),
  core.createGameEntity('platform', 'arrival'),
];
readiness.entities[1].transform.position.x = 200;
readiness.variables = [{ id: 'joins', name: 'Joins', scope: 'player', initial: 0 }];
readiness.rules = [
  rule('ready', { kind: 'playerJoin' }, [
    { kind: 'addVariable', variableId: 'joins', value: literal(1) },
    { kind: 'teleport', entityId: 'arrival' },
    { kind: 'damage', amount: literal(40) },
    { kind: 'heal', amount: literal(5) },
  ]),
];
const explicitActions = core.createRobloxEmptyGame('Typed assignment, completion and timer stop');
explicitActions.entities = [
  core.createGameEntity('spawn', 'start'),
  core.createGameEntity('platform', 'control'),
];
explicitActions.variables = [
  { id: 'points', name: 'Points', scope: 'player', initial: 0, min: 0, max: 10 },
  { id: 'label', name: 'Label', scope: 'player', initial: '' },
  { id: 'switch', name: 'Switch', scope: 'shared', initial: false },
  { id: 'ticks', name: 'Ticks', scope: 'player', initial: 0 },
  { id: 'shared-ticks', name: 'Shared ticks', scope: 'shared', initial: 0 },
];
explicitActions.quests = [{ id: 'objective', name: 'Objective', description: '', target: 5 }];
explicitActions.timers = [
  { id: 'clock', name: 'Clock', scope: 'player', duration: 1, repeat: true },
  { id: 'shared-clock', name: 'Shared clock', scope: 'shared', duration: 1, repeat: true },
];
explicitActions.rules = [
  rule('prepare', { kind: 'playerJoin' }, [
    { kind: 'startQuest', questId: 'objective' },
    { kind: 'startTimer', timerId: 'clock' },
    { kind: 'startTimer', timerId: 'shared-clock' },
  ]),
  rule('player-tick', { kind: 'timer', timerId: 'clock' }, [
    { kind: 'addVariable', variableId: 'ticks', value: literal(1) },
  ]),
  rule('shared-tick', { kind: 'timer', timerId: 'shared-clock' }, [
    { kind: 'addVariable', variableId: 'shared-ticks', value: literal(1) },
  ]),
  rule('control', { kind: 'interact', entityId: 'control' }, [
    { kind: 'setVariable', variableId: 'points', value: literal(99) },
    { kind: 'setVariable', variableId: 'label', value: literal('Approved') },
    { kind: 'setVariable', variableId: 'switch', value: literal(true) },
    { kind: 'completeQuest', questId: 'objective' },
    { kind: 'startQuest', questId: 'objective' },
    { kind: 'stopTimer', timerId: 'clock' },
    { kind: 'stopTimer', timerId: 'shared-clock' },
  ]),
];
const fixtures = [
  [
    'starter',
    core.createRobloxStarterGame(),
    `join(1); touch(1, "star"); touch(1, "star"); assert(state(1).variables.score == 10); touch(1, "checkpoint"); touch(1, "lava"); assert(fixtureActors[1].Character:FindFirstChild("Humanoid").Health == 0); print("PASS starter")`,
  ],
  [
    'adventure',
    core.createRobloxAdventureGame(),
    `join(1); join(2); interact(1, "power-switch", true); assert(state(1).shared.power == 0, "Distant interaction must fail"); touch(1, "first-crystal/crystal", true); assert(state(1).inventory.crystal == 0, "Distant touch must fail"); for _, id in ipairs({ "first-crystal/crystal", "second-crystal/crystal", "third-crystal/crystal" }) do touch(1, id) end; touch(1, "third-crystal/crystal"); assert(state(1).inventory.crystal == 3 and state(1).variables.score == 60); assert(state(2).inventory.crystal == 0); assert(state(1).quests["find-crystals"].state == "complete"); interact(2, "power-switch"); assert(state(1).shared.power == 1); interact(1, "crystal-gate"); assert(state(1).inventory.crystal == 0); assert(fixtureParts["crystal-gate"].CanCollide == false and fixtureParts["crystal-gate"].Transparency == 1); touch(1, "treasure"); assert(state(1).variables.level == 2 and state(1).variables.score == 160); interact(2, "guide"); assert(state(1).roundActive and state(2).roundActive); advance(120); assert(not state(1).roundActive); assert(#fixtureWarnings == 0); print("PASS adventure")`,
  ],
  [
    'hostile-text',
    adversarial,
    `join(1); assert(state(1).name == fixtureDefinition.name); assert(injected == nil); print("PASS hostile-text")`,
  ],
  [
    '100-player-round',
    multiplayer,
    `for i = 1, 100 do join(i) end; interact(1, "start"); for i = 1, 100 do assert(state(i).variables.points == 64, "Round starved a player") end; assert(#fixtureWarnings == 0); join(101); assert(fixtureActors[101].Kicked); print("PASS 100-player-round")`,
  ],
  [
    'timer-and-clamp',
    repeating,
    `join(1); advance(6); assert(state(1).variables.score == 6, "Repeating timer must catch up deterministically"); interact(1, "start"); assert(state(1).inventory.coin == 3 and state(1).variables.score == 1000000); assert(#fixtureWarnings == 0); print("PASS timer-and-clamp")`,
  ],
  [
    'recursive-budget',
    recursive,
    `join(1); assert(#fixtureWarnings > 0); assert(string.find(fixtureWarnings[1], "safety limit")); print("PASS recursive-budget")`,
  ],
  [
    'current-spawn',
    spawning,
    `
local first = join(1); assert(first.RespawnLocation == fixtureParts.first); assert(first.Character:FindFirstChild("HumanoidRootPart").Position.X == 10)
touch(1, "saved"); interact(1, "first"); assert(not fixtureParts.first.Enabled); assert(first.RespawnLocation == fixtureParts.second)
local second = join(2); assert(second.RespawnLocation == fixtureParts.second); assert(second.Character:FindFirstChild("HumanoidRootPart").Position.X == 40)
assert(attachCharacter(1):FindFirstChild("HumanoidRootPart").Position.X == 70, "Enabled checkpoint must override default spawn")
interact(1, "saved"); assert(attachCharacter(1):FindFirstChild("HumanoidRootPart").Position.X == 40, "Disabled checkpoint must fall back to current spawn")
interact(1, "second"); assert(not fixtureParts.second.Enabled); assert(first.RespawnLocation == nil and second.RespawnLocation == nil)
local respawned = attachCharacter(1):FindFirstChild("HumanoidRootPart"); assert(respawned.Position.X == 0 and respawned.Position.Y == 3, "No enabled spawn has an explicit fallback")
local third = join(3); assert(third.Character:FindFirstChild("HumanoidRootPart").Position.Y == 3); assert(#fixtureWarnings == 0); print("PASS current-spawn")`,
  ],
  [
    'first-ready-character',
    readiness,
    `
join(1, true); assert(fixtureSnapshots["1"] == nil, "Join actions must wait for the initial character")
local initial = attachCharacter(1); assert(state(1).variables.joins == 1); assert(initial:FindFirstChild("Humanoid").Health == 65); assert(initial:FindFirstChild("HumanoidRootPart").Position.X == 200, "Join teleport must run after default spawn")
local respawn = attachCharacter(1); assert(state(1).variables.joins == 1); assert(respawn:FindFirstChild("Humanoid").Health == 100); assert(respawn:FindFirstChild("HumanoidRootPart").Position.X == 0, "Respawn must not rerun playerJoin")
join(2, true); fixtureBeforeWait = function() local player = fixtureActors[2]; Players.PlayerRemoving:Fire(player); player.Parent = nil end
local departed = attachCharacter(2); assert(departed:FindFirstChild("Humanoid").WalkSpeed == nil); assert(fixtureSnapshots["2"] == nil, "A departed player must not receive delayed join actions")
join(3, true); fixtureBeforeWait = function() attachCharacter(3) end
local replaced = attachCharacter(3); local current = fixtureActors[3].Character
assert(replaced ~= current); assert(replaced:FindFirstChild("Humanoid").WalkSpeed == nil and replaced:FindFirstChild("Humanoid").Health == 100, "A replaced character must not be configured late")
assert(current:FindFirstChild("Humanoid").Health == 65 and current:FindFirstChild("HumanoidRootPart").Position.X == 200); assert(state(3).variables.joins == 1); assert(#fixtureWarnings == 0); print("PASS first-ready-character")`,
  ],
  [
    'assignment-quest-stop',
    explicitActions,
    `
join(1); join(2); advance(2)
assert(state(1).variables.ticks == 2 and state(2).variables.ticks == 2 and state(1).shared["shared-ticks"] == 2)
interact(1, "control")
assert(state(1).variables.points == 10 and state(1).variables.label == "Approved" and state(2).shared.switch == true, "Typed setVariable must assign and clamp within scope")
assert(state(1).quests.objective.state == "complete" and state(1).quests.objective.progress == 5, "Explicit completion must reach the target and not restart")
assert(state(2).variables.points == 0 and state(2).variables.label == "" and state(2).quests.objective.state == "active", "Player assignment/completion must stay private")
advance(3)
assert(state(1).variables.ticks == 2 and state(2).variables.ticks == 5, "Stopping a player timer must leave the other actor's timer running")
assert(state(1).shared["shared-ticks"] == 2 and state(2).shared["shared-ticks"] == 2, "Stopping a shared timer must stop all future shared ticks")
assert(#fixtureWarnings == 0); print("PASS assignment-quest-stop")`,
  ],
];
let compiled = 0;
for (const [name, definition, assertions] of fixtures) {
  const artifact = core.compileRobloxGame(definition);
  for (const [kind, source] of [
    ['server', artifact.serverLuau],
    ['client', artifact.clientLuau],
    ['plugin', artifact.pluginLuau],
  ]) {
    const path = resolve(output, `${name}.${kind}.luau`);
    await writeFile(path, source);
    run(compiler, ['--null', path]);
    compiled++;
  }
  const harness = stub
    .replace('FIXTURE_DEFINITION', luauData(artifact.game))
    .replace('-- GENERATED_RUNTIME', artifact.serverLuau)
    .replace('-- FIXTURE_ASSERTIONS', assertions);
  const path = resolve(output, `${name}.runtime.luau`);
  await writeFile(path, harness);
  run(compiler, ['--null', path]);
  console.log(run(interpreter, [path]));
}
const studioStub = await readFile(
  resolve(frontend, 'tests/fixtures/roblox-studio-stub.luau'),
  'utf8',
);
const pluginBuild = core.compileRobloxGame(core.createRobloxAdventureGame());
const studioAssertions = `
local floor = fixtureParts.island
local initialPosition = floor.Position
ui("Apply these changes").MouseButton1Click:Fire(); assert(floor.Position == initialPosition, "Apply without preview must do nothing")
local foreignContainer = instance("Model"); foreignContainer.Name = "Other level"; foreignContainer.Parent = workspace
local foreignWorld = instance("Folder"); foreignWorld.Name = "Other generated world"; foreignWorld:SetAttribute("VNManaged", "VisualNerve/Roblox/v1"); foreignWorld:SetAttribute("VNGameId", "different-game"); foreignWorld.Parent = foreignContainer
ui("Preview changes").MouseButton1Click:Fire(); assert(not ui("Apply these changes").Active); assert(string.find(statusText(), "Another Visual Nerve game")); ui("Apply these changes").MouseButton1Click:Fire(); assert(floor.Position == initialPosition, "Foreign game rejection must not mutate anything"); foreignWorld.Parent = nil
local foreignScripts = instance("Folder"); foreignScripts.Parent = ServerScriptService
local foreignController = instance("Script"); foreignController:SetAttribute("VNManaged", "VisualNerve/Roblox/v1"); foreignController:SetAttribute("VNGameId", "different-game"); foreignController:SetAttribute("VNComponent", "server"); foreignController.Parent = foreignScripts
ui("Preview changes").MouseButton1Click:Fire(); assert(not ui("Apply these changes").Active); assert(string.find(statusText(), "Another Visual Nerve game")); foreignController.Parent = nil
ui("Preview changes").MouseButton1Click:Fire(); assert(ui("Apply these changes").Active)
floor.CFrame = frame(111, 222, 333)
ui("Apply these changes").MouseButton1Click:Fire(); assert(string.find(statusText(), "Studio changed after your preview")); assert(floor.Position.X == 111)
ui("Preview changes").MouseButton1Click:Fire()
local originalEntityId = floor:GetAttribute("VNEntityId")
floor:SetAttribute("VNEntityId", "changed-after-preview")
ui("Apply these changes").MouseButton1Click:Fire(); assert(string.find(statusText(), "Studio changed after your preview"), "Ownership edits must invalidate the preview")
floor:SetAttribute("VNEntityId", originalEntityId)
ui("Preview changes").MouseButton1Click:Fire()
local originalScriptName = oldServer.Name
oldServer.Name = "Changed script name after preview"
ui("Apply these changes").MouseButton1Click:Fire(); assert(string.find(statusText(), "Studio changed after your preview"), "Owned script names must be fingerprinted")
oldServer.Name = originalScriptName
ui("Preview changes").MouseButton1Click:Fire()
local originalDisabled = oldServer.Disabled
oldServer.Disabled = not originalDisabled
ui("Apply these changes").MouseButton1Click:Fire(); assert(string.find(statusText(), "Studio changed after your preview"), "Owned script Disabled must be fingerprinted")
oldServer.Disabled = originalDisabled
ui("Preview changes").MouseButton1Click:Fire()
oldServer:SetAttribute("VNEntityId", "changed-script-identity")
ui("Apply these changes").MouseButton1Click:Fire(); assert(string.find(statusText(), "Studio changed after your preview"), "Owned script identity metadata must be fingerprinted")
oldServer:SetAttribute("VNEntityId", nil)
ui("Preview changes").MouseButton1Click:Fire()
local function originalScriptsRemain()
  assert(oldServer.Parent == ServerScriptService and oldServer.Source == "OLD SERVER")
  assert(oldClient.Parent == StarterPlayer.StarterPlayerScripts and oldClient.Source == "OLD CLIENT")
  assert(scriptDetail.Parent == oldServer)
end
local function stagedCleaned(since)
  for index = since + 1, #fixtureStaged do assert(fixtureStaged[index].Parent == nil and fixtureStaged[index].Destroyed, "Unused staged script must be destroyed") end
end
-- Verify this test surface does not pretend Source belongs to the 3D Undo stack.
local sourceRecord = ChangeHistoryService:TryBeginRecording()
oldServer.Source = "SOURCE DOES NOT UNDO"
ChangeHistoryService:FinishRecording(sourceRecord, "Cancel")
assert(oldServer.Source == "SOURCE DOES NOT UNDO"); oldServer.Source = "OLD SERVER"
for failure = 1, 2 do
  ui("Preview changes").MouseButton1Click:Fire()
  local since = #fixtureStaged; fixtureRejectStageAt = fixtureStageCount + failure
  ui("Apply these changes").MouseButton1Click:Fire(); fixtureRejectStageAt = nil
  assert(string.find(statusText(), "Import stopped")); assert(floor.Position.X == 111 and obsolete.Parent == world and rescued.Parent == obsolete, "Script preparation must precede every world write")
  originalScriptsRemain(); stagedCleaned(since); assert(fixtureRecording == nil)
end
ui("Preview changes").MouseButton1Click:Fire()
fixtureEditorSources[oldServer] = "UNSAVED EDITOR BUFFER"
local beforeEditorConflict = fixtureStageCount
ui("Apply these changes").MouseButton1Click:Fire()
assert(string.find(statusText(), "Studio changed after your preview") and fixtureStageCount == beforeEditorConflict, "Fingerprint must read unsaved editor contents, not only Source")
fixtureEditorSources[oldServer] = nil; originalScriptsRemain()
ui("Preview changes").MouseButton1Click:Fire()
local beforeRetryConflict = #fixtureStaged
fixtureStageHook = function() fixtureStageHook = nil; fixtureRetrySource = "CHANGED DURING CALLBACK RETRY" end
ui("Apply these changes").MouseButton1Click:Fire()
assert(string.find(statusText(), "Script preparation changed")); assert(floor.Position.X == 111); originalScriptsRemain(); stagedCleaned(beforeRetryConflict)
ui("Preview changes").MouseButton1Click:Fire()
local beforeWorldConflict = #fixtureStaged
fixtureStageHook = function() fixtureStageHook = nil; floor.CFrame = frame(112, 222, 333) end
ui("Apply these changes").MouseButton1Click:Fire()
assert(string.find(statusText(), "Studio changed after your preview") and floor.Position.X == 112, "World edits while script preparation yields must be preserved and reject Apply")
originalScriptsRemain(); stagedCleaned(beforeWorldConflict)
floor.CFrame = frame(111, 222, 333)
ui("Preview changes").MouseButton1Click:Fire()
local beforeIdentityConflict = #fixtureStaged; local externallyReplaced = nil
fixtureStageHook = function()
  fixtureStageHook = nil; externallyReplaced = instance("Script")
  externallyReplaced.Name = oldServer.Name; externallyReplaced.Disabled = oldServer.Disabled; externallyReplaced.Source = oldServer.Source
  managed(externallyReplaced, nil, "server"); oldServer.Parent = nil; externallyReplaced.Parent = ServerScriptService
end
ui("Apply these changes").MouseButton1Click:Fire()
assert(string.find(statusText(), "A generated script was replaced"), "Identical script text/properties must not hide an instance replacement during preparation")
assert(externallyReplaced.Parent == ServerScriptService and oldServer.Source == "OLD SERVER" and floor.Position.X == 111)
stagedCleaned(beforeIdentityConflict); externallyReplaced:Destroy(); oldServer.Parent = ServerScriptService; originalScriptsRemain()
ui("Preview changes").MouseButton1Click:Fire()
local beforeCommitFailure = #fixtureStaged; fixtureRejectCommit = true
ui("Apply these changes").MouseButton1Click:Fire(); fixtureRejectCommit = false
assert(string.find(statusText(), "Import stopped")); assert(floor.Position.X == 111 and obsolete.Parent == world and rescued.Parent == obsolete, "Cancel must restore recorded world and instance changes")
originalScriptsRemain(); stagedCleaned(beforeCommitFailure)
ui("Preview changes").MouseButton1Click:Fire()
local beforeSuccess, beforeCallbacks = fixtureStageCount, fixtureCallbackCount
fixtureStageHook = function()
  fixtureStageHook = nil
  ui("Preview changes").MouseButton1Click:Fire(); ui("Apply these changes").MouseButton1Click:Fire()
  fixtureRetrySource = "" -- An unchanged callback retry is safe and deterministic.
end
ui("Apply these changes").MouseButton1Click:Fire()
assert(fixtureStageCount == beforeSuccess + 2 and fixtureCallbackCount == beforeCallbacks + 3, "Busy controls must reject reentrant Preview/Apply while permitting a safe callback retry")
assert(string.find(statusText(), "Applied!")); assert(fixtureParts.island == floor and floor.Position.X == 45, "Existing owned world identity must be updated in place")
assert(custom.Parent == floor, "Unmanaged detail must stay with its object")
assert(obsolete.Parent == nil and rescued.Parent == world, "Deleted owned block must rescue unmanaged children")
assert(unmanagedScript.Parent == ServerScriptService and unmanagedScript.Source == "KEEP SOURCE")
local replacementServer = fixtureStaged[#fixtureStaged - 1]; local replacementClient = fixtureStaged[#fixtureStaged]
assert(replacementServer.Parent == ServerScriptService and replacementServer ~= oldServer and string.find(replacementServer.Source, "Gameplay is authoritative"))
assert(replacementClient.Parent == StarterPlayer.StarterPlayerScripts and replacementClient ~= oldClient)
assert(oldServer.Parent == nil and oldServer.Source == "OLD SERVER" and oldClient.Parent == nil and oldClient.Source == "OLD CLIENT", "Existing Source must never be overwritten")
assert(scriptDetail.Parent == replacementServer and world:GetAttribute("VNGameId") == fixtureDefinition.id)
ChangeHistoryService:Undo()
assert(floor.Position.X == 111 and obsolete.Parent == world and rescued.Parent == obsolete)
assert(replacementServer.Parent == nil and replacementClient.Parent == nil); originalScriptsRemain()
print("PASS explicit Studio merge, stale-preview guard, unmanaged preservation and rollback")
`;
const studioHarness = stub
  .replace('FIXTURE_DEFINITION', luauData(pluginBuild.game))
  .replace('-- GENERATED_RUNTIME', studioStub + '\n' + pluginBuild.pluginLuau)
  .replace('-- FIXTURE_ASSERTIONS', studioAssertions);
const studioPath = resolve(output, 'studio-merge.runtime.luau');
await writeFile(studioPath, studioHarness);
run(compiler, ['--null', studioPath]);
console.log(run(interpreter, [studioPath]));
const large = core.createRobloxEmptyGame('Large valid script staging');
large.entities = Array.from({ length: 1000 }, (_, index) =>
  core.createGameEntity(index === 0 ? 'spawn' : 'platform', `entity-${index}`),
);
large.rules = large.entities.map((entity, index) =>
  rule(`rule-${index}`, { kind: 'touch', entityId: entity.id }, [
    { kind: 'message', text: 'x'.repeat(1800) },
  ]),
);
const largeBuild = core.compileRobloxGame(large);
for (const [kind, source] of [
  ['server', largeBuild.serverLuau],
  ['client', largeBuild.clientLuau],
  ['plugin', largeBuild.pluginLuau],
]) {
  const path = resolve(output, `large.${kind}.luau`);
  await writeFile(path, source);
  run(compiler, ['--null', path]);
  compiled++;
}
const largeAssertions = `
assert(#fixtureDefinition.entities == 1000 and #fixtureDefinition.rules == 1000 and #serverSource > 200000)
ui("Preview changes").MouseButton1Click:Fire(); ui("Apply these changes").MouseButton1Click:Fire()
assert(string.find(statusText(), "Applied!")); assert(fixtureStageCount == 2)
local replacement = fixtureStaged[1]
assert(#replacement.Source > 200000 and replacement.Parent == ServerScriptService, "Large scripts must use the staged editor API, not direct Source assignment")
assert(oldServer.Parent == nil and oldServer.Source == "OLD SERVER" and scriptDetail.Parent == replacement)
ChangeHistoryService:Undo()
assert(oldServer.Parent == ServerScriptService and oldServer.Source == "OLD SERVER" and scriptDetail.Parent == oldServer)
assert(replacement.Parent == nil); print("PASS 1000-object/1000-rule large source staging and instance Undo")
`;
const largeHarness = stub
  .replace('FIXTURE_DEFINITION', luauData(largeBuild.game))
  .replace('-- GENERATED_RUNTIME', studioStub + '\n' + largeBuild.pluginLuau)
  .replace('-- FIXTURE_ASSERTIONS', largeAssertions);
const largePath = resolve(output, 'large-studio-merge.runtime.luau');
await writeFile(largePath, largeHarness);
run(compiler, ['--null', largePath]);
console.log(run(interpreter, [largePath]));
console.log(
  `Compiled ${compiled} generated server/HUD/importer artifacts and ran ${fixtures.length} native Luau semantic fixtures plus 2 Studio merge fixtures. Roblox API stubs do not verify real Studio or physics.`,
);
