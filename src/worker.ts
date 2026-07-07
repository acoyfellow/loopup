import { Hono } from 'hono';
import type { Env } from './types';
import { replayVerify } from './verifier';
import { LoopupRun } from './run';

export { LoopupRun };

const app = new Hono<{ Bindings: Env }>();

app.get('/api/status', (c) => c.json({ ok: true, service: 'loopup', timestamp: new Date().toISOString() }));

app.post('/api/runs', async (c) => {
  let body: { goal?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const goal = (body.goal ?? '').trim();
  if (!goal) return c.json({ error: 'goal required' }, 400);

  const doId = c.env.LOOPUP_RUN.newUniqueId();
  const stub = c.env.LOOPUP_RUN.get(doId);
  const runId = doId.toString();

  const initReq = new Request('http://fake/init', {
    method: 'POST',
    body: JSON.stringify({ id: runId, goal }),
  });
  await stub.fetch(initReq);

  const startReq = new Request('http://fake/start', { method: 'POST' });
  await stub.fetch(startReq);

  return c.json({ runId }, 201);
});

app.get('/api/runs/:id', async (c) => {
  const { id } = c.req.param();
  try {
    const doId = c.env.LOOPUP_RUN.idFromString(id);
    const stub = c.env.LOOPUP_RUN.get(doId);
    const stateReq = new Request('http://fake/state');
    const stateRes = await stub.fetch(stateReq);
    const runState = await stateRes.json();

    const replay = c.req.query('replay') === 'true';
    if (replay && (runState as any).status === 'completed') {
      const replayResult = await replayVerify(runState as any);
      return c.json({ run: runState, replay: replayResult });
    }

    return c.json({ run: runState });
  } catch (e) {
    return c.json({ error: 'run not found', detail: String(e) }, 404);
  }
});

app.post('/api/runs/:id/approve', async (c) => {
  const { id } = c.req.param();
  let body: { artifactHash?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  try {
    const doId = c.env.LOOPUP_RUN.idFromString(id);
    const stub = c.env.LOOPUP_RUN.get(doId);
    const req = new Request('http://fake/approve', {
      method: 'POST',
      body: JSON.stringify({ artifactHash: body.artifactHash }),
    });
    const res = await stub.fetch(req);
    const data = await res.json();
    return c.json(data, res.status);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.post('/api/runs/:id/dev-sign', async (c) => {
  const { id } = c.req.param();
  let body: { artifactHash?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  try {
    const doId = c.env.LOOPUP_RUN.idFromString(id);
    const stub = c.env.LOOPUP_RUN.get(doId);
    const req = new Request('http://fake/dev-sign', {
      method: 'POST',
      body: JSON.stringify({ artifactHash: body.artifactHash }),
    });
    const res = await stub.fetch(req);
    const data = await res.json();
    return c.json(data, res.status);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.post('/api/runs/:id/deny', async (c) => {
  const { id } = c.req.param();
  let body: { reason?: string } = {};
  try {
    body = await c.req.json();
  } catch {}
  try {
    const doId = c.env.LOOPUP_RUN.idFromString(id);
    const stub = c.env.LOOPUP_RUN.get(doId);
    const req = new Request('http://fake/deny', {
      method: 'POST',
      body: JSON.stringify({ reason: body.reason }),
    });
    const res = await stub.fetch(req);
    const data = await res.json();
    return c.json(data, res.status);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.get('/api/runs/:id/ws', async (c) => {
  const { id } = c.req.param();
  try {
    const doId = c.env.LOOPUP_RUN.idFromString(id);
    const stub = c.env.LOOPUP_RUN.get(doId);
    const wsReq = new Request('http://fake/ws');
    const res = await stub.fetch(wsReq);
    return res;
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.post('/api/compose', async (c) => {
  let body: { northStar?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const northStar = (body.northStar ?? '').trim();
  if (!northStar) return c.json({ error: 'northStar required' }, 400);

  const doId = c.env.LOOPUP_RUN.newUniqueId();
  const stub = c.env.LOOPUP_RUN.get(doId);
  const runId = doId.toString();

  const initReq = new Request('http://fake/init', {
    method: 'POST',
    body: JSON.stringify({ id: runId, goal: northStar }),
  });
  await stub.fetch(initReq);

  const startReq = new Request('http://fake/start', { method: 'POST' });
  await stub.fetch(startReq);

  return c.json({ runId }, 201);
});

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;