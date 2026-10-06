import { Layers, MessagesSquare, History, Network } from 'lucide-react';
import type { DialogName } from '../App';
import { ToolbarMenu } from './ToolbarMenu';

export function UnderstandingActions({ open }: { open: (name: DialogName) => void }) {
  return (
    <>
      <h3>Understand this diagram</h3>
      <button className="full" onClick={() => open('overview')}>
        <Layers size={16} />
        Semantic overview
      </button>
      <button className="full" onClick={() => open('questions')}>
        <MessagesSquare size={16} />
        Ask diagram
      </button>
      <button className="full" onClick={() => open('history')}>
        <History size={16} />
        Version history
      </button>
    </>
  );
}
export function UnderstandingTools({ open }: { open: (name: DialogName) => void }) {
  return (
    <ToolbarMenu label="Understand" icon={<Network size={15} />} className="desktop-tools">
      <UnderstandingActions open={open} />
    </ToolbarMenu>
  );
}
