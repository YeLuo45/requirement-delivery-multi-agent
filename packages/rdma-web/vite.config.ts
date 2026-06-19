import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rdmaApiPlugin } from './src/vite-plugin';

// RDMA data root — matches where the CLI writes proposals.
// Walk up from the cwd (which is the web package) to the monorepo root,
// then into .rdma/data.
function findDataRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      const content = fs.readFileSync(pkgPath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null && 'workspaces' in parsed) {
        return path.join(dir, '.rdma', 'data');
      }
    } catch {
      // continue
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), '.rdma', 'data');
}

const dataRoot = findDataRoot();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), rdmaApiPlugin(dataRoot)],
  server: {
    port: 5173,
    fs: { allow: ['../..'] },
  },
  preview: {
    port: 4173,
    fs: { allow: ['../..'] },
  },
});