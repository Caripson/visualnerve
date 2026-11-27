import type { BehaviorDiagnostic } from './language';

export function BehaviorDiagnosticMessage({ diagnostic }: { diagnostic: BehaviorDiagnostic }) {
  return (
    <p className="behavior-diagnostic">
      Line {diagnostic.line}, column {diagnostic.column} · {diagnostic.message}
    </p>
  );
}
