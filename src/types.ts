export interface BackwardsReceipt {
  id: string;
  status: 'passed' | 'failed';
  leafResults: Array<{
    claimId: string;
    outcome: string;
    summary: string;
  }>;
  hash: string;
}

export interface ManyfaceResult {
  tournamentId: string;
  winnerId: string;
  verdicts: Array<{
    artifactId: string;
    passed: boolean;
    score: number;
  }>;
}

export interface TemperHammer {
  id: string;
  provenance: {
    contentHash: string;
    sourceReceipt: string;
  };
  verification: {
    passed: boolean;
  };
}

export interface DejaEvent {
  revision: number;
  eventId: string;
}

export interface AirdeskResult {
  status: string;
  artifactHash: string;
  evidenceRoot: string;
  powers: string[];
  expiry: string;
}

export interface LegResult {
  service: string;
  ok: boolean;
  hash: string;
  data: unknown;
  error?: string;
}

export interface CompositeReceipt {
  runId: string;
  northStar: string;
  timestamp: string;
  legs: LegResult[];
  compositeHash: string;
  hammerId?: string;
  hammerProvenance?: {
    contentHash: string;
    sourceReceipt: string;
  };
  hammerVerified?: boolean;
  hammerError?: string;
}

export type StageName = 'backwards' | 'manyface' | 'temper' | 'deja-shared' | 'airdesk' | 'approval' | 'mint' | 'done';

export type StageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface StageState {
  name: StageName;
  status: StageStatus;
  hash?: string;
  error?: string;
  data?: unknown;
}

export interface RunState {
  id: string;
  goal: string;
  status: 'created' | 'running' | 'awaiting_approval' | 'approved' | 'denied' | 'completed' | 'failed';
  currentStage: number;
  stages: StageState[];
  createdAt: string;
  updatedAt: string;
  compositeHash?: string;
  evidenceRoot?: string;
  hammerId?: string;
  hammerError?: string;
  approvalArtifactHash?: string;
  approvalPowers?: string[];
  approvalEvidenceRoot?: string;
  approvedArtifactHash?: string;
  denialReason?: string;
  dejaInstinct?: string | null;
  temperReused?: { id: string; shapeKey: string } | null;
  resultSummary?: {
    goal: string;
    backwards: { status: string; checksCount: number; disprovedCount: number };
    manyface: { winnerId: string; totalAttempts: number; failedAttempts: number };
    temper: { reused: boolean; toolId: string };
    plainSentence: string;
  } | null;
}

export interface StageRunner {
  name: StageName;
  run: (goal: string, state: RunState) => Promise<StageState>;
}

export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  LOOPUP_RUN: any;
  DEJA_AUTHORITY?: string;
}