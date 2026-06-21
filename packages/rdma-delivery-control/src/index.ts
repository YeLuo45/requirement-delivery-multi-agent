import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type DeliveryScope = 'small' | 'medium' | 'large';
export type DeliveryPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ShareMode = 'private' | 'readonly' | 'review' | 'edit';
export type CollaboratorRole = 'viewer' | 'commenter' | 'editor';
export type CollaboratorAccess = 'read' | 'write_comment' | 'modify_artifact';
export type ModelQuality = 'cheap' | 'standard' | 'premium';

export interface DeliveryRequirement {
  readonly proposalId: string;
  readonly projectId: string;
  readonly title: string;
  readonly rawRequirement: string;
  readonly scope: DeliveryScope;
  readonly priority: DeliveryPriority;
}

export interface DeliveryPlanOptions {
  readonly workspaceRoot: string;
  readonly defaultTestCommand: string;
}

export interface DeliveryPlan {
  readonly proposalId: string;
  readonly projectId: string;
  readonly title: string;
  readonly sandbox: {
    readonly path: string;
    readonly allowedWrites: ReadonlyArray<string>;
    readonly environment: 'isolated';
  };
  readonly checkpoints: ReadonlyArray<{
    readonly name: string;
    readonly requiredCommand: string;
    readonly exitCriteria: string;
  }>;
  readonly artifacts: ReadonlyArray<{
    readonly kind: 'test_plan' | 'implementation' | 'test_report' | 'deployment_record';
    readonly required: boolean;
  }>;
}

export interface CollaboratorRequest {
  readonly userId: string;
  readonly proposalId: string;
  readonly requestedRole: CollaboratorRole;
  readonly requestedAccess: CollaboratorAccess;
}

export interface CollaborationContext {
  readonly proposalOwnerId: string;
  readonly shareMode: ShareMode;
  readonly nowIso: string;
  readonly leaseMinutes: number;
}

export interface CollaborationDecision {
  readonly allowed: boolean;
  readonly role: CollaboratorRole;
  readonly reason: string;
  readonly permissions: {
    readonly canRead: boolean;
    readonly canComment: boolean;
    readonly canModifyArtifacts: boolean;
  };
  readonly lease?: {
    readonly holderId: string;
    readonly proposalId: string;
    readonly expiresAt: string;
  };
}

export interface ToolPolicy {
  readonly maxRisk: RiskLevel;
  readonly allowedTools: ReadonlyArray<string>;
  readonly allowedWriteRoots: ReadonlyArray<string>;
  readonly deniedCommandPatterns: ReadonlyArray<string>;
  readonly networkAllowed: boolean;
}

export interface ToolRequest {
  readonly tool: string;
  readonly risk: RiskLevel;
  readonly path?: string;
  readonly command?: string;
  readonly network?: boolean;
}

export interface ToolDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface BudgetLedgerOptions {
  readonly proposalId: string;
  readonly maxUsd: number;
}

export interface SpendRecord {
  readonly agentId: string;
  readonly model: string;
  readonly usd: number;
}

export interface BudgetSnapshot {
  readonly proposalId: string;
  readonly maxUsd: number;
  readonly spentUsd: number;
  readonly remainingUsd: number;
  readonly records: ReadonlyArray<SpendRecord>;
}

export interface BudgetLedger {
  record(record: SpendRecord): void;
  snapshot(): BudgetSnapshot;
}

export interface ModelRouteRequest {
  readonly agentId: string;
  readonly quality: ModelQuality;
  readonly estimatedUsd: number;
}

export interface ModelRouteOptions {
  readonly ledger: BudgetLedger;
  readonly modelTiers: Record<ModelQuality, string>;
}

export interface ModelRouteDecision {
  readonly allowed: boolean;
  readonly model: string;
  readonly reason: string;
}

export interface ControlPlaneSummaryInput {
  readonly deliveryPlan: DeliveryPlan;
  readonly collaboration: CollaborationDecision;
  readonly toolDecision: ToolDecision;
  readonly budget: BudgetSnapshot;
}

export interface ControlPlaneSummary {
  readonly directions: ReadonlyArray<string>;
  readonly readyForDevExecution: boolean;
  readonly report: string;
}

export interface SandboxPatchFile {
  readonly path: string;
  readonly content: string;
}

export interface SandboxPatchRequest {
  readonly files: ReadonlyArray<SandboxPatchFile>;
  readonly testCommand: string;
}

export interface SandboxPatchResult {
  readonly allowed: boolean;
  readonly reason: string;
  readonly writtenFiles: ReadonlyArray<string>;
  readonly commands: ReadonlyArray<string>;
  readonly patchBundle: string;
}

export interface PolicyAuditInput {
  readonly proposalId: string;
  readonly actor: string;
  readonly request: ToolRequest;
  readonly decision: ToolDecision;
}

export interface PolicyAuditEvent {
  readonly kind: 'tool.policy.allowed' | 'tool.policy.denied';
  readonly payload: {
    readonly proposalId: string;
    readonly actor: string;
    readonly tool: string;
    readonly risk: RiskLevel;
    readonly allowed: boolean;
    readonly reason: string;
  };
}

export interface ControlPlaneMetrics {
  increment(name: string, value?: number): void;
  snapshot(): { counters: Record<string, number> };
}

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const ACCESS_BY_MODE: Record<ShareMode, ReadonlyArray<CollaboratorAccess>> = {
  private: [],
  readonly: ['read'],
  review: ['read', 'write_comment'],
  edit: ['read', 'write_comment', 'modify_artifact'],
};

export function buildDeliveryPlan(
  requirement: DeliveryRequirement,
  options: DeliveryPlanOptions,
): DeliveryPlan {
  const root = trimTrailingSlash(options.workspaceRoot);
  const sandboxPath = `${root}/${requirement.projectId}/${requirement.proposalId}`;

  return {
    proposalId: requirement.proposalId,
    projectId: requirement.projectId,
    title: requirement.title,
    sandbox: {
      path: sandboxPath,
      allowedWrites: [sandboxPath],
      environment: 'isolated',
    },
    checkpoints: [
      {
        name: 'RED tests',
        requiredCommand: options.defaultTestCommand,
        exitCriteria: 'At least one newly written test fails for the expected missing behavior.',
      },
      {
        name: 'GREEN implementation',
        requiredCommand: options.defaultTestCommand,
        exitCriteria: 'All new and existing tests pass after the minimal implementation.',
      },
      {
        name: 'QA acceptance',
        requiredCommand: 'npm run coverage',
        exitCriteria:
          'Incremental coverage is at least 95 percent and acceptance artifacts are attached.',
      },
      {
        name: 'Patch bundle',
        requiredCommand: 'git diff --stat',
        exitCriteria: 'The delivery patch is reviewable and limited to the sandboxed scope.',
      },
    ],
    artifacts: [
      { kind: 'test_plan', required: true },
      { kind: 'implementation', required: true },
      { kind: 'test_report', required: true },
      { kind: 'deployment_record', required: false },
    ],
  };
}

export function approveCollaborator(
  request: CollaboratorRequest,
  context: CollaborationContext,
): CollaborationDecision {
  const permissions = permissionsForMode(context.shareMode, request.requestedRole);
  const allowedAccess = ACCESS_BY_MODE[context.shareMode].includes(request.requestedAccess);

  if (!allowedAccess) {
    return {
      allowed: false,
      role: request.requestedRole,
      reason: `${context.shareMode} share mode does not allow ${request.requestedAccess}`,
      permissions,
    };
  }

  const expiresAt = new Date(
    Date.parse(context.nowIso) + context.leaseMinutes * 60_000,
  ).toISOString();
  return {
    allowed: true,
    role: request.requestedRole,
    reason: `${request.requestedRole} approved for ${request.requestedAccess}`,
    permissions,
    lease: {
      holderId: request.userId,
      proposalId: request.proposalId,
      expiresAt,
    },
  };
}

export function evaluateToolRequest(request: ToolRequest, policy: ToolPolicy): ToolDecision {
  if (!policy.allowedTools.includes(request.tool)) {
    return { allowed: false, reason: `${request.tool} is not in allowed tool list` };
  }

  if (RISK_ORDER[request.risk] > RISK_ORDER[policy.maxRisk]) {
    return { allowed: false, reason: `risk ${request.risk} exceeds max risk ${policy.maxRisk}` };
  }

  if (request.network && !policy.networkAllowed) {
    return { allowed: false, reason: 'network access is disabled by policy' };
  }

  if (request.command) {
    const denied = policy.deniedCommandPatterns.find((pattern) =>
      request.command?.includes(pattern),
    );
    if (denied) {
      return { allowed: false, reason: `command matches denied pattern: ${denied}` };
    }
  }

  if (isWriteTool(request.tool) && request.path) {
    const insideAllowedRoot = policy.allowedWriteRoots.some((root) =>
      isInsideRoot(request.path as string, root),
    );
    if (!insideAllowedRoot) {
      return { allowed: false, reason: `${request.path} is outside allowed roots` };
    }
  }

  return { allowed: true, reason: 'allowed by policy' };
}

export function createBudgetLedger(options: BudgetLedgerOptions): BudgetLedger {
  const records: SpendRecord[] = [];

  return {
    record(record: SpendRecord): void {
      if (record.usd < 0) {
        throw new Error('Spend must be non-negative');
      }
      records.push(record);
    },
    snapshot(): BudgetSnapshot {
      const spentUsd = roundUsd(records.reduce((sum, record) => sum + record.usd, 0));
      return {
        proposalId: options.proposalId,
        maxUsd: options.maxUsd,
        spentUsd,
        remainingUsd: Math.max(0, roundUsd(options.maxUsd - spentUsd)),
        records: [...records],
      };
    },
  };
}

export function routeModelForAgent(
  request: ModelRouteRequest,
  options: ModelRouteOptions,
): ModelRouteDecision {
  const snapshot = options.ledger.snapshot();
  if (snapshot.remainingUsd <= 0) {
    return { allowed: false, model: options.modelTiers.cheap, reason: 'budget exhausted' };
  }

  if (request.estimatedUsd <= snapshot.remainingUsd) {
    return {
      allowed: true,
      model: options.modelTiers[request.quality],
      reason: 'requested tier within budget',
    };
  }

  const cheapModel = options.modelTiers.cheap;
  const cheapEstimate = Math.min(request.estimatedUsd, snapshot.remainingUsd);
  if (cheapEstimate > 0) {
    return {
      allowed: true,
      model: cheapModel,
      reason: `downgraded to cheap tier with ${snapshot.remainingUsd.toFixed(2)} USD remaining`,
    };
  }

  return { allowed: false, model: cheapModel, reason: 'budget exhausted' };
}

export function summarizeControlPlane(input: ControlPlaneSummaryInput): ControlPlaneSummary {
  const readyForDevExecution =
    input.deliveryPlan.sandbox.environment === 'isolated' &&
    input.collaboration.permissions.canRead &&
    input.toolDecision.allowed &&
    input.budget.remainingUsd > 0;

  return {
    directions: ['A:delivery-sandbox', 'B:collaboration', 'C:tool-governance', 'D:cost-router'],
    readyForDevExecution,
    report: [
      `sandbox=${input.deliveryPlan.sandbox.path}`,
      `collaboration=${input.collaboration.reason}`,
      `tool policy=${input.toolDecision.reason}`,
      `budget=${input.budget.remainingUsd.toFixed(2)} USD remaining`,
    ].join('; '),
  };
}

export function executeSandboxPatch(
  plan: DeliveryPlan,
  request: SandboxPatchRequest,
): SandboxPatchResult {
  const sandboxRoot = plan.sandbox.path;
  const writtenFiles: string[] = [];
  const patchLines: string[] = [];

  for (const file of request.files) {
    if (path.isAbsolute(file.path) || file.path.split(/[\\/]+/).includes('..')) {
      return {
        allowed: false,
        reason: `${file.path} is outside sandbox`,
        writtenFiles: [],
        commands: [],
        patchBundle: '',
      };
    }

    const target = path.join(sandboxRoot, file.path);
    if (!isInsideRoot(target, sandboxRoot)) {
      return {
        allowed: false,
        reason: `${file.path} is outside sandbox`,
        writtenFiles: [],
        commands: [],
        patchBundle: '',
      };
    }

    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content, 'utf8');
    writtenFiles.push(target);
    patchLines.push(
      '--- /dev/null',
      `+++ ${file.path}`,
      ...file.content.split('\n').map((line) => `+${line}`),
    );
  }

  return {
    allowed: true,
    reason: 'patch applied inside sandbox',
    writtenFiles,
    commands: [request.testCommand],
    patchBundle: `${patchLines.join('\n')}\n`,
  };
}

export function publishPolicyAuditEvent(
  input: PolicyAuditInput,
  publish: (event: PolicyAuditEvent) => void,
): PolicyAuditEvent {
  const event: PolicyAuditEvent = {
    kind: input.decision.allowed ? 'tool.policy.allowed' : 'tool.policy.denied',
    payload: {
      proposalId: input.proposalId,
      actor: input.actor,
      tool: input.request.tool,
      risk: input.request.risk,
      allowed: input.decision.allowed,
      reason: input.decision.reason,
    },
  };
  publish(event);
  return event;
}

export function createControlPlaneMetrics(): ControlPlaneMetrics {
  const counters: Record<string, number> = {};
  return {
    increment(name: string, value = 1): void {
      counters[name] = (counters[name] ?? 0) + value;
    },
    snapshot(): { counters: Record<string, number> } {
      return { counters: { ...counters } };
    },
  };
}

export function recordBudgetMetrics(
  snapshot: BudgetSnapshot,
  metrics: ControlPlaneMetrics,
): BudgetSnapshot {
  metrics.increment('rdma.cost.records', snapshot.records.length);
  metrics.increment('rdma.cost.spent_cents', Math.round(snapshot.spentUsd * 100));
  metrics.increment('rdma.cost.remaining_cents', Math.round(snapshot.remainingUsd * 100));
  return snapshot;
}

export function formatCollaborationPanel(decisions: ReadonlyArray<CollaborationDecision>): string {
  const lines = ['Collaboration', 'role       access                         lease'];
  for (const decision of decisions) {
    const access = [
      decision.permissions.canRead ? 'read' : '',
      decision.permissions.canComment ? 'comment' : '',
      decision.permissions.canModifyArtifacts ? 'modify' : '',
    ]
      .filter(Boolean)
      .join(',');
    lines.push(
      `${decision.role.padEnd(10)} ${access.padEnd(30)} ${decision.lease?.expiresAt ?? '-'}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function permissionsForMode(
  shareMode: ShareMode,
  role: CollaboratorRole,
): CollaborationDecision['permissions'] {
  const access = ACCESS_BY_MODE[shareMode];
  return {
    canRead: access.includes('read'),
    canComment: access.includes('write_comment') && role !== 'viewer',
    canModifyArtifacts: access.includes('modify_artifact') && role === 'editor',
  };
}

function isWriteTool(tool: string): boolean {
  return tool === 'write_file' || tool === 'patch' || tool === 'terminal';
}

function isInsideRoot(path: string, root: string): boolean {
  const normalizedRoot = trimTrailingSlash(root);
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
