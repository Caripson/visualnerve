import { expandGameDefinition, gameRotationMatrix, rotateGameVector } from './expand';
import { ROBLOX_CLIENT_RUNTIME } from './runtime-client';
import { ROBLOX_SERVER_RUNTIME } from './runtime-server';
import { ROBLOX_STUDIO_PLUGIN } from './studio-plugin';
import {
  ROBLOX_LIMITS,
  type CompiledGame,
  type GameDefinition,
  type GameEntity,
  type GameVector,
  type RobloxArtifact,
  type RobloxBuild,
} from './types';
import { RobloxValidationError, validateGameDefinition } from './validate';

export function escapeRobloxXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
/** JSON uses JSON escapes inside a Luau long string; no JSON escape is interpreted as Luau. */
export function luauLongString(value: string): string {
  let delimiter = '=';
  while (value.includes(`]${delimiter}]`)) delimiter += '=';
  return `[${delimiter}[${value}]${delimiter}]`;
}
function property(type: string, name: string, value: string | number | boolean) {
  return `<${type} name="${name}">${typeof value === 'string' ? escapeRobloxXml(value) : value}</${type}>`;
}
function vectorProperty(name: string, vector: GameVector) {
  return `<Vector3 name="${name}"><X>${vector.x}</X><Y>${vector.y}</Y><Z>${vector.z}</Z></Vector3>`;
}
function frameProperty(position: GameVector, rotation: GameVector) {
  const matrix = gameRotationMatrix(rotation);
  return `<CoordinateFrame name="CFrame"><X>${position.x}</X><Y>${position.y}</Y><Z>${position.z}</Z>${matrix.map((value, index) => `<R${Math.floor(index / 3)}${index % 3}>${Math.abs(value) < 1e-14 ? 0 : value}</R${Math.floor(index / 3)}${index % 3}>`).join('')}</CoordinateFrame>`;
}
function base64(bytes: number[]): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index],
      b = bytes[index + 1] ?? 0,
      c = bytes[index + 2] ?? 0;
    output +=
      alphabet[a >>> 2] +
      alphabet[((a & 3) << 4) | (b >>> 4)] +
      (index + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >>> 6)] : '=') +
      (index + 2 < bytes.length ? alphabet[c & 63] : '=');
  }
  return output;
}
/** AttributesSerialize string encoding documented by the primary rbx-dom project:
 * https://github.com/rojo-rbx/rbx-dom/blob/master/docs/attributes.md */
export function serializeRobloxAttributes(attributes: Record<string, string>): string {
  const bytes: number[] = [],
    encoder = new TextEncoder();
  const u32 = (value: number) => {
    bytes.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  };
  const string = (value: string) => {
    const data = encoder.encode(value);
    u32(data.length);
    for (const byte of data) bytes.push(byte);
  };
  const keys = Object.keys(attributes).sort();
  u32(keys.length);
  for (const key of keys) {
    string(key);
    bytes.push(2);
    string(attributes[key]);
  }
  return property('BinaryString', 'AttributesSerialize', base64(bytes));
}
const materialNumbers = {
  Plastic: 256,
  SmoothPlastic: 272,
  Neon: 288,
  Wood: 512,
  Metal: 1088,
  Glass: 1568,
  Grass: 1280,
  Concrete: 816,
};
function ownedAttributes(gameId: string, entityId?: string, component?: string) {
  return serializeRobloxAttributes({
    VNManaged: 'VisualNerve/Roblox/v1',
    VNGameId: gameId,
    ...(entityId ? { VNEntityId: entityId } : {}),
    ...(component ? { VNComponent: component } : {}),
  });
}
function makePlaceXml(game: CompiledGame, serverSource: string, clientSource: string): string {
  let sequence = 0;
  const item = (className: string, properties: string, children = '', ref?: string) =>
    `<Item class="${className}" referent="${ref ?? `VN${++sequence}`}"><Properties>${properties}</Properties>${children}</Item>`;
  const partProperties = (
    entity: GameEntity,
    name = entity.name,
    component?: string,
    size = entity.transform.size,
    position = entity.transform.position,
  ) => {
    const color = Number.parseInt(entity.color.slice(1), 16) + 0xff000000;
    const transparent =
      !entity.enabled ||
      !entity.visible ||
      entity.kind === 'zone' ||
      component === 'HumanoidRootPart';
    return (
      property('string', 'Name', name) +
      ownedAttributes(game.id, component ? undefined : entity.id, component) +
      vectorProperty('size', size) +
      frameProperty(position, entity.transform.rotation) +
      property('bool', 'Anchored', entity.anchored) +
      property('bool', 'CanCollide', entity.enabled && entity.collidable) +
      property('bool', 'CanTouch', entity.enabled) +
      property('float', 'Transparency', transparent ? 1 : 0) +
      property('Color3uint8', 'Color3uint8', color) +
      property('token', 'Material', materialNumbers[entity.material]) +
      property('token', 'TopSurface', 0) +
      property('token', 'BottomSurface', 0)
    );
  };
  const worldEntities = game.entities
    .map((entity) => {
      if (entity.kind !== 'npc')
        return item(
          entity.kind === 'spawn' ? 'SpawnLocation' : 'Part',
          partProperties(entity) +
            (entity.kind === 'spawn'
              ? property('bool', 'Neutral', true) +
                property('bool', 'Enabled', entity.enabled) +
                property('int', 'Duration', 0)
              : ''),
        );
      const rootRef = `VN${++sequence}`;
      const offset = rotateGameVector(
        { x: 0, y: entity.transform.size.y * 0.5, z: 0 },
        entity.transform.rotation,
      );
      const headPosition = {
        x: entity.transform.position.x + offset.x,
        y: entity.transform.position.y + offset.y,
        z: entity.transform.position.z + offset.z,
      };
      const root = item(
        'Part',
        partProperties(entity, 'HumanoidRootPart', 'HumanoidRootPart'),
        '',
        rootRef,
      );
      const torso = item(
        'Part',
        partProperties(entity, 'Torso', 'Torso', {
          x: entity.transform.size.x,
          y: entity.transform.size.y * 0.65,
          z: entity.transform.size.z,
        }),
      );
      const head = item(
        'Part',
        partProperties(
          entity,
          'Head',
          'Head',
          {
            x: entity.transform.size.x * 0.65,
            y: entity.transform.size.y * 0.35,
            z: entity.transform.size.z * 0.8,
          },
          headPosition,
        ),
      );
      const humanoid = item(
        'Humanoid',
        property('string', 'Name', 'Humanoid') +
          ownedAttributes(game.id, undefined, 'Humanoid') +
          property('string', 'DisplayName', entity.name) +
          property('bool', 'RequiresNeck', false),
      );
      return item(
        'Model',
        property('string', 'Name', entity.name) +
          ownedAttributes(game.id, entity.id) +
          property('Ref', 'PrimaryPart', rootRef),
        root + torso + head + humanoid,
      );
    })
    .join('');
  const world = item(
    'Folder',
    property('string', 'Name', `VisualNerve_${game.id}`) + ownedAttributes(game.id),
    worldEntities,
  );
  const server = item(
    'Script',
    property('string', 'Name', `VisualNerve_server_${game.id}`) +
      ownedAttributes(game.id, undefined, 'server') +
      property('bool', 'Disabled', false) +
      property('ProtectedString', 'Source', serverSource),
  );
  const client = item(
    'LocalScript',
    property('string', 'Name', `VisualNerve_client_${game.id}`) +
      ownedAttributes(game.id, undefined, 'client') +
      property('bool', 'Disabled', false) +
      property('ProtectedString', 'Source', clientSource),
  );
  const workspace = item(
    'Workspace',
    property('string', 'Name', 'Workspace') + property('float', 'Gravity', game.settings.gravity),
    world,
  );
  const servers = item(
    'ServerScriptService',
    property('string', 'Name', 'ServerScriptService'),
    server,
  );
  const starters = item(
    'StarterPlayer',
    property('string', 'Name', 'StarterPlayer'),
    item('StarterPlayerScripts', property('string', 'Name', 'StarterPlayerScripts'), client),
  );
  const players = item(
    'Players',
    property('string', 'Name', 'Players') +
      property('float', 'RespawnTime', game.settings.respawnSeconds),
  );
  return `<?xml version="1.0" encoding="utf-8"?><roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="4"><External>null</External><External>nil</External>${workspace}${servers}${starters}${players}</roblox>`;
}

export function compileRobloxGame(input: GameDefinition): RobloxBuild {
  const validation = validateGameDefinition(input, { playable: true });
  if (!validation.valid) throw new RobloxValidationError(validation.diagnostics);
  const game = expandGameDefinition(input);
  const definitionJson = JSON.stringify(game);
  const serverLuau = `-- Generated by Visual Nerve. Gameplay is authoritative on the server.\nlocal definition = game:GetService("HttpService"):JSONDecode(${luauLongString(definitionJson)})\n${ROBLOX_SERVER_RUNTIME}`;
  const clientLuau = `-- Generated read-only HUD.\nlocal gameId = game:GetService("HttpService"):JSONDecode(${luauLongString(JSON.stringify(game.id))})\n${ROBLOX_CLIENT_RUNTIME}`;
  const pluginLuau = `-- Install this trusted local importer as a Roblox Studio plugin. It never runs an import in the background.\nlocal definition = game:GetService("HttpService"):JSONDecode(${luauLongString(definitionJson)})\nlocal serverSource = ${luauLongString(serverLuau)}\nlocal clientSource = ${luauLongString(clientLuau)}\n${ROBLOX_STUDIO_PLUGIN}`;
  const placeXml = makePlaceXml(game, serverLuau, clientLuau);
  const readme = `${game.name}\n\nYour game is ready for Roblox Studio.\n\nFIRST GAME\n1. Install Roblox Studio from https://create.roblox.com/\n2. Choose File > Open from File and open game.rbxlx.\n3. Click Play. Walk, jump, use prompts, collect items and check the HUD.\n4. Use Studio Test > Server & Clients with two players to check multiplayer.\n5. Save a local backup. Use File > Publish for a new experience, or File > Publish As to choose an existing experience/place (older Studio versions call this Publish to Roblox As).\n6. Keep it private while you test. Roblox controls who may publish publicly.\n\nUPDATE AN EXISTING WORLD\nThe importer updates only objects tagged for this game. A place can contain one Visual Nerve game controller; use a separate Studio place for a different blueprint.\nIn a spare Studio place, insert a Script, paste VisualNerveImporter.plugin.luau, right-click it and choose Save as Local Plugin. Remove that temporary Script.\nOpen the place to update. Click Visual Nerve > Import game > Preview changes. Read the list. Click Apply these changes when ready. Studio Undo can restore the previous version.\nGenerated world objects update in place where their class still matches. Apply replaces the generated server and HUD script objects with prepared new copies and transfers their custom children; existing script source is never edited in place. Other objects and custom children are preserved. Studio Undo restores the old script objects and recorded world changes.\n\nHOW THIS GAME WORKS\nWorld positions and sizes use Roblox studs. Rotations use degrees (Y-X-Z). Prefabs expand to stable instance/local IDs.\nRules run in list order. Conditions read current state. Actions run in order. Touch and interact have a minimum 0.1-second debounce per rule and player. Once-per-player resets when that player leaves this server.\nPlayer variables, inventory and quests belong to each player. Shared variables and entity toggles affect everyone in this server.\nQuest states: inactive, active, complete. Progress automatically completes a quest at its target. Starting a completed quest does not reset it.\nTimers start only through a rule action; starting an active timer restarts it. Shared timers have no individual player. Round start/end events run once for each player currently in the server.\nNumber calculations clamp to finite +/-1e12. Division by a runtime zero returns zero. Inventory uses whole nonnegative counts. Rule chains stop after 8192 actions or 256 events.\nThe browser rule test checks these instructions; Roblox Studio tests physics, movement, input and multiplayer.\nNPCs are stationary Humanoid characters with interaction prompts; this version has no NPC pathfinding.\nProgress lasts for the current server session. This version does not provide permanent DataStore saves, purchases, remote assets or custom executable scripts.\n\nSERVER SIZE\nThis game allows ${game.settings.maxPlayers} players before its server join-cap rejects more. Set the Roblox Creator Dashboard place server size to the same number or lower; Roblox's platform server-size setting is separate.\n\nFILES\ngame.rbxlx: complete native Roblox place.\ngame.json: raw GameDefinition v1 data with reusable prefabs, intended for developers. This is not a complete diagram backup and cannot be reopened with Import JSON.\nTo reopen or move all your editable work, keep the saved diagram and use Visual Nerve Export > JSON or an encrypted workspace backup. Those preserve the game, diagram layout and notes together.\nVisualNerve.server.luau: generated server runtime.\nVisualNerve.client.luau: generated player HUD.\nVisualNerveImporter.plugin.luau: explicit-preview Studio merge importer.\n`;
  const artifacts: RobloxArtifact[] = [
    { name: 'game.rbxlx', content: placeXml, mimeType: 'application/xml' },
    { name: 'game.json', content: JSON.stringify(input, null, 2), mimeType: 'application/json' },
    { name: 'VisualNerve.server.luau', content: serverLuau, mimeType: 'text/plain' },
    { name: 'VisualNerve.client.luau', content: clientLuau, mimeType: 'text/plain' },
    { name: 'VisualNerveImporter.plugin.luau', content: pluginLuau, mimeType: 'text/plain' },
    { name: 'README.txt', content: readme, mimeType: 'text/plain' },
  ];
  const encoder = new TextEncoder();
  if (
    artifacts.some(
      (artifact) => encoder.encode(artifact.content).length > ROBLOX_LIMITS.maxArtifactBytes,
    )
  )
    throw new RobloxValidationError([
      {
        severity: 'error',
        code: 'artifact-size',
        path: 'game',
        message: 'The generated file is too large. Remove some objects, rules or long messages.',
      },
    ]);
  return {
    game,
    diagnostics: validation.diagnostics,
    artifacts,
    placeXml,
    serverLuau,
    clientLuau,
    pluginLuau,
  };
}
