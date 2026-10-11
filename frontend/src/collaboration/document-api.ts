import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import type { CommandOptions } from '../storage/repository';
import type { WorkspaceStorage } from '../storage/contracts';
import { collaborationPermissions } from './access';
import { collaborationFor, mutateCollaboration } from './model';
import type { CollaborationAction, CollaborationActionContext } from './model';

import { documentProfilePreference } from './profile-preference';
export { documentProfilePreference } from './profile-preference';
export interface CollaborationDocumentPort {
  getGraph(id: string): Promise<Graph>;
  saveGraph(
    graph: Graph,
    version: number,
    beforeWrite?: CommandOptions['beforeWrite'],
  ): Promise<Graph>;
  db: WorkspaceStorage;
}

/** UI and API share this document mutation boundary and the repository's versioned transaction. */
export class CollaborationDocumentCommands {
  constructor(private port: CollaborationDocumentPort) {}
  async request(
    id: string,
    parts: string[],
    url: URL,
    method: string,
    input: unknown,
    options: CommandOptions,
  ): Promise<unknown> {
    if (parts.length !== 4 || url.search || url.hash)
      throw new StorageError(
        422,
        'Use an exact collaboration document/action path without query parameters.',
      );
    const graph = await this.port.getGraph(id);
    if (parts[3] === 'document' && method === 'GET') {
      // The HTTP bridge encodes an absent request body as JSON null.
      if (
        input !== undefined &&
        input !== null &&
        (typeof input !== 'object' ||
          Array.isArray(input) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
          Reflect.ownKeys(input).length)
      )
        throw new StorageError(422, 'Document inspection takes no arguments.');
      return {
        diagramId: id,
        baseVersion: graph.diagram.version,
        document: collaborationFor(graph),
      };
    }
    if (parts[3] !== 'actions' || method !== 'POST')
      throw new StorageError(404, 'Unknown collaboration document command.');
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(input).some(
        (key) => typeof key !== 'string' || !['baseVersion', 'action'].includes(key),
      )
    )
      throw new StorageError(422, 'A collaboration action requires baseVersion and action only.');
    const value = input as { baseVersion: number; action: CollaborationAction };
    if (!Number.isSafeInteger(value.baseVersion) || value.baseVersion < 1)
      throw new StorageError(
        422,
        'Read the current diagram version before applying a collaboration action.',
      );
    if (graph.diagram.version !== value.baseVersion)
      throw new StorageError(
        409,
        'The diagram changed. Read its current version and review the action again.',
      );
    if (
      value.action?.type === 'profile.remove' &&
      collaborationPermissions.activeProfileIds(id).includes(value.action.id)
    )
      throw new StorageError(
        409,
        'Remove the approved device from the room before deleting its document profile.',
      );
    const bound = collaborationPermissions.documentContext(id);
    const local = await this.port.db.settings.get(documentProfilePreference(id));
    const localId =
      typeof local?.value === 'string' &&
      graph.diagram.collaboration?.profiles.some((p) => p.id === local.value)
        ? local.value
        : undefined;
    const context: CollaborationActionContext = bound
      ? { ...bound, source: options.collaborationContext?.source ?? 'api' }
      : (options.collaborationContext ?? { role: 'owner', profileId: localId, source: 'api' });
    const live = collaborationPermissions.applyDocumentAction(
      id,
      value.action,
      context,
      async () => {
        await options.beforeRequest?.();
        collaborationPermissions.assertWrite(id);
      },
    );
    if (live) return live;
    const changed = mutateCollaboration(graph, value.action, context);
    if (changed === graph) return graph;
    const selected =
      !bound && value.action.type === 'profile.create' && !localId
        ? changed.diagram.collaboration!.profiles.at(-1)!.id
        : undefined;
    return this.port.saveGraph(changed, value.baseVersion, async (scope) => {
      await options.beforeWrite?.(scope);
      if (selected)
        await scope.settings.put({ key: documentProfilePreference(id), value: selected });
    });
  }
}
