/**
 * A fake Jetson, serving the §7.4 API from the fixtures.
 *
 *   npm run station
 *
 * The point of this file: §12 item 1 says no connectivity demo is possible
 * until the Jetson WiFi hardware is ordered. That blocks the *radio*, not the
 * protocol — localhost is a link. The delta pull, the cursor, idempotence and
 * resumability can all be exercised and fixed today, against this, and the app
 * cannot tell the difference except where we make sure it can (see below).
 *
 * It serves the fixtures, which are invented. So every advisory response
 * carries `x-aegis-simulated: true`, and the app stores anything pulled from
 * here as origin 'fixture' and labels it SAMPLE DATA. A simulator that let
 * invented numbers arrive looking measured would be building failure pattern #1
 * into the test rig.
 *
 * Flags:
 *   --port 8080     listen port
 *   --flaky         fail ~1 request in 3, to exercise resumability
 *   --slow 800      delay each response by N ms
 */

import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};

const PORT = Number(flag('port', 8080));
const FLAKY = argv.includes('--flaky');
const SLOW = Number(flag('slow', 0));

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url).href);

const advisories = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(FIXTURE_DIR + f, 'utf8')))
  // The manifest is ordered oldest-first so a cursor can walk forward through
  // it, exactly as the real station's would be.
  .sort((a, b) => a.generated_at_utc.localeCompare(b.generated_at_utc));

let acked = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const send = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (SLOW) await sleep(SLOW);

  if (FLAKY && Math.random() < 0.33 && path.startsWith('/api/v1/advisory/')) {
    console.log(`  ✗ ${path} — simulated failure`);
    res.writeHead(503).end();
    return;
  }

  console.log(`  → ${req.method} ${path}${url.search}`);

  if (path === '/api/v1/health') {
    return send(res, 200, {
      device: 'fake-field-station',
      advisory_count: advisories.length,
      storage_free_kb: 29847,
      gps_time_valid: true,
      simulated: true,
    });
  }

  if (path === '/api/v1/manifest') {
    const since = url.searchParams.get('since');
    // Cursor semantics: everything strictly after the acknowledged id.
    const start = since ? advisories.findIndex((a) => a.advisory_id === since) + 1 : 0;
    const slice = advisories.slice(start);
    return send(res, 200, {
      advisories: slice.map((a) => ({
        advisory_id: a.advisory_id,
        generated_at_utc: a.generated_at_utc,
        bytes: Buffer.byteLength(JSON.stringify(a)),
      })),
      count: slice.length,
      simulated: true,
    });
  }

  if (path.startsWith('/api/v1/advisory/')) {
    const id = decodeURIComponent(path.slice('/api/v1/advisory/'.length));
    const found = advisories.find((a) => a.advisory_id === id);
    if (!found) return send(res, 404, { error: `no advisory ${id}` });
    // The header that keeps the app honest about what it just received.
    return send(res, 200, found, { 'x-aegis-simulated': 'true' });
  }

  if (path === '/api/v1/ack' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      acked = JSON.parse(body).upto ?? null;
    } catch {
      return send(res, 400, { error: 'bad JSON' });
    }
    console.log(`  ✓ cursor acknowledged up to ${acked}`);
    return send(res, 200, { acked_upto: acked });
  }

  send(res, 404, { error: `no route ${path}` });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nFake field station on http://0.0.0.0:${PORT}`);
  console.log(`  serving ${advisories.length} advisories, all marked simulated`);
  if (FLAKY) console.log('  --flaky: ~1 in 3 advisory fetches will fail');
  if (SLOW) console.log(`  --slow: ${SLOW}ms per response`);
  console.log('\nPoint the app at this address in the field station screen.');
  console.log('On a physical phone use this machine\'s LAN IP, not 192.168.4.1.\n');
});
