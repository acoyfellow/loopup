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