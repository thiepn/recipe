import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { checkSite } from '../scripts/check-site.mjs';

async function withSite(manifest, callback) {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/release.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(manifest));
    } else if (path === '/assets/app.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end('/* fixture */ const fixture = true; '.repeat(8));
    } else if (path === '/assets/app.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end('body { color: black; background: white; } '.repeat(8));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end('<!doctype html><html><head><title>Recipe</title>' +
        '<link href="/assets/app.css" rel="stylesheet"></head>' +
        '<body><div>Recipe</div><script src="/assets/app.js"></script></body></html>');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('smoke checks route fallback, real linked assets and expected deployment SHA', async () => {
  await withSite({app:'recipe',commit:'abc123',branch:'test'}, async url => {
    const checked = await checkSite(url, 'abc123', 1);
    assert.equal(checked.commit, 'abc123');
  });
});

test('rejects a wrong deployed SHA', async () => {
  await withSite({app:'recipe',commit:'stale'}, async url => {
    await assert.rejects(checkSite(url,'expected',1), /Release mismatch/);
  });
});

test('rejects another app even when no SHA was specified', async () => {
  await withSite({app:'not-recipe',commit:'abc123'}, async url => {
    await assert.rejects(checkSite(url,'',1), /Invalid Recipe release manifest/);
  });
});

test('rejects a missing commit', async () => {
  await withSite({app:'recipe',commit:42}, async url => {
    await assert.rejects(checkSite(url,'',1), /Invalid Recipe release manifest/);
  });
});
