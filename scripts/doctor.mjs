#!/usr/bin/env node
/**
 * `scripts/doctor.mjs`
 *
 * Health check for the repo. Reports:
 *   - Node version >= 20
 *   - devDependencies installed (vite, @vitejs/plugin-react, tsx, biome)
 *   - @rdma/* workspace packages resolvable
 *   - node --import tsx can import a TypeScript file
 *   - key CLI commands resolve to a real file (rdma, vite, etc.)
 *
 * Exits non-zero when at least one check fails.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const results = [];

function pass(name, detail) {
  results.push({ ok: true, name, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  results.push({ ok: false, name, detail });
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('== rdma doctor ==\n');

// 1. Node version
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) {
  pass(`Node ${process.versions.node}`, '>= 20');
} else {
  fail(`Node ${process.versions.node}`, 'must be >= 20');
}

// 2. devDependencies installed (search recursively under repoRoot/node_modules)
const expectedDevDeps = [
  'vite',
  '@vitejs/plugin-react',
  'tsx',
  '@biomejs/biome',
  'typescript',
  '@types/node',
];
function findInNodeModules(dep) {
  // Walk the repo, but for any directory named `node_modules`, do not
  // descend further (workspace packages tend to keep their own
  // node_modules there too). Just look for `${dep}/package.json`
  // inside each `node_modules` we encounter.
  const { readdirSync } = require('node:fs');
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name === 'node_modules') {
        const candidate = path.join(full, dep, 'package.json');
        if (existsSync(candidate)) out.push(candidate);
        // Don't descend into nested node_modules.
        continue;
      }
      if (e.name.startsWith('.')) continue;
      out.push(...walk(full));
    }
    return out;
  }
  const matches = [...walk(repoRoot), ...walk(path.join(repoRoot, 'packages/rdma-web'))];
  return matches[0] ?? null;
}
for (const dep of expectedDevDeps) {
  const pkgPath = findInNodeModules(dep);
  if (pkgPath) {
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const rel = path.relative(repoRoot, pkgPath).split(path.sep)[0];
    pass(`devDependency: ${dep}@${pkgJson.version}`, `(installed in ${rel})`);
  } else {
    fail(
      `devDependency: ${dep}`,
      'not installed; run `npm install --include=dev --ignore-scripts`',
    );
  }
}

// 3. workspace packages resolvable
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (dep.startsWith('@rdma/')) {
    try {
      const resolved = require.resolve(`${dep}/package.json`, { paths: [repoRoot] });
      pass(`workspace: ${dep}`, path.relative(repoRoot, resolved));
    } catch {
      fail(`workspace: ${dep}`, 'not built; run `npm install`');
    }
  }
}

// 4. TypeScript import via tsx works
{
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(path.join(tmpdir(), 'rdma-doctor-'));
  const probe = path.join(dir, 'probe.ts');
  writeFileSync(probe, 'export const x: number = 1 + 2;\n', 'utf8');
  // Use a small wrapper script (not `-e`) so tsx can resolve the path
  // through its on-disk loader without parsing the inline code path.
  const wrapper = path.join(dir, 'run.mjs');
  writeFileSync(
    wrapper,
    `import(${JSON.stringify(probe)}).then((m) => {\n      if (m.x !== 3) { console.error('x =', m.x); process.exit(2); }\n    }).catch((e) => { console.error(e); process.exit(3); });\n`,
    'utf8',
  );
  const result = spawnSync(process.execPath, ['--import', 'tsx', wrapper], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  rmSync(dir, { recursive: true, force: true });
  if (result.status === 0) {
    pass('tsx runtime', 'Node can --import tsx and import a typed module');
  } else {
    fail(
      'tsx runtime',
      result.stderr?.split('\n').slice(0, 3).join(' / ') || `exit ${result.status}`,
    );
  }
}

// 5. key CLI binaries on disk
const bins = ['node_modules/.bin/vite', 'node_modules/.bin/tsc', 'node_modules/.bin/biome'];
for (const bin of bins) {
  const full = path.join(repoRoot, bin);
  if (existsSync(full)) {
    const mode = statSync(full).mode;
    if (mode & 0o111) {
      pass(`binary: ${bin}`, 'executable');
    } else {
      fail(`binary: ${bin}`, 'not executable');
    }
  } else {
    fail(`binary: ${bin}`, 'missing');
  }
}

// 6. README smoke command exists
{
  const smoke = path.join(repoRoot, 'scripts/smoke-serve.mjs');
  if (existsSync(smoke)) {
    pass('smoke: scripts/smoke-serve.mjs', 'present');
  } else {
    fail('smoke: scripts/smoke-serve.mjs', 'missing');
  }
}

const ok = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`\nDoctor: ${ok}/${total} checks passed.`);
if (ok !== total) {
  process.exit(1);
}
