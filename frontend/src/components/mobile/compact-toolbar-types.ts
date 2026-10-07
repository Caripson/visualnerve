import type { ReactNode } from 'react';
import type { DialogName } from '../../App';
import type { Direction } from '../../layouts/layout';
import type { Graph, NodeKind } from '../../model/types';

export type CompactToolbarProps = {
  graph: Graph;
  spatial: boolean;
  mindmap: boolean;
  kind: NodeKind;
  setKind: (value: NodeKind) => void;
  direction: Direction;
  setDirection: (value: Direction) => void;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selectionCount: number;
  status: string;
  statusIcon: ReactNode;
  showFilters: boolean;
  toggleFilters: () => void;
  open: (name: DialogName) => void;
  switchView: (mode: '2d' | '3d') => void;
  add: () => void;
  addSibling: () => void;
  fit: () => void;
  runLayout: () => Promise<void>;
  newSpatialExample: () => Promise<void>;
};
