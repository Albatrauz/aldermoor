import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createRequire } from 'module';

// server.js is CommonJS (it's also the production server). Load it through
// createRequire so Vite's config bundler doesn't try to inline its Node
// `require()`s — we just want the game-mounting helper at runtime.
const require = createRequire(import.meta.url);

// Mount the multiplayer WebSocket game on Vite's own dev server. The game
// listens on the `/ws` path, while Vite's HMR socket keeps the root path, so
// the two share a single port — no second process, no proxy. In production the
// same `attachGame` is hosted by server.js (`npm start`).
function gameServer(): Plugin {
  return {
    name: 'aldermoor-game-server',
    // Vite exposes only VITE_-prefixed vars (to the browser, via import.meta.env)
    // and never populates process.env from the .env files. But the game server
    // below is plain Node — it reads CONVEX_URL / SERVER_SHARED_SECRET off
    // process.env to write stats. Without this, dev stat flushes silently no-op
    // (convex stays null) even with .env.local filled in. Load the env files and
    // copy the server-side keys across, letting a real shell export win.
    config(_config, { mode }) {
      const env = loadEnv(mode, process.cwd(), '');
      for (const k of ['CONVEX_URL', 'SERVER_SHARED_SECRET', 'ALLOW_GUESTS', 'DEV_BOTS']) {
        if (env[k] !== undefined && process.env[k] === undefined) process.env[k] = env[k];
      }
    },
    configureServer(server) {
      const { attachGame } = require('./server.js');
      // Dev only: stand up practice dummies to test combat solo. DEV_BOTS=0 disables.
      if (server.httpServer) attachGame(server.httpServer, { bots: Number(process.env.DEV_BOTS ?? 6) });
    },
  };
}

export default defineConfig({
  plugins: [gameServer()],
  server: {
    port: Number(process.env.PORT) || 5173,
  },
});
