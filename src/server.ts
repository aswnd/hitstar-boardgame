import { serve } from 'bun';
import { join } from 'path';
import { networkInterfaces } from 'os';
import { Game } from './game';
import type { ClientMessage } from './types';

function getLocalIP(): string {
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();
const PORT = Number(process.env.PORT ?? 3000);

const game = new Game();
const ROOT = join(import.meta.dir, '..');

serve({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === '/ip') {
      return new Response(LOCAL_IP, { headers: { 'Content-Type': 'text/plain' } });
    }

    if (url.pathname === '/ws') {
      const ok = server.upgrade(req, { data: { id: crypto.randomUUID() } });
      if (ok) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    if (url.pathname === '/tv') {
      return new Response(Bun.file(join(ROOT, 'public/tv.html')));
    }

    if (url.pathname === '/react' || url.pathname === '/controller-react') {
      return new Response(Bun.file(join(ROOT, 'public/react-app.html')));
    }

    if (url.pathname === '/tv-react') {
      return new Response(Bun.file(join(ROOT, 'public/tv-react.html')));
    }

    if (url.pathname.startsWith('/react/')) {
      const file = Bun.file(join(ROOT, 'public', url.pathname));
      if (await file.exists()) return new Response(file);
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname.startsWith('/songs/') || url.pathname.startsWith('/previews/')) {
      const file = Bun.file(join(ROOT, url.pathname));
      if (!await file.exists()) return new Response('Not found', { status: 404 });

      const total = file.size;
      const rangeHeader = req.headers.get('range');

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        const start = match?.[1] ? parseInt(match[1]) : 0;
        const end   = match?.[2] ? parseInt(match[2]) : total - 1;
        const chunk = await file.slice(start, end + 1).arrayBuffer();
        return new Response(chunk, {
          status: 206,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(end - start + 1),
          },
        });
      }

      return new Response(file, {
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Type': 'audio/mpeg',
        },
      });
    }

    return new Response(Bun.file(join(ROOT, 'public/controller.html')));
  },

  websocket: {
    open(ws) {
      game.addConnection(ws);
    },

    message(ws, raw) {
      try {
        const msg = JSON.parse(raw as string) as ClientMessage;
        game.handleMessage(ws, msg);
      } catch {
        // ignore malformed messages
      }
    },

    close(ws) {
      game.removeConnection(ws);
    },
  },
});

console.log(`Hitstar running on http://localhost:${PORT}`);
console.log(`  TV:              http://${LOCAL_IP}:${PORT}/tv`);
console.log(`  Controller:      http://${LOCAL_IP}:${PORT}/`);
console.log(`  React TV:         http://${LOCAL_IP}:${PORT}/tv-react`);
console.log(`  React Controller: http://${LOCAL_IP}:${PORT}/react`);
