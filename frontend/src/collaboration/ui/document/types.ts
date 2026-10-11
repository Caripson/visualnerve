import type { Graph } from '../../../model/types';
import type { CollaborationAction, CollaborationDocument } from '../../model';

export interface DocumentWorkProps {
  graph: Graph;
  document: CollaborationDocument;
  profileId?: string;
  owner: boolean;
  writable: boolean;
  busy: boolean;
  selectedNodeId?: string;
  run(action: CollaborationAction, baseVersion?: number): Promise<boolean>;
}
