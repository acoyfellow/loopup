import { defineAlchemy } from '@cloudflare/alchemy';

export default defineAlchemy({
  app: 'loopup',
  deploy: {
    worker: {
      path: 'src/worker.ts',
      site: 'site/public',
    },
  },
});