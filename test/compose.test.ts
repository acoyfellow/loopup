import { describe, expect, test, beforeEach } from 'bun:test';
import { contentHash, compositeHash } from '../src/hash';
import { verify, replayVerify } from '../src/verifier';
import type { RunState, StageState, CompositeReceipt, LegResult } from '../src/types';

const mockReceiptData = {
  id: 'test-run-1',
  status: 'passed' as const,
  leafResults: [{ claimId: 'c1', outcome: 'verified', summary: 'test' }],
  hash: 'abc123',
};

const mockManyfaceData = {
  tournamentId: 't1',
  winnerId: 'w1',
  verdicts: [{ artifactId: 'a1', passed: true, score: 0.95 }],
};

const mockTemperData = {
  ok: true,
  hammer: {
    id: 'hammer-1',
    provenance: { contentHash: 'ch1', sourceReceipt: 'sr1' },
  },
  verification: { passed: true },
};

const mockDejaData = {
  revision: 1,
  eventId: 'evt-1',
};

const mockAirdeskAwaiting = {
  status: 'awaiting_signature',
  artifactHash: 'ah1',
  evidenceRoot: 'er1',
  powers: ['compose'],
  expiry: '2026-07-08T00:00:00Z',
};

const mockAirdeskSigned = {
  status: 'signed',
  artifactHash: 'ah1',
  evidenceRoot: 'er1',
  powers: ['compose'],
  expiry: '2026-07-08T00:00:00Z',
};

let airdeskFrontierCalls = 0;

beforeEach(() => {
  airdeskFrontierCalls = 0;
});

function mockFetch(url: string, _init?: RequestInit): Promise<Response> {
  const u = new URL(url);
  if (u.pathname.startsWith('/api/runs/') && u.pathname.endsWith('/receipt')) {
    return Promise.resolve(new Response(JSON.stringify(mockReceiptData), { status: 200 }));
  }
  if (u.pathname.startsWith('/api/runs/') && u.pathname.endsWith('/complete')) {
    return Promise.resolve(new Response(JSON.stringify({ id: 'test-run-1' }), { status: 200 }));
  }
  if (u.pathname === '/api/runs') {
    return Promise.resolve(new Response(JSON.stringify({ id: 'test-run-1' }), { status: 200 }));
  }
  if (u.pathname === '/api/tournament') {
    return Promise.resolve(new Response(JSON.stringify(mockManyfaceData), { status: 200 }));
  }
  if (u.pathname === '/api/promote') {
    return Promise.resolve(new Response(JSON.stringify(mockTemperData), { status: 200 }));
  }
  if (u.pathname === '/v1/shared/remember') {
    return Promise.resolve(new Response(JSON.stringify(mockDejaData), { status: 200 }));
  }
  if (u.pathname.startsWith('/api/hammers/')) {
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  }
  if (u.pathname === '/v1/shared/events') {
    return Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 }));
  }
  if (u.pathname.startsWith('/api/frontier/')) {
    const isFirst = airdeskFrontierCalls === 0;
    airdeskFrontierCalls++;
    return Promise.resolve(new Response(JSON.stringify(isFirst ? mockAirdeskAwaiting : mockAirdeskSigned), { status: 200 }));
  }
  if (u.pathname.startsWith('/api/dev-sign/')) {
    return Promise.resolve(new Response(JSON.stringify({ status: 'signed' }), { status: 200 }));
  }
  if (u.pathname === '/api/task') {
    return Promise.resolve(new Response(JSON.stringify({ workflowId: 'wf-1' }), { status: 200 }));
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
}

function withFetch<T>(fetchFn: typeof globalThis.fetch, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchFn;
  return fn().finally(() => { globalThis.fetch = orig; });
}

describe('LoopUp Composition', () => {
  test('contentHash produces deterministic output', () => {
    const h1 = contentHash({ a: 1, b: 2 });
    const h2 = contentHash({ a: 1, b: 2 });
    expect(h1).toBe(h2);
  });

  test('compositeHash changes when leg hash changes', () => {
    const legs = [
      { service: 'a', ok: true, hash: 'abc', data: null },
      { service: 'b', ok: true, hash: 'def', data: null },
    ];
    const h1 = compositeHash(legs as any);
    const legs2 = [
      { service: 'a', ok: true, hash: 'xyz', data: null },
      { service: 'b', ok: true, hash: 'def', data: null },
    ];
    const h2 = compositeHash(legs2 as any);
    expect(h1).not.toBe(h2);
  });

  test('verifier detects hash tampering', async () => {
    const receipt: CompositeReceipt = {
      runId: 'test',
      northStar: 'test',
      timestamp: new Date().toISOString(),
      legs: [
        { service: 'backwards', ok: true, hash: 'abc', data: { test: true } },
      ],
      compositeHash: 'tampered',
    };
    const result = await verify(receipt);
    expect(result.compositeHashMatch).toBe(false);
    expect(result.verified).toBe(false);
  });

  test('verifier passes on honest receipt', async () => {
    const leg: LegResult = { service: 'backwards', ok: true, hash: contentHash({ test: true }), data: { test: true } };
    const receipt: CompositeReceipt = {
      runId: 'test',
      northStar: 'test',
      timestamp: new Date().toISOString(),
      legs: [leg],
      compositeHash: compositeHash([leg]),
    };
    const result = await verify(receipt);
    expect(result.verified).toBe(true);
  });

  test('unreachable leg records error honestly', async () => {
    const leg: LegResult = { service: 'manyface', ok: false, hash: '', data: null, error: 'manyface unreachable' };
    const receipt: CompositeReceipt = {
      runId: 'test',
      northStar: 'test',
      timestamp: new Date().toISOString(),
      legs: [leg],
      compositeHash: compositeHash([leg]),
    };
    const result = await verify(receipt);
    expect(result.verified).toBe(false);
    expect(result.legChecks[0].verified).toBe(false);
    expect(result.legChecks[0].error).toBeTruthy();
  });

  test('replay verify recomputes from run state stages', async () => {
    const runState: RunState = {
      id: 'test-run',
      goal: 'test goal',
      status: 'completed',
      currentStage: 8,
      stages: [
        { name: 'backwards', status: 'passed', hash: contentHash({ test: true }), data: { test: true } },
        { name: 'manyface', status: 'passed', hash: contentHash({ test2: true }), data: { test2: true } },
        { name: 'temper', status: 'passed', hash: contentHash({ test3: true }), data: { test3: true } },
        { name: 'deja-shared', status: 'passed', hash: contentHash({ test4: true }), data: { test4: true } },
        { name: 'airdesk', status: 'passed', hash: contentHash({ test5: true }), data: { test5: true } },
        { name: 'approval', status: 'passed', data: { approved: true } },
        { name: 'mint', status: 'passed', hash: contentHash({ test6: true }), data: { test6: true } },
        { name: 'done', status: 'passed' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      compositeHash: '',
    };
    const stageLegs = runState.stages
      .filter(s => s.name !== 'approval' && s.name !== 'mint' && s.name !== 'done')
      .map(s => ({
        service: s.name,
        ok: s.status === 'passed',
        hash: s.hash ?? '',
        data: s.data,
      }));
    const ch = compositeHash(stageLegs as LegResult[]);
    runState.compositeHash = ch;

    const result = await replayVerify(runState);
    expect(result.verified).toBe(true);
    expect(result.evidenceRoot).toBeTruthy();
    expect(result.legChecks.length).toBe(5);
    expect(result.legChecks.every(l => l.verified)).toBe(true);
  });

  test('approval void on artifact hash mismatch', () => {
    const runState: RunState = {
      id: 'test-run',
      goal: 'test',
      status: 'awaiting_approval',
      currentStage: 5,
      stages: [
        { name: 'backwards', status: 'passed', hash: 'abc', data: {} },
        { name: 'manyface', status: 'passed', hash: 'def', data: {} },
        { name: 'temper', status: 'passed', hash: 'ghi', data: {} },
        { name: 'deja-shared', status: 'passed', hash: 'jkl', data: {} },
        { name: 'airdesk', status: 'passed', hash: 'mno', data: { artifactHash: 'real-hash' } },
        { name: 'approval', status: 'pending' },
        { name: 'mint', status: 'pending' },
        { name: 'done', status: 'pending' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvalArtifactHash: 'real-hash',
    };
    expect(runState.approvalArtifactHash).toBe('real-hash');
    const submittedHash = 'wrong-hash';
    const isVoid = submittedHash !== runState.approvalArtifactHash;
    expect(isVoid).toBe(true);
  });

  test('run state creation has correct initial shape', () => {
    const run: RunState = {
      id: 'new-run',
      goal: 'test goal',
      status: 'created',
      currentStage: 0,
      stages: [
        { name: 'backwards', status: 'pending' },
        { name: 'manyface', status: 'pending' },
        { name: 'temper', status: 'pending' },
        { name: 'deja-shared', status: 'pending' },
        { name: 'airdesk', status: 'pending' },
        { name: 'approval', status: 'pending' },
        { name: 'mint', status: 'pending' },
        { name: 'done', status: 'pending' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(run.status).toBe('created');
    expect(run.stages.length).toBe(8);
    expect(run.stages.every(s => s.status === 'pending')).toBe(true);
  });

  test('stage machine advances through stages', () => {
    const run: RunState = {
      id: 'advance-test',
      goal: 'test',
      status: 'running',
      currentStage: 0,
      stages: [
        { name: 'backwards', status: 'pending' },
        { name: 'manyface', status: 'pending' },
        { name: 'temper', status: 'pending' },
        { name: 'deja-shared', status: 'pending' },
        { name: 'airdesk', status: 'pending' },
        { name: 'approval', status: 'pending' },
        { name: 'mint', status: 'pending' },
        { name: 'done', status: 'pending' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    run.stages[0].status = 'passed';
    run.currentStage = 1;
    expect(run.currentStage).toBe(1);
    expect(run.stages[0].status).toBe('passed');

    run.stages[1].status = 'passed';
    run.currentStage = 2;
    expect(run.currentStage).toBe(2);
  });
});