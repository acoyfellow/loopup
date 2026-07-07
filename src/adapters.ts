import type { BackwardsReceipt, ManyfaceResult, TemperHammer, DejaEvent, AirdeskResult, LegResult } from './types';
import { contentHash } from './hash';

const BACKWARDS = 'https://backwards.coey.dev';
const MANYFACE = 'https://manyface.coey.dev';
const TEMPER = 'https://temper.coey.dev';
const DEJA_SHARED = 'https://deja-shared.coey.dev';
const AIRDESK = 'https://airdesk.coey.dev';

const AIRDESK_POLL_INTERVAL = 500;
const AIRDESK_MAX_POLLS = 30;

async function fetchJson<T>(
  url: string,
  body?: unknown,
  opts?: { method?: 'GET' | 'POST'; headers?: Record<string, string> },
): Promise<{ ok: boolean; data: T; error?: string }> {
  try {
    const method = opts?.method ?? (body === undefined ? 'GET' : 'POST');
    const init: RequestInit = {
      method,
      headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(opts?.headers ?? {}) },
    };
    if (method === 'POST') init.body = JSON.stringify(body ?? {});
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, data: null as unknown as T, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json() as T;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, data: null as unknown as T, error: String(e) };
  }
}

export async function legBackwards(northStar: string): Promise<LegResult> {
  const compile = await fetchJson<{ id: string }>(`${BACKWARDS}/api/runs`, { text: northStar });
  if (!compile.ok) return { service: 'backwards', ok: false, hash: '', data: null, error: compile.error };

  const runId = compile.data.id;
  const complete = await fetchJson<{ id: string }>(`${BACKWARDS}/api/runs/${runId}/complete`, {}, { method: 'POST' });
  if (!complete.ok) return { service: 'backwards', ok: false, hash: '', data: null, error: complete.error };

  const receipt = await fetchJson<BackwardsReceipt>(`${BACKWARDS}/api/runs/${runId}/receipt`);
  if (!receipt.ok) return { service: 'backwards', ok: false, hash: '', data: null, error: receipt.error };

  const hash = contentHash(receipt.data);
  return { service: 'backwards', ok: true, hash, data: receipt.data };
}

export async function legManyface(claim: string): Promise<LegResult> {
  const result = await fetchJson<ManyfaceResult>(`${MANYFACE}/api/tournament`, { claim });
  if (!result.ok) return { service: 'manyface', ok: false, hash: '', data: null, error: result.error };

  const hash = contentHash(result.data);
  return { service: 'manyface', ok: true, hash, data: result.data };
}

export async function legTemper(receiptId: string, claim: string, winnerId: string): Promise<LegResult> {
  const result = await fetchJson<TemperHammer>(`${TEMPER}/api/promote`, {
    receiptId,
    claim,
    sourceExperiment: 'loopup-composition',
    capabilities: [{ action: 'compose', resource: 'loopup-orchestration' }],
    implementation: `loopup-composed:${winnerId}`,
    interface: { compose: { input: 'northStar', output: 'compositeReceipt' } },
  });
  if (!result.ok) return { service: 'temper', ok: false, hash: '', data: null, error: result.error };

  const hash = contentHash(result.data);
  return { service: 'temper', ok: true, hash, data: result.data };
}

export async function legDejaRemember(slipId: string, text: string, sessionId: string): Promise<LegResult> {
  const result = await fetchJson<DejaEvent>(
    `${DEJA_SHARED}/v1/shared/remember`,
    { slipId, text, authoredBy: 'loopup', sessionId },
    { headers: { 'x-deja-authority': 'loopup-demo' } },
  );
  if (!result.ok) return { service: 'deja-shared', ok: false, hash: '', data: null, error: result.error };

  const hash = contentHash(result.data);
  return { service: 'deja-shared', ok: true, hash, data: result.data };
}

export async function legAirdesk(northStar: string): Promise<LegResult> {
  const task = await fetchJson<{ workflowId: string }>(`${AIRDESK}/api/task`, {
    northStar,
    powers: ['compose', 'publish'],
  });
  if (!task.ok) return { service: 'airdesk', ok: false, hash: '', data: null, error: task.error };

  const workflowId = task.data.workflowId;
  let frontier: AirdeskResult | null = null;
  for (let i = 0; i < AIRDESK_MAX_POLLS; i++) {
    const f = await fetchJson<AirdeskResult>(`${AIRDESK}/api/frontier/task-${workflowId}`);
    if (f.ok && f.data.status === 'awaiting_signature') {
      frontier = f.data;
      break;
    }
    if (!f.ok) return { service: 'airdesk', ok: false, hash: '', data: null, error: f.error };
    await new Promise(r => setTimeout(r, AIRDESK_POLL_INTERVAL));
  }
  if (!frontier) return { service: 'airdesk', ok: false, hash: '', data: null, error: 'timed out waiting for awaiting_signature' };

  const sign = await fetchJson<{ status: string }>(`${AIRDESK}/api/dev-sign/${workflowId}`, {
    signature: 'loopup-demo-dev-signature',
    signer: 'loopup-demo-dev',
  });
  if (!sign.ok) return { service: 'airdesk', ok: false, hash: '', data: null, error: sign.error };

  const finalFrontier = await fetchJson<AirdeskResult>(`${AIRDESK}/api/frontier/task-${workflowId}`);
  if (!finalFrontier.ok) return { service: 'airdesk', ok: false, hash: '', data: null, error: finalFrontier.error };

  const enrichedData = { ...finalFrontier.data, signedStatus: sign.data.status };
  const hash = contentHash(enrichedData);
  return { service: 'airdesk', ok: true, hash, data: enrichedData };
}