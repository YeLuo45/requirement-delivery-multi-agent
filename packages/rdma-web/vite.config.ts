import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { rdmaApiPlugin } from './src/vite-plugin';

// RDMA data root — matches where the CLI writes proposals.
// Walk up from the cwd (which is the web package) to the monorepo root,
// then into .rdma/data. Falls back to a public demo dataset shipped with
// the web bundle when no real data is present (GitHub Pages deployment
// uses this fallback).
function findMonorepoRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      const content = fs.readFileSync(pkgPath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null && 'workspaces' in parsed) {
        return dir;
      }
    } catch {
      // continue
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const monorepoRoot = findMonorepoRoot();
const dataRoot = monorepoRoot
  ? path.join(monorepoRoot, '.rdma', 'data')
  : path.join(process.cwd(), '.rdma', 'data');

// Base path:
// - In dev mode (npm run dev), serve from "/" for hot reload to work.
// - On GitHub Pages, the repo is at /<repo-name>/, so Vite needs base: '/<repo-name>/'.
// We detect the deployment target via RDMA_DEPLOY_TARGET env var.
const base =
  process.env.RDMA_DEPLOY_TARGET === 'github-pages' ? '/requirement-delivery-multi-agent/' : '/';

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), rdmaApiPlugin(dataRoot)],
  server: {
    port: 5173,
    fs: { allow: ['../..'] },
  },
  preview: {
    port: 4173,
    fs: { allow: ['../..'] },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
