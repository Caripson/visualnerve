import { useI18n } from '../i18n';
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
  const { t } = useI18n();
  const hasData = graphDatasets(graph).length > 0;
  const hasSchema = graph.nodes.some((node) => !!getSqlTable(node));
  const hasQuery = graph.nodes.some(
    (node) => !!getSqlQueryResult(node) || !!getSqlQuerySource(node),
  );
  return (
    <>
      <h3>{t('toolbar.dataBehindTitle')}</h3>
      <p>{t('toolbar.dataBehindHint')}</p>
      <button className="full" onClick={() => open('sources')}>
        <FileUp size={16} />
        {t('toolbar.dataSourcesAction')}
      </button>
      <button className="full" disabled={!hasData && !hasSchema} onClick={() => open('refresh')}>
        <RefreshCw size={16} />
        {t('toolbar.refreshSourceAction')}
      </button>
      <button
        className="full"
        disabled={!hasData && !hasSchema && !hasQuery}
        onClick={() => open('quality')}
      >
        <ScanSearch size={16} />
        {t('toolbar.dataQualityAction')}
      </button>
      {!hasData && !hasSchema && !hasQuery && (
        <p className="toolbar-menu-hint">{t('toolbar.dataRequiredHint')}</p>
      )}
      {hasQuery && !hasData && !hasSchema && (
        <p className="toolbar-menu-hint">{t('toolbar.queryStructureHint')}</p>
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
  const { t } = useI18n();
  return (
    <ToolbarMenu
      label={t('toolbar.exploreDataMenu')}
      icon={<Database size={15} />}
      className="desktop-tools"
    >
      <DataToolActions graph={graph} open={open} />
    </ToolbarMenu>
  );
}
