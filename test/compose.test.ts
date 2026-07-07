import { describe, expect, test, beforeEach } from 'bun:test';
import { compose } from '../src/orchestrator';
import { verify } from '../src/verifier';
import { contentHash, compositeHash } from '../src/hash';

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

// Matches the REAL temper /api/promote contract: nested under `hammer`.
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

  test('full happy path composition', async () => {
    const receipt = await withFetch(mockFetch as any, () => compose('Test north star', 'test-session-1'));
    expect(receipt.northStar).toBe('Test north star');
    expect(receipt.legs.length).toBe(5);
    expect(receipt.legs.every(l => l.ok)).toBe(true);
    expect(receipt.compositeHash).toBeTruthy();
    expect(receipt.hammerId).toBeTruthy();
  });

  test('backwards disproved (status failed) still yields valid run', async () => {
    const customFetch = ((url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/receipt')) {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'test-run-2',
          status: 'failed',
          leafResults: [{ claimId: 'c1', outcome: 'disproved', summary: 'verified-disproved node fired' }],
          hash: 'def456',
        }), { status: 200 }));
      }
      return mockFetch(url, init);
    }) as any;

    const receipt = await withFetch(customFetch, () => compose('Disproved test', 'test-session-2'));
    const backwardsLeg = receipt.legs.find(l => l.service === 'backwards');
    expect(backwardsLeg?.ok).toBe(true);
    const data = backwardsLeg?.data as any;
    expect(data.status).toBe('failed');
  });

  test('one service unreachable records error honestly', async () => {
    const customFetch = ((url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.hostname === 'manyface.coey.dev') {
        return Promise.reject(new Error('manyface unreachable'));
      }
      return mockFetch(url, init);
    }) as any;

    const receipt = await withFetch(customFetch, () => compose('Unreachable test', 'test-session-3'));
    const manyfaceLeg = receipt.legs.find(l => l.service === 'manyface');
    expect(manyfaceLeg?.ok).toBe(false);
    expect(manyfaceLeg?.error).toBeTruthy();
  });

  test('verifier detects hash tampering', async () => {
    const receipt = await withFetch(mockFetch as any, () => compose('Verify test', 'test-session-4'));
    const tampered = { ...receipt, compositeHash: 'tampered' };
    const result = await verify(tampered);
    expect(result.compositeHashMatch).toBe(false);
    expect(result.verified).toBe(false);
  });

  test('verifier passes on honest receipt', async () => {
    const receipt = await withFetch(mockFetch as any, () => compose('Verify honest', 'test-session-5'));
    const result = await verify(receipt);
    expect(result.verified).toBe(true);
    expect(result.legChecks.every(l => l.verified)).toBe(true);
  });
});