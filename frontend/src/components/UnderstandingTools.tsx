import { useI18n } from '../i18n';
import { Layers, MessagesSquare, History, Network } from 'lucide-react';
import type { DialogName } from '../App';
import { ToolbarMenu } from './ToolbarMenu';

export function UnderstandingActions({ open }: { open: (name: DialogName) => void }) {
  const { t } = useI18n();
  return (
    <>
      <h3>{t('toolbar.understandTitle')}</h3>
      <button className="full" onClick={() => open('overview')}>
        <Layers size={16} />
        {t('toolbar.semanticOverviewAction')}
      </button>
      <button className="full" onClick={() => open('questions')}>
        <MessagesSquare size={16} />
        {t('toolbar.askDiagramAction')}
      </button>
      <button className="full" onClick={() => open('history')}>
        <History size={16} />
        {t('toolbar.versionHistoryAction')}
      </button>
    </>
  );
}
export function UnderstandingTools({ open }: { open: (name: DialogName) => void }) {
  const { t } = useI18n();
  return (
    <ToolbarMenu
      label={t('toolbar.understandMenu')}
      icon={<Network size={15} />}
      className="desktop-tools"
    >
      <UnderstandingActions open={open} />
    </ToolbarMenu>
  );
}
