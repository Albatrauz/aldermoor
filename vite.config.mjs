import { defineConfig } from 'vite';
import { createRequire } from 'module';

// server.js is CommonJS (it's also the production server). Load it through
// createRequire so Vite's config bundler doesn't try to inline its Node
// `require()`s — we just want the game-mounting helper at runtime.
const require = createRequire(import.meta.url);

// Mount the multiplayer WebSocket game on Vite's own dev server. The game
// listens on the `/ws` path, while Vite's HMR socket keeps the root path, so
// the two share a single port — no second process, no proxy. In production the
// same `attachGame` is hosted by server.js (`npm start`).
function gameServer() {
  return {
    name: 'aldermoor-game-server',
    configureServer(server) {
      const { attachGame } = require('./server.js');
      if (server.httpServer) attachGame(server.httpServer);
    },
  };
}

export default defineConfig({
  plugins: [gameServer()],
  server: {
    port: Number(process.env.PORT) || 5173,
  },
});
