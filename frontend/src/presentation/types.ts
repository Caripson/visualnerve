import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import type { PresentationSource } from './storyboard';

export interface PresentationDefinition {
  version: 1;
  nodeIds: string[];
  secondsPerNode: number;
  transitionMs: number;
}
export const presentationDefaults = { secondsPerNode: 8, transitionMs: 1200 } as const;
export const presentationNodeLimit = 20_000;
export const presentationVoiceIds = [
  'en_GB-alan-medium',
  'en_US-ljspeech-high',
  'en_GB-cori-high',
  'sv_SE-nst-medium',
] as const;
export const defaultPresentationVoiceId = presentationVoiceIds[0];
export function isPresentationVoiceId(
  value: unknown,
): value is (typeof presentationVoiceIds)[number] {
  return typeof value === 'string' && presentationVoiceIds.some((id) => id === value);
}
export interface PresentationRuntimeState {
  open: boolean;
  diagramId: string | null;
  status: 'idle' | 'loading' | 'moving' | 'playing' | 'paused' | 'ended' | 'error';
  index: number;
  total: number;
  nodeId: string | null;
  source: PresentationSource;
  sceneId: string | null;
  nodeIds: string[];
  edgeIds: string[];
  title: string;
  narration: string;
  audio: boolean;
  subtitles: boolean;
  preload: boolean;
  minimized: boolean;
  buffered: number;
  progress: number;
  message: string;
}
export interface PresentationVoice {
  id: (typeof presentationVoiceIds)[number];
  label: string;
  language: 'en' | 'sv';
  sampleRate: number;
  modelBytes: number;
  license: string;
  source: string;
}
export interface PresentationVoiceCatalog {
  defaultVoiceId: string;
  voices: PresentationVoice[];
}
export function emptyPresentation(): PresentationDefinition {
  return { version: 1, nodeIds: [], ...presentationDefaults };
}
export function validatePresentation(
  value: unknown,
  graph?: Pick<Graph, 'nodes'>,
): asserts value is PresentationDefinition {
  const fail = (message: string): never => {
    throw new StorageError(422, message);
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('Presentation must be an object.');
  const definition = value as PresentationDefinition;
  if (
    Object.keys(definition).some(
      (key) => !['version', 'nodeIds', 'secondsPerNode', 'transitionMs'].includes(key),
    ) ||
    definition.version !== 1
  )
    fail('Unsupported presentation fields or version.');
  if (!Array.isArray(definition.nodeIds) || definition.nodeIds.length > presentationNodeLimit)
    fail('Presentation supports at most 20,000 nodes.');
  const ids = new Set<string>();
  const nodes = graph && new Set(graph.nodes.map((node) => node.id));
  for (const id of definition.nodeIds) {
    if (
      typeof id !== 'string' ||
      !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id) ||
      ids.has(id) ||
      (nodes && !nodes.has(id))
    )
      fail('Presentation node IDs must be unique UUIDs in this diagram.');
    ids.add(id);
  }
  if (
    !Number.isFinite(definition.secondsPerNode) ||
    definition.secondsPerNode < 2 ||
    definition.secondsPerNode > 600
  )
    fail('Presentation seconds per node must be between 2 and 600.');
  if (
    !Number.isFinite(definition.transitionMs) ||
    definition.transitionMs < 0 ||
    definition.transitionMs > 10_000
  )
    fail('Presentation transition must be between 0 and 10,000 milliseconds.');
}
