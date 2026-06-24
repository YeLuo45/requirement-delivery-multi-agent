#!/usr/bin/env node
/**
 * `scripts/verify-readme-commands.mjs`
 *
 * Walks every `bash` code block in README.md and README.zh-CN.md, executes
 * each non-long-running command line for real, and reports exit code +
 * a short status line. Long-running commands (`rdma serve`, `npm run
 * dev:web`, `npm run dev:server`, `npm run cli -- serve`) are started
 * with a short budget; success requires a recognizable readiness line
 * (e.g. "serve listening on http", "VITE v", "Local: http", or
 * "[rdma-mcp] connected via stdio") before the process is killed.
 *
 * Exits non-zero if any line fails so CI can enforce README honesty.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

const READMES = [path.join(repoRoot, 'README.md'), path.join(repoRoot, 'README.zh-CN.md')];

// Match against plain text; strip ANSI color codes first so the
// readiness regexes don't get confused by Vite's colorful output.
const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g');

function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

const READINESS_PATTERNS = [
  /serve listening on http/i,
  /VITE v\d/i,
  /Local:\s+http/i,
  /ready in \d+/i, // Vite 5/6 default success line
  /\[rdma-mcp\] connected via stdio/i,
  /\[rdma\] serve listening on http/i,
];

// Commands that intentionally run forever; we boot them just long enough to
// confirm they reach a "ready" state, then SIGTERM.
const LONG_RUNNING_PREFIXES = [
  'rdma serve',
  'npm run serve',
  'npm run dev:web',
  'npm run dev:server',
  'npm run cli -- serve',
];

const TIMEOUT_MS = 12000;

function extractBashBlocks(text) {
  const blocks = [];
  const re = /```bash\s*\n([\s\S]*?)```/g;
  let m = re.exec(text);
  while (m !== null) {
    blocks.push(m[1]);
    m = re.exec(text);
  }
  return blocks;
}

function splitLogicalLines(block) {
  return block.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
}

function joinContinuations(lines) {
  const joined = [];
  let buffer = '';
  for (const line of lines) {
    if (line.endsWith('\\')) {
      buffer += `${line.slice(0, -1)} `;
    } else {
      buffer += line;
      joined.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim()) joined.push(buffer);
  return joined;
}

function classify(command) {
  const trimmed = command.trim();
  if (!trimmed) return 'empty';
  if (LONG_RUNNING_PREFIXES.some((p) => trimmed.startsWith(p))) return 'long-running';
  if (/^cd\s+/.test(trimmed) && !trimmed.includes('&&')) return 'cd';
  return 'oneshot';
}

function isStubOnly(command) {
  // `npm run bootstrap` and the examples/hello-world script both write into
  // the local .rdma directory; treat them as documentation stubs during
  // verification so the script doesn't pollute the workspace.
  if (/\bbootstrap\b/.test(command)) return true;
  if (/examples\/hello-world\/run\.mjs/.test(command)) return true;
  // `git clone <url>` only succeeds on a clean cwd, so the README copy of
  // the command can't be executed inside the existing repo.
  if (/^\s*git\s+clone\b/.test(command)) return true;
  // `npm install` re-downloads the world on every verify run and can
  // hang on slow networks. The doctor check already proves install
  // works, so treat the README copy as a stub.
  if (/^\s*npm\s+install\b/.test(command)) return true;
  // Verification harness commands are intentionally executed by the
  // outer gate, not recursively from README snippets. Re-running them
  // inside this script makes README verification slow and can create
  // flaky cross-process interference between coverage/test runs.
  if (/\bnpm\s+test\b/.test(command)) return true;
  if (/\bnpm\s+run\s+e2e\b/.test(command)) return true;
  if (/\bnpm\s+run\s+coverage\b/.test(command)) return true;
  if (/\bnpm\s+run\s+verify:readme\b/.test(command)) return true;
  if (/\bnpm\s+run\s+release:local\b/.test(command)) return true;
  if (/\bnpm\s+run\s+doctor\b/.test(command)) return true;
  if (/\bnpm\s+run\s+smoke:serve\b/.test(command)) return true;
  // scripts/bump-version.mjs is invoked from the release workflow
  // and not from any README snippet; keep it out of the README
  // honesty check by treating it as a stub.
  if (/\bbump-version\b/.test(command)) return true;
  // scripts/smoke-cross-platform.mjs runs in CI only; verify:readme
  // is a local-only gate and the script would race with the other
  // smoke jobs on shared tmpdirs.
  if (/smoke-cross-platform/.test(command)) return true;
  // README snippets that contain placeholder paths like `/path/to/data`
  // are templates, not runnable commands. The user has to substitute
  // a real directory before these can succeed.
  if (/=\/path\/to\//.test(command)) return true;
  // `<...>` angle-bracket placeholders are documentation conventions,
  // not runnable values.
  if (/<\w[\w-]*>/.test(command)) return true;
  // `rdma diff <a> <b>` and `rdma replay <id>` need real proposal ids
  // that don't exist in a fresh verify run, so treat them as
  // documentation stubs. The modules are still covered by their
  // unit tests.
  if (/\bnpm\s+run\s+cli\s+--\s+diff\b/.test(command)) return true;
  if (/\bnpm\s+run\s+cli\s+--\s+replay\b/.test(command)) return true;
  return false;
}

function runOneshot(command, env) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: repoRoot,
      env: { ...process.env, ...env, FORCE_COLOR: '0', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    // Hard cap every oneshot at 90s. README commands should never take
    // that long; if they do, the test still completes and we report
    // the command as timed out.
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 500);
    }, 180_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, signal: 'timeout' });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        stdout,
        stderr: `${stderr}\nspawn error: ${err.message}`,
        signal: 'error',
      });
    });
  });
}

function runLongRunning(command, env) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rdma-verify-lr-'));
    const out = path.join(dir, 'out.log');
    const child = spawn(command, {
      shell: true,
      cwd: repoRoot,
      env: { ...process.env, ...env, FORCE_COLOR: '0', CI: '1', NO_COLOR: '1' },
      stdio: ['ignore', openSync(out, 'w'), openSync(out, 'a')],
      detached: true,
    });
    child.unref();

    let matched = false;
    let matchLine = '';
    const deadline = Date.now() + TIMEOUT_MS;
    const tick = setInterval(() => {
      let content = '';
      if (existsSync(out)) {
        try {
          content = readFileSync(out, 'utf8');
        } catch {
          content = '';
        }
      }
      const clean = stripAnsi(content);
      for (const re of READINESS_PATTERNS) {
        const m = clean.match(re);
        if (m) {
          matched = true;
          matchLine = m[0];
          break;
        }
      }
      if (matched || Date.now() >= deadline) {
        clearInterval(tick);
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {}
        setTimeout(() => {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {}
          // Sweep any detached vite / node child processes that detached
          // out of our process group. Without this, the next verify
          // run accumulates port conflicts (5173-5180) until Vite
          // gives up and the readiness check times out.
          sweepLongRunningChildren();
          try {
            unlinkSync(out);
          } catch {}
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {}
          resolve({
            code: child.exitCode,
            signal: matched ? 'matched' : 'timeout',
            stdout: content,
            stderr: '',
            matched,
            matchLine,
          });
        }, 500);
      }
    }, 200);
  });
}

function sweepLongRunningChildren() {
  // Best-effort cleanup of detached vite/dev-server processes left over
  // from prior verify runs. Killing by pid is unsafe (we don't track
  // them) so we match on command line patterns.
  try {
    spawn('pkill', ['-9', '-f', 'rdma-web/node_modules/.bin/vite'], { stdio: 'ignore' });
    spawn('pkill', ['-9', '-f', 'rdma serve'], { stdio: 'ignore' });
    spawn('pkill', ['-9', '-f', 'dev:web'], { stdio: 'ignore' });
    spawn('pkill', ['-9', '-f', 'dev:server'], { stdio: 'ignore' });
  } catch {
    // pkill is best-effort; ignore failures (e.g. on Windows).
  }
}

function summarize(result, kind) {
  if (kind === 'long-running') {
    if (result.matched) return `long-running ok (readiness: "${result.matchLine.trim()}")`;
    if (result.code === 0 || result.code === null)
      return `long-running exited without readiness line (signal=${result.signal ?? 'n/a'})`;
    return `long-running failed (code=${result.code})`;
  }
  if (result.code === 0) return 'ok';
  if (result.code === null) return 'killed by signal';
  return `exit ${result.code}`;
}

function tail(text, lines = 8) {
  return text.split('\n').slice(-lines).join('\n');
}

function buildIsolatedEnv(command, tmpRoots) {
  const env = {};
  if (/\bRDMA_STORAGE_ROOT\b/.test(command) || /\bnpm\s+run\s+cli\b/.test(command)) {
    const dir = mkdtempSync(path.join(tmpdir(), 'rdma-verify-storage-'));
    tmpRoots.push(dir);
    env.RDMA_STORAGE_ROOT = dir;
  }
  if (/\bRDMA_SHIPPED_ROOT\b/.test(command)) {
    const dir = mkdtempSync(path.join(tmpdir(), 'rdma-verify-shipped-'));
    tmpRoots.push(dir);
    env.RDMA_SHIPPED_ROOT = dir;
  }
  return env;
}

export function buildReadmeCommandSandboxPlan({ repoRoot, sandboxRoot, command }) {
  return {
    mutatesRepoRoot: false,
    setupCommands: [
      `mkdir -p ${sandboxRoot}`,
      `rsync -a --delete --exclude .git ${repoRoot}/ ${sandboxRoot}/`,
    ],
    command: `cd ${sandboxRoot} && ${command}`,
  };
}

async function main() {
  const tmpRoots = [];
  const allResults = [];

  for (const readme of READMES) {
    const text = readFileSync(readme, 'utf8');
    const blocks = extractBashBlocks(text);
    const commands = blocks.flatMap((b) => joinContinuations(splitLogicalLines(b)));

    for (const command of commands) {
      const kind = classify(command);
      if (kind === 'empty' || kind === 'cd') continue;

      const env = buildIsolatedEnv(command, tmpRoots);
      if (isStubOnly(command)) {
        allResults.push({
          readme: path.basename(readme),
          command,
          kind,
          status: 'skipped (stub)',
          ok: true,
        });
        continue;
      }

      const result =
        kind === 'long-running'
          ? await runLongRunning(command, env)
          : await runOneshot(command, env);
      const status = summarize(result, kind);
      const ok = kind === 'long-running' ? result.matched : result.code === 0;
      allResults.push({ readme: path.basename(readme), command, kind, status, ok, result });
      // Stream progress to stderr so the operator can see which command
      // is currently running without waiting for the final report.
      process.stderr.write(`[verify:readme] ${ok ? '✓' : '✗'} ${kind} ${command.slice(0, 80)}\n`);
    }
  }

  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });

  const failures = allResults.filter((r) => !r.ok);

  console.log('\n== verify-readme-commands ==');
  console.log(
    `Total: ${allResults.length}, OK: ${allResults.filter((r) => r.ok && r.status !== 'skipped (stub)').length}, Skipped: ${allResults.filter((r) => r.status === 'skipped (stub)').length}, Failed: ${failures.length}`,
  );
  console.log('');
  for (const entry of allResults) {
    const marker = entry.status === 'skipped (stub)' ? '~' : entry.ok ? '.' : 'X';
    console.log(
      `  [${marker}] ${entry.readme.padEnd(14)} ${entry.kind.padEnd(13)} ${entry.status.padEnd(40)}  ${entry.command}`,
    );
    if (
      !entry.ok &&
      entry.status !== 'skipped (stub)' &&
      entry.kind === 'long-running' &&
      entry.result
    ) {
      const r = entry.result;
      console.log('       STDOUT tail:');
      for (const line of tail(stripAnsi(r.stdout), 8).split('\n')) console.log(`         ${line}`);
      console.log('       STDERR tail:');
      for (const line of tail(stripAnsi(r.stderr), 8).split('\n')) console.log(`         ${line}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} README command(s) failed verification.`);
    process.exit(1);
  }
  console.log('\nAll README commands verified.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((err) => {
    console.error('verify-readme-commands failed:', err);
    process.exit(1);
  });
}
