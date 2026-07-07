import { Hono } from 'hono';
import { compose } from './orchestrator';
import { verify } from './verifier';

type Env = { ASSETS: { fetch: (req: Request) => Promise<Response> } };

const app = new Hono<{ Bindings: Env }>();

app.get('/api/status', (c) => c.json({ ok: true, service: 'loopup', timestamp: new Date().toISOString() }));

app.post('/api/compose', async (c) => {
  let body: { northStar?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const northStar = (body.northStar ?? '').trim();
  if (!northStar) return c.json({ error: 'northStar required' }, 400);
  const sessionId = `web-${Date.now()}`;
  const receipt = await compose(northStar, sessionId);
  const verification = await verify(receipt);
  return c.json({ receipt, verification });
});

// Everything else → static assets (index.html, manifest, favicon).
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;