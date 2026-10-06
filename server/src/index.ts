import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createAuthRouter, getAuthConfig, requireAuth } from './auth';
import { createApiRouter } from './routes';
import { seedStore } from './seed';
import { newStore, type Store } from './store';

const PORT = Number(process.env.PORT || 4000) || 4000;

export function createApp(store: Store): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json());
  const authConfig = getAuthConfig();
  app.use('/api', createAuthRouter(authConfig));
  app.use('/api', createApiRouter(store, requireAuth(authConfig)));

  // Serve the built client when it exists, so `npm run build && npm start`
  // gives a single process serving the whole app.
  const candidates = [
    path.join(__dirname, '..', '..', 'web', 'dist'),
    path.join(__dirname, '..', '..', '..', 'web', 'dist'),
    path.join(__dirname, '..', '..', '..', '..', 'web', 'dist'),
    path.join(process.cwd(), 'web', 'dist'),
    path.join(process.cwd(), '..', 'web', 'dist'),
  ];
  const webDist = candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));
  if (webDist) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  return app;
}

export function buildStore(): Store {
  const store = newStore();
  seedStore(store);
  return store;
}

if (require.main === module) {
  const store = buildStore();
  const app = createApp(store);
  app.listen(PORT, () => {
    console.log(`FreightDesk API listening on http://localhost:${PORT}`);
    console.log(`Seeded ${store.vendors.length} vendors, ${store.rateCard.length} rate card rows, ${store.requirements.length} requirements`);
  });
}
