#!/usr/bin/env node
/**
 * Regenerate demo data for the deployed web dashboard.
 *
 * Run before each release that updates the demo content. The output lives
 * under packages/rdma-web/public/demo-data/ and is served as a static
 * fallback by the web app when the live /api/proposals endpoint is
 * unavailable (which is the case for the GitHub Pages deployment).
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  console.log('[demo-data] regenerating demo dataset...');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(projectRoot, 'scripts', 'seed-demo-data.mjs')],
      { stdio: 'inherit' },
    );
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`seed-demo-data exited with code ${code}`));
    });
    child.on('error', reject);
  });
  const out = path.join(projectRoot, 'packages', 'rdma-web', 'public', 'demo-data');
  const entries = await fs.readdir(out);
  console.log(`[demo-data] wrote ${entries.length} files to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
