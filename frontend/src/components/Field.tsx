import type { ReactNode } from 'react';

/** Shared form layout does not import the optional diagram inspector. */
export function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{title}</span>
      {children}
    </label>
  );
}
