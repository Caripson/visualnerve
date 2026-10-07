import type { Dispatch, SetStateAction } from 'react';
import type { SimulationModel, SimulationNode } from '../types';
export interface EditorSectionProps {
  draft: SimulationModel;
  setDraft: Dispatch<SetStateAction<SimulationModel>>;
  scenarioId?: string;
}
export interface NodeSectionProps {
  draft: SimulationModel;
  patchNode: (partial: Partial<SimulationNode>) => void;
}
