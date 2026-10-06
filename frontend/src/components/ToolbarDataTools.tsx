import { Database, RefreshCw, ScanSearch, FileUp } from 'lucide-react';
import { getSqlTable } from '../sql/schema';
import { getSqlQueryResult, getSqlQuerySource } from '../sql/query-schema';
import { graphDatasets } from '../data/model';
import type { Graph } from '../model/types';
import type { DialogName } from '../App';
import { ToolbarMenu } from './ToolbarMenu';

export function DataToolActions({
  graph,
  open,
}: {
  graph: Graph;
  open: (name: DialogName) => void;
}) {
  const hasData = graphDatasets(graph).length > 0;
  const hasSchema = graph.nodes.some((node) => !!getSqlTable(node));
  const hasQuery = graph.nodes.some(
    (node) => !!getSqlQueryResult(node) || !!getSqlQuerySource(node),
  );
  return (
    <>
      <h3>Data behind this diagram</h3>
      <p>Link CSV sources, review CSV or SQL quality, and refresh imported data.</p>
      <button className="full" onClick={() => open('sources')}>
        <FileUp size={16} />
        Data sources
      </button>
      <button className="full" disabled={!hasData && !hasSchema} onClick={() => open('refresh')}>
        <RefreshCw size={16} />
        Refresh source
      </button>
      <button
        className="full"
        disabled={!hasData && !hasSchema && !hasQuery}
        onClick={() => open('quality')}
      >
        <ScanSearch size={16} />
        Data quality
      </button>
      {!hasData && !hasSchema && !hasQuery && (
        <p className="toolbar-menu-hint">Add CSV data or import SQL to use these checks.</p>
      )}
      {hasQuery && !hasData && !hasSchema && (
        <p className="toolbar-menu-hint">
          SELECT diagrams support structure checks. Refresh source updates CSV data or SQL table
          schemas.
        </p>
      )}
    </>
  );
}
export function ToolbarDataTools({
  graph,
  open,
}: {
  graph: Graph;
  open: (name: DialogName) => void;
}) {
  return (
    <ToolbarMenu label="Explore data" icon={<Database size={15} />} className="desktop-tools">
      <DataToolActions graph={graph} open={open} />
    </ToolbarMenu>
  );
}
