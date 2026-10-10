import { describe, expect, it } from 'vitest';
import { blankGraph } from '../src/model/types';
import { CollaborationPermissions } from '../src/collaboration/access';

describe('shared document authority', () => {
  it('keeps unrelated local documents editable', () => {
    const permissions = new CollaborationPermissions();
    permissions.bind('shared', {
      role: 'viewer',
      check() {},
      hasSharedChanges: () => true,
    });
    expect(() => permissions.assertWrite('local')).not.toThrow();
    expect(() => permissions.assertWrite('shared')).toThrow(/read only/);
  });

  it('allows a viewer to navigate but rejects content edits', () => {
    const permissions = new CollaborationPermissions();
    const before = blankGraph('Shared');
    const after = structuredClone(before);
    permissions.bind(before.diagram.id, {
      role: 'viewer',
      check() {},
      hasSharedChanges: (a, b) => a.diagram.name !== b.diagram.name,
    });
    after.diagram.settings.viewport = { x: 10, y: 20, zoom: 1 };
    expect(() => permissions.assertWrite(before.diagram.id, before, after)).not.toThrow();
    after.diagram.name = 'Unauthorized rename';
    expect(() => permissions.assertWrite(before.diagram.id, before, after)).toThrow(/read only/);
  });

  it('does not accept a serialized projection capability', () => {
    const permissions = new CollaborationPermissions();
    permissions.bind('shared', {
      role: 'viewer',
      check() {},
      hasSharedChanges: () => true,
    });
    expect(() =>
      permissions.assertWrite('shared', undefined, undefined, { diagramId: 'shared' }),
    ).toThrow(/read only/);
  });

  it('binds remote projection authority to the document and revocable lease', () => {
    const permissions = new CollaborationPermissions();
    let locked = false;
    const check = () => {
      if (locked) throw new Error('Workspace locked');
    };
    permissions.bind('shared', { role: 'viewer', check, hasSharedChanges: () => true });
    const authority = permissions.projection('shared', check);
    expect(() => permissions.assertWrite('shared', undefined, undefined, authority)).not.toThrow();
    locked = true;
    expect(() => permissions.assertWrite('shared', undefined, undefined, authority)).toThrow(
      /locked/,
    );
  });

  it('does not let one session detach or replace another binding', () => {
    const permissions = new CollaborationPermissions();
    const access = { role: 'editor' as const, check() {}, hasSharedChanges: () => true };
    const release = permissions.bind('shared', access);
    expect(() => permissions.bind('shared', access)).toThrow(/already/);
    release();
    const next = permissions.bind('shared', { ...access, role: 'viewer' });
    release();
    expect(permissions.role('shared')).toBe('viewer');
    next();
    expect(permissions.role('shared')).toBeUndefined();
  });
});
