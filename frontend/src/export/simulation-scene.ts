import type { Graph } from '../model/types';
import type { SimulationView } from '../simulation/service';
import type { SimulationSummarySnapshot } from '../simulation/summary-context';
import { simulationTopologyCompatible } from '../simulation/topology';
import { ProcessHierarchy } from '../simulation/process-hierarchy';
import { simulationProcessCardId } from '../simulation/process-projection';
import {
  logicalNodeId,
  projectSimulationCapacityNodes,
  projectSimulationRenderModel,
} from '../simulation/render-model';

/** A picture shows the full real flow; capacity units remain views of one logical object. */
export class SimulationExportScene {
  project(graph: Graph, selection: string[], view?: SimulationView) {
    if (!graph.simulation)
      return {
        graph,
        selection,
        summary: { diagramId: graph.diagram.id } as SimulationSummarySnapshot,
      };
    // Export can run before the canvas lifecycle detaches an obsolete run, or
    // for an unopened document. Only a compatible captured flow may supply state.
    const current =
      view?.run.diagramId === graph.diagram.id &&
      simulationTopologyCompatible(graph.simulation, view.run.model)
        ? view
        : undefined;
    const semantics = projectSimulationRenderModel(graph, current?.run);
    const capacity = projectSimulationCapacityNodes(graph, semantics, current?.state);
    const projected = { ...graph, nodes: capacity.nodes, edges: capacity.edges };
    const ids = new Set(graph.nodes.map((node) => node.id));
    const logical = new Set<string>();
    const selected = new Set(selection);
    const hierarchy = new ProcessHierarchy(semantics.model);
    for (const id of selection) {
      if (ids.has(id)) logical.add(id);
      // A selection can outlive a scale-down that removed its displayed slot.
      const unit = id.match(/^simulation-capacity:([^:]+):\d+$/);
      if (unit && ids.has(unit[1])) logical.add(unit[1]);
    }
    for (const processId of hierarchy.processes.keys())
      if (selected.has(simulationProcessCardId(processId)))
        for (const nodeId of hierarchy.nodeIds(processId)) logical.add(nodeId);
    return {
      graph: projected,
      summary: {
        diagramId: graph.diagram.id,
        model: semantics.model,
        view: current,
      } as SimulationSummarySnapshot,
      selection: projected.nodes
        .filter((node) => logical.has(logicalNodeId(node)))
        .map((node) => node.id),
    };
  }
}
