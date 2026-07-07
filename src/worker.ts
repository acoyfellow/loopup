import { Hono } from 'hono';
import { compose } from './orchestrator';
import { verify } from './verifier';

const app = new Hono();

app.get('/', (c) => c.json({ service: 'loopup', status: 'ok' }));

app.post('/api/compose', async (c) => {
  const { northStar } = await c.req.json();
  if (!northStar) return c.json({ error: 'northStar required' }, 400);
  const sessionId = `worker-${Date.now()}`;
  const receipt = await compose(northStar, sessionId);
  const verification = await verify(receipt);
  return c.json({ receipt, verification });
});

app.get('/api/status', (c) => c.json({ ok: true, timestamp: new Date().toISOString() }));

export default app;