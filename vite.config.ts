import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'recipe-release-provenance',
      apply: 'build',
      generateBundle() {
        const sha = process.env.VERCEL_GIT_COMMIT_SHA ||
          process.env.GITHUB_SHA || 'unknown';
        const branch = process.env.VERCEL_GIT_COMMIT_REF ||
          process.env.GITHUB_REF_NAME || 'local';
        this.emitFile({
          type: 'asset',
          fileName: 'release.json',
          source: JSON.stringify({
            app: 'recipe',
            commit: sha,
            branch,
            builtAt: new Date().toISOString(),
          }, null, 2) + '\n',
        });
      },
    },
  ],
  server: { port: 5173 },
  build: { target: 'es2022' },
});
