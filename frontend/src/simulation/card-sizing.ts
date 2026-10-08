import type { GraphNode } from '../model/types';
import type { SimulationNode } from './types';

/** Content geometry belongs to the rendered view; saved dimensions and process semantics remain authoritative. */
export class SimulationCardSizing {
  minimumHeight(node: SimulationNode): number {
    return node.type === 'work' ? 280 : node.type === 'resource' ? 240 : 160;
  }

  fit(shape: GraphNode, node?: SimulationNode): GraphNode {
    if (!node || shape.height >= this.minimumHeight(node)) return shape;
    return { ...shape, height: this.minimumHeight(node) };
  }
}
