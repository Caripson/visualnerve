export interface WorkflowRun {
  id: number;
  run_number: number;
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  updated_at?: string;
  created_at?: string;
}

export interface DeploymentEvidence {
  sha: string;
  ciRunId: number;
  ciUrl: string;
  stagingRunId?: number;
  stagingUrl?: string;
}

export function authorizeDeployment(input: {
  sha: string;
  mainSha: string;
  ref: string;
  mode: string;
  ciRuns: WorkflowRun[];
  stagingRuns?: WorkflowRun[];
  approvedSha?: string;
  actor?: string;
  triggeringActor?: string;
}): DeploymentEvidence;

export function verifyDeployment(
  env: Record<string, string | undefined>,
  mode: string,
  fetcher?: (
    url: URL,
    init: RequestInit,
  ) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>,
): Promise<DeploymentEvidence>;
