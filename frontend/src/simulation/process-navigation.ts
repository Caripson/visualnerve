import { create } from 'zustand';

export interface ProcessView {
  mode: 'hierarchy' | 'all';
  processId?: string;
}
interface ProcessNavigationState {
  views: Record<string, ProcessView>;
  navigate: (diagramId: string, view: ProcessView) => void;
}
/** Camera/navigation choices are presentation state, never simulation assumptions. */
export const useProcessNavigation = create<ProcessNavigationState>((set) => ({
  views: {},
  navigate: (diagramId, view) => set((state) => ({ views: { ...state.views, [diagramId]: view } })),
}));
export const processOverview: ProcessView = { mode: 'hierarchy' };
export function openSimulationProcess(diagramId: string, processId?: string) {
  useProcessNavigation.getState().navigate(diagramId, { mode: 'hierarchy', processId });
}
