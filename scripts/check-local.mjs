import { spawn } from 'node:child_process';
import { checkSite } from './check-site.mjs';

const args = [
  'node_modules/vite/bin/vite.js', 'preview',
  '--host', '127.0.0.1',
  '--port', '4173', '--strictPort',
];
const server = spawn(process.execPath, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});
let stderr = '';
server.stderr.on('data', chunk => { stderr += String(chunk).slice(-2000); });
let failed = false;
try {
  await checkSite(
    'http://127.0.0.1:4173',
    process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'unknown',
    30,
  );
} catch (error) {
  failed = true;
  console.error('Local release smoke failed:', error);
  if (stderr) console.error(stderr.slice(-2500));
} finally {
  server.kill('SIGTERM');
}
if (failed) process.exitCode = 1;
