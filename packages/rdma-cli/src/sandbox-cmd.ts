/**
 * `rdma sandbox apply` — apply a file patch inside an isolated proposal
 * sandbox and print a reviewable patch bundle summary.
 *
 * Flags:
 *   --workspace-root <path>   parent directory of proposal sandboxes
 *   --project <id>             project id (defaults to PRJ-20260621-001)
 *   --proposal <id>            proposal id (e.g. P-20260621-009)
 *   --files <path>=<content>  one or more files to write
 *   --test-command <cmd>       test command recorded in the patch bundle
 *
 * The command is intentionally read-only against the source tree: it
 * writes only under <workspaceRoot>/<projectId>/<proposalId>/ and
 * returns a summary line that the CLI consumer can pipe into CI.
 */

import path from 'node:path';

import {
  type DeliveryPlan,
  type DeliveryRequirement,
  type SandboxPatchFile,
  buildDeliveryPlan,
  buildSandboxPreview,
  executeSandboxPatch,
} from '@rdma/delivery-control';

export interface SandboxApplyParsedArgs {
  workspaceRoot: string;
  proposalId: string;
  projectId: string;
  testCommand: string;
  files: Array<SandboxPatchFile>;
  dryRun: boolean;
}

export interface SandboxApplyIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export function parseSandboxApplyArgs(argv: ReadonlyArray<string>): SandboxApplyParsedArgs {
  let workspaceRoot = '';
  let proposalId = '';
  let projectId = 'PRJ-20260621-001';
  let testCommand = 'npm test';
  let dryRun = false;
  const files: Array<SandboxPatchFile> = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace-root') {
      const next = argv[i + 1];
      if (typeof next === 'string') {
        workspaceRoot = next;
        i++;
      }
      continue;
    }
    if (arg === '--project') {
      const next = argv[i + 1];
      if (typeof next === 'string') {
        projectId = next;
        i++;
      }
      continue;
    }
    if (arg === '--proposal') {
      const next = argv[i + 1];
      if (typeof next === 'string') {
        proposalId = next;
        i++;
      }
      continue;
    }
    if (arg === '--test-command') {
      const next = argv[i + 1];
      if (typeof next === 'string') {
        testCommand = next;
        i++;
      }
      continue;
    }
    if (arg === '--files') {
      const next = argv[i + 1];
      if (typeof next === 'string') {
        const sep = next.indexOf('=');
        if (sep > 0) {
          files.push({ path: next.slice(0, sep), content: next.slice(sep + 1) });
        }
        i++;
      }
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { workspaceRoot, proposalId, projectId, testCommand, files, dryRun };
}

export function buildSandboxPlan(parsed: SandboxApplyParsedArgs): DeliveryPlan {
  const requirement: DeliveryRequirement = {
    proposalId: parsed.proposalId,
    projectId: parsed.projectId,
    title: 'sandbox apply',
    rawRequirement: 'apply sandbox patch via rdma sandbox apply',
    scope: 'medium',
    priority: 'P2',
  };
  return buildDeliveryPlan(requirement, {
    workspaceRoot: parsed.workspaceRoot,
    defaultTestCommand: parsed.testCommand,
  });
}

export async function cmdSandboxApply(
  argv: ReadonlyArray<string>,
  io: SandboxApplyIo,
): Promise<void> {
  const parsed = parseSandboxApplyArgs(argv);
  if (!parsed.workspaceRoot || !parsed.proposalId || parsed.files.length === 0) {
    io.stderr.write(
      'rdma sandbox apply: --workspace-root, --proposal, and at least one --files are required\n',
    );
    return;
  }

  const plan = buildSandboxPlan(parsed);
  if (parsed.dryRun) {
    const preview = buildSandboxPreview(parsed);
    if (!preview.allowed) {
      io.stderr.write(`rdma sandbox apply: ${preview.reason}\n`);
      return;
    }
    io.stdout.write(`sandbox preview for ${parsed.proposalId} (dry-run)\n`);
    io.stdout.write(`  path: ${plan.sandbox.path}\n`);
    io.stdout.write(`  files: ${preview.writtenFiles.length}\n`);
    for (const file of preview.writtenFiles) {
      io.stdout.write(`    ${path.relative(plan.sandbox.path, file)}\n`);
    }
    io.stdout.write(`  test: ${preview.commands.join(', ')}\n`);
    io.stdout.write(`  patch-bytes: ${preview.patchBundle.length}\n`);
    io.stdout.write(preview.report);
    return;
  }
  const result = executeSandboxPatch(plan, {
    files: parsed.files,
    testCommand: parsed.testCommand,
  });

  if (!result.allowed) {
    io.stderr.write(`rdma sandbox apply: ${result.reason}\n`);
    return;
  }

  io.stdout.write(`sandbox applied for ${parsed.proposalId}\n`);
  io.stdout.write(`  path: ${plan.sandbox.path}\n`);
  io.stdout.write(`  files: ${result.writtenFiles.length}\n`);
  for (const file of result.writtenFiles) {
    io.stdout.write(`    ${path.relative(plan.sandbox.path, file)}\n`);
  }
  io.stdout.write(`  test: ${result.commands.join(', ')}\n`);
  io.stdout.write(`  patch-bytes: ${result.patchBundle.length}\n`);
}
