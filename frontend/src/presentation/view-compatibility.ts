import type { Graph } from '../model/types';
import { StorageError } from '../model/errors';
import { getOverviewConfig } from '../overview/types';
import type { StoryboardView } from './storyboard';

export const STORYBOARD_OVERVIEW_VIEW_MESSAGE =
  'Saved scene views require Details. Choose Details or use Auto-fit objects.';

/** A saved camera refers to canonical placement, not the overview's compact layout. */
export function assertStoryboardCameraAvailable(graph: Graph) {
  if (getOverviewConfig(graph).enabled)
    throw new StorageError(422, STORYBOARD_OVERVIEW_VIEW_MESSAGE);
}

export function assertStoryboardViewCompatible(graph: Graph, view?: StoryboardView) {
  if (view) assertStoryboardCameraAvailable(graph);
}
