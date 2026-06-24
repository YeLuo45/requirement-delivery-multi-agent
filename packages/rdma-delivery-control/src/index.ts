import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  readonly report?: string;
}

export interface SandboxPreviewPatch {
  readonly allowed: boolean;
  readonly writtenFiles: ReadonlyArray<string>;
  readonly patchBundle: string;
  readonly reason: string;
}

export interface LedgerRecord {
  readonly agentId: string;
  readonly model: string;
  readonly usd: number;
  readonly at?: string;
}

export interface LedgerSnapshot {
  readonly proposalId: string;
  readonly maxUsd: number;
  readonly spentUsd: number;
  readonly remainingUsd: number;
  readonly records: ReadonlyArray<LedgerRecord>;
}

export type PolicyEventKind = 'tool.policy.allowed' | 'tool.policy.denied';

export interface PolicyBusEvent {
  readonly kind: 'proposal.updated';
  readonly payload: {
    readonly policyEvent: PolicyEventKind;
    readonly proposalId: string;
    readonly projectId: string;
    readonly actor: string;
    readonly tool: string;
    readonly risk: RiskLevel;
    readonly reason: string;
    readonly at: string;
  };
}

export interface PolicyBusLike {
  publish(event: PolicyBusEvent): void;
}

export interface CostTracker {
  route(request: ModelRouteRequest): ModelRouteDecision;
  commit(record: SpendRecord): void;
  ledger(): BudgetLedger;
}

export interface TuiPanelUpdate {
  readonly kind: string;
  readonly snapshot: string;
}

export interface TuiPanelSession {
  handlePolicy(input: {
    proposalId: string;
    tool: string;
    allowed: boolean;
    reason: string;
    at: string;
  }): void;
  close(): void;
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

export interface PolicyAuditBus {
  publish: (event: PolicyAuditEvent) => void;
  subscribe(listener: (event: PolicyAuditEvent) => void): () => void;
}

export interface CostSnapshot {
  readonly proposalId: string;
  readonly maxUsd: number;
  readonly spentUsd: number;
  readonly remainingUsd: number;
}

export function subscribePolicyAuditBus(): PolicyAuditBus {
  const listeners = new Set<(event: PolicyAuditEvent) => void>();
  return {
    publish(event: PolicyAuditEvent): void {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function renderCostPrometheus(
  counters: { counters: Record<string, number> },
  snapshot: CostSnapshot,
): string {
  const lines: string[] = [];
  lines.push('# HELP rdma_cost_spent_usd USD already spent on this proposal');
  lines.push('# TYPE rdma_cost_spent_usd gauge');
  lines.push(`rdma_cost_spent_usd ${snapshot.spentUsd.toFixed(2)}`);
  lines.push('# HELP rdma_cost_remaining_usd USD left on this proposal');
  lines.push('# TYPE rdma_cost_remaining_usd gauge');
  lines.push(`rdma_cost_remaining_usd ${snapshot.remainingUsd.toFixed(2)}`);
  lines.push('# HELP rdma_cost_max_usd USD budget for this proposal');
  lines.push('# TYPE rdma_cost_max_usd gauge');
  lines.push(`rdma_cost_max_usd ${snapshot.maxUsd.toFixed(2)}`);
  lines.push('# HELP rdma_cost_records Number of spend records recorded');
  lines.push('# TYPE rdma_cost_records counter');
  lines.push(`rdma_cost_records ${counters.counters.rdma_cost_records ?? 0}`);

  return `${lines.join('\n')}\n`;
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

export function publishToPolicyAuditBus(
  bus: PolicyAuditBus,
  input: PolicyAuditInput,
): PolicyAuditEvent {
  const event = publishPolicyAuditEvent(input, () => undefined);
  for (const listener of (bus as unknown as { _listeners?: Set<(event: PolicyAuditEvent) => void> })
    ._listeners ?? new Set<(event: PolicyAuditEvent) => void>()) {
    listener(event);
  }
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
  metrics.increment('rdma_cost_records', snapshot.records.length);
  metrics.increment('rdma_cost_spent_cents', Math.round(snapshot.spentUsd * 100));
  metrics.increment('rdma_cost_remaining_cents', Math.round(snapshot.remainingUsd * 100));
  return snapshot;
}

export interface ControlPlanePanelInput {
  readonly metrics: { counters: Record<string, number> };
  readonly snapshot: CostSnapshot;
  readonly mode: 'prom' | 'json' | 'tui';
}

export interface PolicyAuditBusAdapter {
  publishPolicy(input: {
    proposalId: string;
    tool: string;
    risk: RiskLevel;
    allowed: boolean;
    reason: string;
  }): void;
}

export interface PolicyAuditBusContext {
  readonly projectId: string;
  readonly actor: string;
  readonly nowIso?: () => string;
}

export interface PolicyAuditBusLike {
  publish(event: {
    kind: string;
    proposalId: string;
    projectId: string;
    at: string;
    payload?: Record<string, unknown>;
  }): void;
}

export interface SandboxPreviewInput {
  readonly workspaceRoot: string;
  readonly proposalId: string;
  readonly projectId?: string;
  readonly testCommand?: string;
  readonly files: ReadonlyArray<SandboxPatchFile>;
}

export function attachPolicyAuditToEventBus(
  bus: PolicyAuditBusLike,
  context: PolicyAuditBusContext,
): PolicyAuditBusAdapter {
  const now = context.nowIso ?? (() => new Date().toISOString());
  return {
    publishPolicy(input) {
      bus.publish({
        kind: 'proposal.updated',
        proposalId: input.proposalId,
        projectId: context.projectId,
        at: now(),
        payload: {
          policyEvent: input.allowed ? 'tool.policy.allowed' : 'tool.policy.denied',
          actor: context.actor,
          tool: input.tool,
          risk: input.risk,
          reason: input.reason,
        },
      });
    },
  };
}

export function publishPolicyEventToBus(
  bus: { publish(event: PolicyBusEvent): void },
  input: {
    proposalId: string;
    projectId: string;
    actor: string;
    tool: string;
    risk: RiskLevel;
    allowed: boolean;
    reason: string;
    at: string;
  },
): PolicyBusEvent {
  const event: PolicyBusEvent = {
    kind: 'proposal.updated',
    payload: {
      policyEvent: input.allowed ? 'tool.policy.allowed' : 'tool.policy.denied',
      proposalId: input.proposalId,
      projectId: input.projectId,
      actor: input.actor,
      tool: input.tool,
      risk: input.risk,
      reason: input.reason,
      at: input.at,
    },
  };
  bus.publish(event);
  return event;
}

export function trackLlmSpend(
  ledger: BudgetLedger,
  options: {
    modelTiers?: Record<ModelQuality, string>;
    downgradeThresholdUsd?: number;
  } = {},
): CostTracker {
  const modelTiers = options.modelTiers ?? {
    cheap: 'gpt-5.4-mini',
    standard: 'gpt-5.4',
    premium: 'gpt-5.5',
  };
  const downgradeThreshold = options.downgradeThresholdUsd ?? 0.05;
  return {
    route(request: ModelRouteRequest): ModelRouteDecision {
      const snap = ledger.snapshot();
      if (snap.remainingUsd <= 0) {
        return {
          allowed: false,
          model: modelTiers.cheap,
          reason: 'budget exhausted',
        };
      }
      if (snap.remainingUsd - request.estimatedUsd <= downgradeThreshold) {
        return {
          allowed: true,
          model: modelTiers.cheap,
          reason: `downgrade to cheap tier with ${snap.remainingUsd.toFixed(2)} USD remaining`,
        };
      }
      return {
        allowed: true,
        model: modelTiers[request.quality],
        reason: 'requested tier within budget',
      };
    },
    commit(record: SpendRecord): void {
      ledger.record(record);
    },
    ledger(): BudgetLedger {
      return ledger;
    },
  };
}

export function subscribeTuiPanelUpdates(input: {
  proposalId: string;
  maxUsd?: number;
  onUpdate(kind: string, snapshot: string): void;
}): TuiPanelSession {
  let costRecords = 0;
  let lastKind = '';
  const emit = (kind: string) => {
    lastKind = kind;
    input.onUpdate(
      kind,
      renderControlPlanePanel({
        metrics: { counters: { rdma_cost_records: costRecords } },
        snapshot: {
          proposalId: input.proposalId,
          maxUsd: input.maxUsd ?? 1,
          spentUsd: 0,
          remainingUsd: input.maxUsd ?? 1,
        },
        mode: 'tui',
      }),
    );
  };
  return {
    handlePolicy(p) {
      costRecords += 1;
      emit(p.allowed ? 'policy.allowed' : 'policy.denied');
    },
    close() {
      lastKind = '';
    },
  };
}

export function parseLedgerFromSnapshot(text: string): LedgerSnapshot {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('ledger JSON must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  const records: LedgerRecord[] = [];
  const rawRecords = Array.isArray(obj.records) ? obj.records : [];
  for (const entry of rawRecords) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as Record<string, unknown>;
    records.push({
      agentId: typeof r.agentId === 'string' ? r.agentId : 'unknown',
      model: typeof r.model === 'string' ? r.model : 'unknown',
      usd: typeof r.usd === 'number' ? r.usd : 0,
      ...(typeof r.at === 'string' ? { at: r.at } : {}),
    });
  }
  return {
    proposalId: typeof obj.proposalId === 'string' ? obj.proposalId : 'unknown',
    maxUsd: typeof obj.maxUsd === 'number' ? obj.maxUsd : 0,
    spentUsd: typeof obj.spentUsd === 'number' ? obj.spentUsd : 0,
    remainingUsd: typeof obj.remainingUsd === 'number' ? obj.remainingUsd : 0,
    records,
  };
}

export function loadLedgerFromStorage(snapshot: LedgerSnapshot): LedgerSnapshot {
  const spentUsd = roundUsd(snapshot.records.reduce((sum, r) => sum + r.usd, 0));
  const remainingUsd = roundUsd(Math.max(0, snapshot.maxUsd - spentUsd));
  return {
    proposalId: snapshot.proposalId,
    maxUsd: snapshot.maxUsd,
    spentUsd,
    remainingUsd,
    records: [...snapshot.records],
  };
}

export function formatSandboxPatchAsGitApply(patch: SandboxPreviewPatch): string {
  const lines: string[] = [];
  for (const file of patch.writtenFiles) {
    const display = file.includes('/') && !file.startsWith('/') ? file : path.basename(file);
    lines.push(`diff --git a/${display} b/${display}`);
    lines.push('new file mode 100644');
    lines.push('--- /dev/null');
    lines.push(`+++ b/${display}`);
    lines.push('@@ -0,0 +1,1 @@');
    lines.push('+');
  }
  lines.push(patch.patchBundle);
  return lines.join('\n');
}

export interface SelectModelInput {
  readonly snapshot: BudgetSnapshot;
  readonly modelTiers: Record<ModelQuality, string>;
  readonly estimatedUsd: number;
  readonly requestedQuality: ModelQuality;
}

export interface SelectModelOutput {
  readonly allowed: boolean;
  readonly model: string;
  readonly reason: string;
}

export function selectModelWithinBudget(input: SelectModelInput): SelectModelOutput {
  if (input.snapshot.remainingUsd <= 0) {
    return {
      allowed: false,
      model: input.modelTiers.cheap,
      reason: 'budget exhausted',
    };
  }
  if (input.snapshot.remainingUsd >= input.estimatedUsd) {
    return {
      allowed: true,
      model: input.modelTiers[input.requestedQuality],
      reason: 'requested tier within budget',
    };
  }
  return {
    allowed: true,
    model: input.modelTiers.cheap,
    reason: `downgrade to cheap tier with ${input.snapshot.remainingUsd.toFixed(2)} USD remaining`,
  };
}

export function parseLedgerFromDisk(filePath: string): LedgerSnapshot {
  const text = readFileSync(filePath, 'utf8');
  return parseLedgerFromSnapshot(text);
}

export function ledgerPathFromStorage(storageRoot: string, proposalId: string): string {
  return path.join(storageRoot, 'ledgers', `${proposalId}.ledger.json`);
}

export function parseLedgerFromStorage(storageRoot: string, proposalId: string): LedgerSnapshot {
  return parseLedgerFromDisk(ledgerPathFromStorage(storageRoot, proposalId));
}

export interface AgentProviderBuilderInput {
  readonly agentId: string;
  readonly baseConfig: {
    readonly provider: 'mock' | 'anthropic' | 'openai';
    readonly model?: string;
  };
  readonly ledger: {
    record(record: SpendRecord): void;
    snapshot(): BudgetSnapshot;
  };
  readonly modelTiers: Record<ModelQuality, string>;
}

export interface BuiltProvider {
  readonly defaultModel: string;
  readonly name: string;
}

export async function buildAgentProviderWithBudget(
  input: AgentProviderBuilderInput,
): Promise<BuiltProvider> {
  const snapshot = input.ledger.snapshot();
  const requested = input.baseConfig.model ?? input.modelTiers.standard;
  const cheapTierRequested = requested === input.modelTiers.cheap;
  const decision = selectModelWithinBudget({
    snapshot,
    modelTiers: input.modelTiers,
    estimatedUsd: cheapTierRequested ? 0 : 1,
    requestedQuality: cheapTierRequested ? 'cheap' : 'premium',
  });
  return {
    name: `${input.agentId}@${input.baseConfig.provider}`,
    defaultModel: decision.model,
  };
}

export interface FullPanelUpdate {
  readonly kind: 'policy' | 'stage' | 'proposal';
  readonly text: string;
}

export interface FullPanelSession {
  handlePolicy(input: {
    proposalId: string;
    tool: string;
    allowed: boolean;
    reason: string;
    at: string;
  }): void;
  handleStageTransition(input: {
    proposalId: string;
    fromStage: string;
    toStage: string;
    at: string;
  }): void;
  handleProposalUpdate(input: {
    proposalId: string;
    status: string;
    at: string;
  }): void;
  close(): void;
}

export function subscribeFullPanelUpdates(input: {
  proposalId: string;
  onUpdate(kind: string, text: string): void;
}): FullPanelSession {
  let costRecords = 0;
  let lastStage = '';
  let lastStatus = '';
  const emit = (kind: string, text: string) => {
    input.onUpdate(
      kind,
      `${renderControlPlanePanel({
        metrics: { counters: { rdma_cost_records: costRecords } },
        snapshot: {
          proposalId: input.proposalId,
          maxUsd: 1,
          spentUsd: 0,
          remainingUsd: 1,
        },
        mode: 'tui',
      })}\n${text}\n`,
    );
  };
  return {
    handlePolicy(p) {
      costRecords += 1;
      emit('policy', `${p.allowed ? 'allowed' : 'denied'} ${p.tool} @ ${p.at}`);
    },
    handleStageTransition(s) {
      lastStage = `${s.fromStage}->${s.toStage}`;
      emit('stage', `stage ${lastStage} @ ${s.at}`);
    },
    handleProposalUpdate(p) {
      lastStatus = p.status;
      emit('proposal', `proposal status=${lastStatus} @ ${p.at}`);
    },
    close() {
      lastStage = '';
      lastStatus = '';
    },
  };
}

export interface ValidatedPatch {
  readonly recognizedFiles: ReadonlyArray<string>;
  readonly gitChecked: boolean;
  readonly gitError: string | null;
}

export function validateGitApplyPatch(patchText: string): ValidatedPatch {
  const files: string[] = [];
  const lines = patchText.split('\n');
  for (const line of lines) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (match && match[1] === match[2]) {
      files.push(match[1] ?? '');
    }
  }
  return {
    recognizedFiles: files,
    gitChecked: false,
    gitError: null,
  };
}

export interface GitApplyCheckInput {
  readonly patchText: string;
  readonly cwd: string;
}

export interface GitApplyCheckResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export function applyGitPatchCheck(input: GitApplyCheckInput): GitApplyCheckResult {
  const child = spawnSync('git', ['apply', '--check', '-'], {
    cwd: input.cwd,
    input: input.patchText,
    encoding: 'utf8',
  });
  return {
    ok: child.status === 0,
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
  };
}

export interface PrDraftInput {
  readonly proposalId: string;
  readonly title: string;
  readonly body: string;
  readonly patch: SandboxPreviewPatch;
  readonly repoPath?: string;
}

export interface PrDraft {
  readonly title: string;
  readonly body: string;
  readonly patchText: string;
  readonly validated: ValidatedPatch;
  readonly gitCheck: GitApplyCheckResult | null;
}

export function formatPrDraft(input: PrDraftInput): PrDraft {
  const patchText = formatSandboxPatchAsGitApply(input.patch);
  const validated = validateGitApplyPatch(patchText);
  let gitCheck: GitApplyCheckResult | null = null;
  if (input.repoPath) {
    try {
      gitCheck = applyGitPatchCheck({ patchText, cwd: input.repoPath });
    } catch {
      gitCheck = null;
    }
  }
  const gitCheckLines = gitCheck
    ? [
        `Git apply check: ${gitCheck.ok ? 'passed' : 'failed'} (git apply --check)`,
        gitCheck.stdout.trim() ? `Git stdout:\n${gitCheck.stdout.trim()}` : '',
        gitCheck.stderr.trim() ? `Git stderr:\n${gitCheck.stderr.trim()}` : '',
      ].filter(Boolean)
    : ['Git apply check: not run'];
  return {
    title: `[rdma] ${input.title} (${input.proposalId})`,
    body: `${input.body}\n\nProposal: ${input.proposalId}\n\nPatch source: rdma sandbox apply --dry-run --pr-draft\nFiles: ${validated.recognizedFiles.join(', ') || '(none)'}\n${gitCheckLines.join('\n')}\n`,
    patchText,
    validated,
    gitCheck,
  };
}

export function renderControlPlanePanel(input: ControlPlanePanelInput): string {
  if (input.mode === 'prom') {
    return renderCostPrometheus(input.metrics, input.snapshot);
  }
  if (input.mode === 'json') {
    const payload = {
      directions: ['A:delivery-sandbox', 'B:collaboration', 'C:tool-governance', 'D:cost-router'],
      proposalId: input.snapshot.proposalId,
      cost: {
        proposalId: input.snapshot.proposalId,
        maxUsd: input.snapshot.maxUsd,
        spentUsd: input.snapshot.spentUsd,
        remainingUsd: input.snapshot.remainingUsd,
      },
      metrics: input.metrics.counters,
    };
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  const lines = [
    'RDMA control plane',
    `proposal: ${input.snapshot.proposalId}`,
    `cost: spent=${input.snapshot.spentUsd.toFixed(2)} USD remaining=${input.snapshot.remainingUsd.toFixed(2)} USD`,
    `cost records: ${input.metrics.counters.rdma_cost_records ?? 0}`,
    'directions: A:delivery-sandbox | B:collaboration | C:tool-governance | D:cost-router',
  ];
  return `${lines.join('\n')}\n`;
}

export function buildSandboxPreview(input: SandboxPreviewInput): SandboxPatchResult {
  const requirement: DeliveryRequirement = {
    proposalId: input.proposalId,
    projectId: input.projectId ?? 'PRJ-20260621-001',
    title: 'sandbox preview',
    rawRequirement: 'dry-run sandbox preview',
    scope: 'small',
    priority: 'P2',
  };
  const plan = buildDeliveryPlan(requirement, {
    workspaceRoot: input.workspaceRoot,
    defaultTestCommand: input.testCommand ?? 'npm test',
  });
  const result = executeSandboxPatch(plan, {
    files: input.files.map((file) => ({ path: file.path, content: file.content })),
    testCommand: input.testCommand ?? 'npm test',
  });
  return {
    ...result,
    reason: result.allowed ? 'sandbox preview generated without writing to disk' : result.reason,
    commands: [input.testCommand ?? 'npm test'],
  };
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
