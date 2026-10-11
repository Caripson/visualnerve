import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useNodes, useReactFlow, useStore, useViewport } from '@xyflow/react';
import { MousePointer2 } from 'lucide-react';
import type { CollaborationSnapshot } from '../types';
import { participantInitials, presenceColor, presenceTextColor } from './presence-color';
import './collaboration.css';

/** Public diagram-space pointers; the overlay never handles editing/touch input. */
export function PresenceCanvasLayer({ snapshot }: { snapshot: Readonly<CollaborationSnapshot> }) {
  const canvas = useStore((state) => state.domNode);
  const viewport = useViewport();
  const flow = useReactFlow();
  const nodes = useNodes();
  if (!snapshot.roomId || !canvas || !nodes.length) return null;
  const peers = snapshot.participants
    .filter((person) => person.connected && person.deviceId !== snapshot.selfDeviceId)
    .slice(0, 32);
  return createPortal(
    <div className="collaboration-canvas-presence">
      {peers.map((person) => {
        const color = presenceColor(person);
        const style = {
          '--presence-color': color,
          '--presence-text': presenceTextColor(color),
        } as CSSProperties;
        const initials = participantInitials(person.name);
        const name = person.name || person.deviceId;
        return (
          <div key={person.deviceId} style={style}>
            {person.selectedNodeIds.slice(0, 10).map((id) => {
              const node = flow.getInternalNode(id);
              if (!node || node.hidden || !node.measured.width || !node.measured.height)
                return null;
              const position = node.internals.positionAbsolute;
              return (
                <div
                  key={id}
                  className="collaboration-node-presence"
                  role="img"
                  aria-label={name}
                  style={{
                    left: viewport.x + position.x * viewport.zoom - 4,
                    top: viewport.y + position.y * viewport.zoom - 4,
                    width: node.measured.width * viewport.zoom + 8,
                    height: node.measured.height * viewport.zoom + 8,
                  }}
                >
                  <span>{initials}</span>
                </div>
              );
            })}
            {person.pointer &&
              Number.isFinite(person.pointer.x) &&
              Number.isFinite(person.pointer.y) && (
                <div
                  className="collaboration-peer-pointer"
                  role="img"
                  aria-label={name}
                  style={{
                    left: viewport.x + person.pointer.x * viewport.zoom,
                    top: viewport.y + person.pointer.y * viewport.zoom,
                  }}
                >
                  <MousePointer2 size={18} aria-hidden="true" />
                  <span>
                    <strong>{initials}</strong> {name}
                  </span>
                </div>
              )}
          </div>
        );
      })}
    </div>,
    canvas,
  );
}
