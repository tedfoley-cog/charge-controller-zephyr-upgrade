// Migration Console server: static files plus one read-only state endpoint.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(ROOT, '..');
const DATA = resolve(REPO, process.env.CONSOLE_DATA || 'migration');
const PORT = Number(process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

export async function loadState(dir = DATA) {
  const evidenceDir = join(dir, 'evidence');
  let files = [];
  try {
    files = (await readdir(evidenceDir)).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }
  const evidence = {};
  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    if (name === 'baseline' || name === 'current') continue;
    evidence[name] = await readJson(join(evidenceDir, file));
  }
  return {
    inventory: await readJson(join(dir, 'inventory.json')),
    plan: await readJson(join(dir, 'plan.json')),
    board: await readJson(join(dir, 'board.json')),
    baseline: await readJson(join(evidenceDir, 'baseline.json')),
    evidence,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
    res.end(JSON.stringify(await loadState()));
    return;
  }
  const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
  const path = join(ROOT, rel);
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // loopback only by default: the state API is unauthenticated
  server.listen(PORT, process.env.HOST || 'localhost', () => console.log(`Migration Console on http://localhost:${PORT} (data: ${DATA})`));
}
