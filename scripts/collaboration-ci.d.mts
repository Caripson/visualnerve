import type { WorkflowRun } from "./require-ci.mjs";

export interface CollaborationCIEvidence {
  workflow: string;
  runId: number;
  runUrl: string;
  validationSha: string;
  unchangedInputs: boolean;
}

export function workflowPushPaths(source: string): string[] | undefined;
export function verifyCollaborationCI(input: {
  sha: string;
  read(path: string): Promise<unknown>;
  runs(workflow: string, query?: { head_sha?: string }): Promise<WorkflowRun[]>;
}): Promise<CollaborationCIEvidence[]>;
