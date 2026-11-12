import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createRequire } from 'module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
      for (const k of ['CONVEX_URL', 'SERVER_SHARED_SECRET', 'ALLOW_GUESTS', 'DEV_BOTS', 'MAP_ROTATION']) {
        if (env[k] !== undefined && process.env[k] === undefined) process.env[k] = env[k];
      }
    },
    // Same live-map tag the production server adds (see injectLiveMap). Dev
    // server only: `vite build` must not bake a map into dist/index.html.
    transformIndexHtml(html, ctx) {
      return ctx.server ? require('./server.js').injectLiveMap(html) : html;
    },
    configureServer(server) {
      const { attachGame } = require('./server.js');
      // Dev only: stand up practice dummies to test combat solo. DEV_BOTS=0 disables.
      if (server.httpServer) attachGame(server.httpServer, { bots: Number(process.env.DEV_BOTS ?? 6) });
    },
  };
}

// Dev only: the game POSTs a PNG of the current view here (P in play, see
// src/screenshot.ts) and it lands in ./screenshots. The server picks the file
// name — the client only suggests the map — so nothing outside that folder can
// be written, and anything that isn't a PNG is refused.
const SHOT_DIR = 'screenshots';
const SHOT_MAX = 64 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function screenshotSink(): Plugin {
  return {
    name: 'aldermoor-screenshot-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__screenshot', (req, res) => {
        const reply = (status: number, body: object) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'POST a PNG' });

        const chunks: Buffer[] = [];
        let size = 0, refused = false;
        req.on('data', (chunk: Buffer) => {
          if (refused) return;
          size += chunk.length;
          if (size > SHOT_MAX) { refused = true; reply(413, { error: 'too large' }); return; }
          chunks.push(chunk);
        });
        req.on('end', async () => {
          if (refused) return;
          const png = Buffer.concat(chunks);
          if (!png.subarray(0, 8).equals(PNG_MAGIC)) return reply(400, { error: 'not a PNG' });

          const query = new URL(req.url ?? '', 'http://localhost').searchParams;
          const map = (query.get('map') ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'shot';
          const d = new Date(), p2 = (n: number, w = 2) => String(n).padStart(w, '0');
          const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-` +
            `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-${p2(d.getMilliseconds(), 3)}`;
          const file = path.join(SHOT_DIR, `${map}-${stamp}.png`);
          try {
            await mkdir(path.join(server.config.root, SHOT_DIR), { recursive: true });
            await writeFile(path.join(server.config.root, file), png);
            reply(200, { path: file });
          } catch (err) {
            reply(500, { error: String(err) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [gameServer(), screenshotSink()],
  server: {
    port: Number(process.env.PORT) || 5173,
  },
});
