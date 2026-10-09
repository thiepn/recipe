import { pathToFileURL } from 'node:url';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function get(base, path) {
  const url = new URL(path, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'Accept': '*/*' },
      cache: 'no-store',
    });
    if (!response.ok)
      throw new Error(`${url} returned HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Static release gate; does not log in, send credentials or mutate cookbook
 * data. Production auth and account-backed functions require separate testing.
 */
export async function checkSite(baseUrl, expectedSha = '', attempts = 20) {
  const origin = new URL(baseUrl);
  if (!['http:', 'https:'].includes(origin.protocol))
    throw new Error('RECIPE_SITE_URL must use HTTP(S)');

  let manifest;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await get(origin, '/release.json');
      manifest = await response.json();
      if (manifest.app !== 'recipe' || typeof manifest.commit !== 'string')
        throw new Error('Invalid Recipe release manifest');
      if (expectedSha && manifest.commit !== expectedSha)
        throw new Error(`Release mismatch: expected ${expectedSha}, deployed ${manifest.commit}`);
      break;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(1000);
    }
  }
  if (!manifest || (expectedSha && manifest.commit !== expectedSha))
    throw lastError ?? new Error('Release manifest unavailable');

  const routes = ['/', '/recipes', '/collections', '/cook', '/plan', '/auth/callback'];
  let html = '';
  for (const route of routes) {
    const response = await get(origin, route);
    const contentType = response.headers.get('content-type') ?? '';
    const content = await response.text();
    if (!contentType.includes('text/html') ||
        !/<!doctype html>/i.test(content) || !content.includes('Recipe'))
      throw new Error(`Unexpected SPA response at ${route}`);
    if (route === '/') html = content;
  }

  const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)]
    .map(match => match[1]);
  if (!paths.length) throw new Error('App shell is missing JavaScript/CSS assets');
  for (const asset of new Set(paths)) {
    const response = await get(origin, asset);
    const type = response.headers.get('content-type') ?? '';
    if (!(/javascript|css/.test(type)))
      throw new Error(`Unexpected asset MIME type for ${asset}: ${type}`);
    const contents = await response.arrayBuffer();
    if (contents.byteLength < 100)
      throw new Error(`Unexpectedly empty asset: ${asset}`);
  }

  console.log(JSON.stringify({
    result: 'PASS',
    origin: origin.origin,
    commit: manifest.commit,
    branch: manifest.branch,
    routesChecked: routes.length,
    assetsChecked: new Set(paths).size,
  }, null, 2));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkSite(
    process.env.RECIPE_SITE_URL || 'https://recipe.thiepn.dev',
    process.env.RECIPE_EXPECTED_SHA || '',
    20,
  ).catch(error => {
    console.error('Recipe site smoke FAILED:', error);
    process.exitCode = 1;
  });
}
