import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ bound: false, session: {}, bind: vi.fn() }));
vi.mock('../src/storage/runtime', () => ({ vaultSession: fixture.session }));
vi.mock('../src/security/workspace-lock', () => ({
  bindWorkspaceLock: (session: unknown) => {
    fixture.bound = true;
    fixture.bind(session);
  },
}));
vi.mock('../src/security/WorkspaceTransferBoundary', () => ({
  WorkspaceTransferBoundary: ({ children }: { children: React.ReactNode }) => (
    <section aria-label="Maintenance boundary">{children}</section>
  ),
}));
vi.mock('../src/App', () => ({
  App: () => {
    if (!fixture.bound) throw new Error('Private editor mounted before the lock boundary');
    return <p>Private editor mounted</p>;
  },
}));
import { WorkspaceSurface } from '../src/security/WorkspaceSurface';

it('installs revocation before private UI mounts and retains its maintenance boundary', () => {
  expect(fixture.bind).toHaveBeenCalledExactlyOnceWith(fixture.session);
  render(<WorkspaceSurface />);
  expect(screen.getByRole('region', { name: 'Maintenance boundary' })).toContainElement(
    screen.getByText('Private editor mounted'),
  );
  expect(fixture.bind).toHaveBeenCalledOnce();
});
