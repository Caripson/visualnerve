/** Roblox Game Builder v1. World coordinates are Roblox studs, never diagram pixels. */
export type GameValue = string | number | boolean;
export type GameScope = 'player' | 'shared';
export interface GameVector {
  x: number;
  y: number;
  z: number;
}
export interface GameTransform {
  position: GameVector;
  rotation: GameVector;
  size: GameVector;
}
export type GameEntityKind =
  | 'spawn'
  | 'platform'
  | 'checkpoint'
  | 'hazard'
  | 'collectible'
  | 'door'
  | 'goal'
  | 'npc'
  | 'zone'
  | 'decoration'
  | 'movingPlatform';
export interface GameEntity {
  id: string;
  name: string;
  kind: GameEntityKind;
  transform: GameTransform;
  color: string;
  material:
    | 'Plastic'
    | 'SmoothPlastic'
    | 'Neon'
    | 'Wood'
    | 'Metal'
    | 'Glass'
    | 'Grass'
    | 'Concrete';
  anchored: boolean;
  collidable: boolean;
  visible: boolean;
  enabled: boolean;
  /** Only movingPlatform: offset from its initial position, in studs. */
  movement?: { offset: GameVector; duration: number };
}
export type GameExpression =
  | { kind: 'literal'; value: GameValue }
  /** Prefab rules only; expansion replaces this with the instance value. */
  | { kind: 'parameter'; parameterId: string }
  | { kind: 'variable'; variableId: string }
  | { kind: 'inventory'; itemId: string }
  | { kind: 'questProgress'; questId: string }
  | { kind: 'questState'; questId: string }
  | {
      kind: 'arithmetic';
      operator: '+' | '-' | '*' | '/';
      left: GameExpression;
      right: GameExpression;
    };
export type GameCondition =
  | {
      kind: 'compare';
      operator: '==' | '!=' | '>' | '>=' | '<' | '<=';
      left: GameExpression;
      right: GameExpression;
    }
  | { kind: 'all'; conditions: GameCondition[] }
  | { kind: 'any'; conditions: GameCondition[] }
  | { kind: 'not'; condition: GameCondition };
export type GameEvent =
  | { kind: 'playerJoin' | 'roundStart' | 'roundEnd' }
  | { kind: 'touch' | 'interact'; entityId: string }
  | { kind: 'timer'; timerId: string };
export type GameAction =
  | { kind: 'setVariable' | 'addVariable'; variableId: string; value: GameExpression }
  | { kind: 'giveItem' | 'removeItem'; itemId: string; amount: GameExpression }
  | { kind: 'startQuest' | 'completeQuest'; questId: string }
  | { kind: 'advanceQuest'; questId: string; amount: GameExpression }
  | { kind: 'startTimer' | 'stopTimer'; timerId: string }
  | {
      kind: 'setEntityEnabled' | 'setEntityVisible' | 'setEntityCollidable';
      entityId: string;
      value: boolean;
    }
  | { kind: 'teleport' | 'setCheckpoint'; entityId: string }
  | { kind: 'message'; text: string }
  | { kind: 'damage' | 'heal'; amount: GameExpression }
  | { kind: 'win'; message: string }
  | { kind: 'startRound' | 'endRound' };
export interface GameRule {
  id: string;
  name: string;
  enabled: boolean;
  event: GameEvent;
  condition?: GameCondition;
  actions: GameAction[];
  /** Seconds; one touch cannot trigger repeated damage/rewards every physics frame. */
  cooldown: number;
  oncePerPlayer: boolean;
}
export interface GameVariable {
  id: string;
  name: string;
  scope: GameScope;
  initial: GameValue;
  min?: number;
  max?: number;
}
export interface GameItem {
  id: string;
  name: string;
  maxStack: number;
}
export interface GameQuest {
  id: string;
  name: string;
  description: string;
  target: number;
}
export interface GameTimer {
  id: string;
  name: string;
  scope: GameScope;
  duration: number;
  repeat: boolean;
}
export type GamePrefabProperty =
  | 'color'
  | 'enabled'
  | 'visible'
  | 'collidable'
  | 'position.x'
  | 'position.y'
  | 'position.z'
  | 'size.x'
  | 'size.y'
  | 'size.z'
  | 'movement.duration';
export interface GamePrefabParameter {
  id: string;
  name: string;
  default: GameValue;
}
export interface GamePrefabBinding {
  entityId: string;
  property: GamePrefabProperty;
  parameterId: string;
}
export interface GamePrefab {
  id: string;
  name: string;
  entities: GameEntity[];
  rules: GameRule[];
  parameters?: GamePrefabParameter[];
  bindings?: GamePrefabBinding[];
}
export interface GamePrefabInstance {
  id: string;
  name: string;
  prefabId: string;
  position: GameVector;
  rotation: GameVector;
  parameters?: Record<string, GameValue>;
}
export interface GameDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  settings: {
    maxPlayers: number;
    gravity: number;
    walkSpeed: number;
    jumpPower: number;
    respawnSeconds: number;
    ambient: string;
  };
  entities: GameEntity[];
  prefabs: GamePrefab[];
  instances: GamePrefabInstance[];
  variables: GameVariable[];
  items: GameItem[];
  quests: GameQuest[];
  timers: GameTimer[];
  rules: GameRule[];
}
export interface GameDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
  entityId?: string;
  ruleId?: string;
}
export interface GameValidation {
  valid: boolean;
  diagnostics: GameDiagnostic[];
}
/** Fully expanded contract shared by preview and native compilation. */
export interface CompiledGame extends Omit<GameDefinition, 'prefabs' | 'instances'> {
  entities: GameEntity[];
  rules: GameRule[];
}
export interface RobloxArtifact {
  name: string;
  content: string;
  mimeType: string;
}
export interface RobloxBuild {
  game: CompiledGame;
  diagnostics: GameDiagnostic[];
  artifacts: RobloxArtifact[];
  /** XML .rbxlx bytes; direct Roblox publishing sends this artifact. */
  placeXml: string;
  serverLuau: string;
  clientLuau: string;
  pluginLuau: string;
}
export const ROBLOX_LIMITS = {
  entities: 1000,
  rules: 1000,
  variables: 128,
  items: 128,
  quests: 128,
  timers: 128,
  prefabs: 128,
  instances: 256,
  actionsPerRule: 64,
  expressionDepth: 12,
  conditionDepth: 12,
  textLength: 2000,
  coordinate: 100000,
  size: 2048,
  actionBudget: 8192,
  eventBudget: 256,
  maxArtifactBytes: 16 * 1024 * 1024,
} as const;
