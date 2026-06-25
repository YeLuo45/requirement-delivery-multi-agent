import type { AgentRuntimeConfig } from '@rdma/config';
import { type RequiredAgentId, requiredAgentIds } from './operator-console.js';

export interface AgentConfigPatchInput {
  readonly existingYaml: string;
  readonly desired: {
    readonly agentId: RequiredAgentId;
    readonly provider: string;
    readonly model: string;
    readonly promptFiles: ReadonlyArray<string>;
  };
}

export interface AgentConfigPatchPlan {
  readonly mode: 'dry-run';
  readonly agentId: RequiredAgentId;
  readonly yamlPreview: string;
  readonly patchPreview: string;
  readonly commands: ReadonlyArray<string>;
}

export interface AgentRunSnapshot {
  readonly agentId: RequiredAgentId;
  readonly status: 'ok' | 'failed' | 'unknown';
  readonly latencyMs: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly error?: string;
}

export interface ConfigOperationRow {
  readonly agentId: RequiredAgentId;
  readonly provider: string;
  readonly model: string;
  readonly promptState: 'prompts=on' | 'prompts=off';
  readonly configState: 'configured' | 'mock';
  readonly lastStatus: AgentRunSnapshot['status'];
  readonly latencyMs: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly hint: string;
}

export interface ConfigOperationsCenter {
  readonly summary: {
    readonly totalAgents: number;
    readonly healthyAgents: number;
    readonly failedAgents: number;
    readonly mockAgents: number;
    readonly totalCostUsd: number;
  };
  readonly rows: ReadonlyArray<ConfigOperationRow>;
}

export interface ConfigAuditEntryPlan {
  readonly kind: 'config.audit';
  readonly proposalId: string;
  readonly actor: string;
  readonly changedAgents: ReadonlyArray<RequiredAgentId>;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly summary: string;
  readonly rollbackCommand: string;
}

export interface CredentialHealthRow {
  readonly provider: string;
  readonly envVar: string;
  readonly status: 'ready' | 'missing';
  readonly maskedValue: string;
  readonly smokeCommand: string;
}

export interface CredentialHealthCenter {
  readonly readyProviders: number;
  readonly rows: ReadonlyArray<CredentialHealthRow>;
}

export interface OnboardingStep {
  readonly id: 'storage' | 'config' | 'provider' | 'demo';
  readonly label: string;
  readonly status: 'done' | 'todo';
  readonly command: string;
}

export interface OnboardingChecklist {
  readonly completed: number;
  readonly steps: ReadonlyArray<OnboardingStep>;
  readonly nextAction: OnboardingStep | null;
}

export interface PromptWorkbenchRow {
  readonly agentId: RequiredAgentId;
  readonly missing: ReadonlyArray<'soul' | 'user' | 'memory'>;
  readonly conflicts: ReadonlyArray<string>;
  readonly status: 'complete' | 'partial' | 'missing';
}

export interface PromptWorkbench {
  readonly summary: {
    readonly totalAgents: number;
    readonly completePromptAgents: number;
    readonly conflictAgents: number;
  };
  readonly rows: ReadonlyArray<PromptWorkbenchRow>;
}

export interface SafeExecutionPlan {
  readonly mode: 'dry-run';
  readonly proposalId: string;
  readonly commands: ReadonlyArray<string>;
  readonly risks: ReadonlyArray<string>;
}

type ConfigRecord = Record<string, Pick<AgentRuntimeConfig, 'source' | 'llm' | 'prompts'>>;

export function planAgentConfigPatch(input: AgentConfigPatchInput): AgentConfigPatchPlan {
  const yamlPreview = renderSingleAgentYaml(input.desired);
  const oldModel = findYamlValue(input.existingYaml, 'model') ?? '<unset>';
  return {
    mode: 'dry-run',
    agentId: input.desired.agentId,
    yamlPreview,
    patchPreview: [
      '--- .rdma/agents.yaml',
      '+++ .rdma/agents.yaml',
      `@@ ${input.desired.agentId} @@`,
      `-      model: ${oldModel}`,
      `+      model: ${input.desired.model}`,
      `+      provider: ${input.desired.provider}`,
      ...input.desired.promptFiles.map((file) => `+      prompt: ${file}`),
    ].join('\n'),
    commands: ['npm run cli -- config validate', 'npm run cli -- config show --all'],
  };
}

export function buildConfigOperationsCenter(input: {
  readonly configs: ConfigRecord;
  readonly runs: ReadonlyArray<AgentRunSnapshot>;
}): ConfigOperationsCenter {
  const runByAgent = new Map(input.runs.map((run) => [run.agentId, run]));
  const rows = requiredAgentIds.map((agentId) =>
    buildConfigOperationRow(agentId, input.configs, runByAgent),
  );
  return {
    summary: {
      totalAgents: rows.length,
      healthyAgents: rows.filter((row) => row.lastStatus === 'ok').length,
      failedAgents: rows.filter((row) => row.lastStatus === 'failed').length,
      mockAgents: rows.filter((row) => row.configState === 'mock').length,
      totalCostUsd: roundMoney(rows.reduce((sum, row) => sum + row.costUsd, 0)),
    },
    rows,
  };
}

export function planConfigAuditEntry(input: {
  readonly proposalId: string;
  readonly actor: string;
  readonly changedAgents: ReadonlyArray<RequiredAgentId>;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly reason: string;
}): ConfigAuditEntryPlan {
  return {
    kind: 'config.audit',
    proposalId: input.proposalId,
    actor: input.actor,
    changedAgents: input.changedAgents,
    beforeHash: input.beforeHash,
    afterHash: input.afterHash,
    summary: `${input.actor} changed ${input.changedAgents.join(', ')} config: ${input.reason}`,
    rollbackCommand: 'git checkout -- .rdma/agents.yaml .rdma/prompts',
  };
}

export function buildCredentialHealthCenter(input: {
  readonly requiredProviders: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
}): CredentialHealthCenter {
  const rows = input.requiredProviders.map((provider) => {
    const envVar = providerEnvVar(provider);
    const value = input.env[envVar] ?? '';
    return {
      provider,
      envVar,
      status: value ? 'ready' : 'missing',
      maskedValue: maskSecret(value),
      smokeCommand: `RDMA_PROVIDER=${provider} npm run cli -- config validate`,
    } satisfies CredentialHealthRow;
  });
  return {
    readyProviders: rows.filter((row) => row.status === 'ready').length,
    rows,
  };
}

export function buildOnboardingChecklist(input: {
  readonly hasStorageRoot: boolean;
  readonly hasConfig: boolean;
  readonly readyProviders: number;
  readonly demoRan: boolean;
}): OnboardingChecklist {
  const steps: OnboardingStep[] = [
    {
      id: 'storage',
      label: 'Choose local storage root',
      status: input.hasStorageRoot ? 'done' : 'todo',
      command: 'npm run cli -- status',
    },
    {
      id: 'config',
      label: 'Create agent config',
      status: input.hasConfig ? 'done' : 'todo',
      command: 'npm run cli -- config init',
    },
    {
      id: 'provider',
      label: 'Validate provider credentials',
      status: input.readyProviders > 0 ? 'done' : 'todo',
      command: 'npm run cli -- config validate',
    },
    {
      id: 'demo',
      label: 'Run demo delivery',
      status: input.demoRan ? 'done' : 'todo',
      command: 'npm run e2e',
    },
  ];
  return {
    completed: steps.filter((step) => step.status === 'done').length,
    steps,
    nextAction: steps.find((step) => step.status === 'todo') ?? null,
  };
}

export function buildPromptWorkbench(input: { readonly configs: ConfigRecord }): PromptWorkbench {
  const rows = requiredAgentIds.map((agentId) => {
    const prompts = input.configs[agentId]?.prompts;
    const missing = promptKeys().filter((key) => !prompts?.[key]);
    const conflicts = detectPromptConflicts(prompts);
    return {
      agentId,
      missing,
      conflicts,
      status: missing.length === 0 ? 'complete' : missing.length === 3 ? 'missing' : 'partial',
    } satisfies PromptWorkbenchRow;
  });
  return {
    summary: {
      totalAgents: rows.length,
      completePromptAgents: rows.filter((row) => row.status === 'complete').length,
      conflictAgents: rows.filter((row) => row.conflicts.length > 0).length,
    },
    rows,
  };
}

export function buildSafeExecutionPlan(input: {
  readonly proposalId: string;
  readonly requirement: string;
  readonly riskLevel: 'ready' | 'medium' | 'high';
  readonly readyProviders: number;
}): SafeExecutionPlan {
  return {
    mode: 'dry-run',
    proposalId: input.proposalId,
    commands: [
      'npm run e2e',
      `npm run cli -- deliver "${input.requirement}" --requirement "${input.requirement}" --dry-run`,
    ],
    risks: buildExecutionRisks(input.riskLevel, input.readyProviders),
  };
}

function buildConfigOperationRow(
  agentId: RequiredAgentId,
  configs: ConfigRecord,
  runByAgent: ReadonlyMap<RequiredAgentId, AgentRunSnapshot>,
): ConfigOperationRow {
  const config = configs[agentId];
  const run = runByAgent.get(agentId);
  const llm = config?.llm;
  const hasPrompts = Boolean(
    config?.prompts.soul || config?.prompts.user || config?.prompts.memory,
  );
  const configState = llm ? 'configured' : 'mock';
  const lastStatus = run?.status ?? 'unknown';
  return {
    agentId,
    provider: llm?.provider ?? 'mock',
    model: llm?.model ?? 'mock',
    promptState: hasPrompts ? 'prompts=on' : 'prompts=off',
    configState,
    lastStatus,
    latencyMs: run?.latencyMs ?? 0,
    tokens: run?.tokens ?? 0,
    costUsd: run?.costUsd ?? 0,
    hint: buildHealthHint(configState, lastStatus, run?.error),
  };
}

function renderSingleAgentYaml(input: AgentConfigPatchInput['desired']): string {
  return [
    'agents:',
    `  ${input.agentId}:`,
    '    llm:',
    `      provider: ${input.provider}`,
    `      model: ${input.model}`,
    '    prompts:',
    ...input.promptFiles.map((file) => `      - ${file}`),
  ].join('\n');
}

function findYamlValue(text: string, key: string): string | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}:`)) return trimmed.slice(key.length + 1).trim();
  }
  return null;
}

function providerEnvVar(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function promptKeys(): ReadonlyArray<'soul' | 'user' | 'memory'> {
  return ['soul', 'user', 'memory'];
}

function detectPromptConflicts(
  prompts: Pick<AgentRuntimeConfig, 'prompts'>['prompts'] | undefined,
): string[] {
  if (!prompts) return [];
  const conflicts: string[] = [];
  if (prompts.soul && prompts.user && prompts.soul.trim() === prompts.user.trim()) {
    conflicts.push('duplicate soul/user');
  }
  if (prompts.memory && prompts.user && prompts.memory.trim() === prompts.user.trim()) {
    conflicts.push('duplicate user/memory');
  }
  return conflicts;
}

function buildHealthHint(
  configState: ConfigOperationRow['configState'],
  lastStatus: AgentRunSnapshot['status'],
  error: string | undefined,
): string {
  if (error) return `Last run failed: ${error}`;
  if (lastStatus === 'ok') return 'Last run completed successfully.';
  if (configState === 'mock')
    return 'Mock provider active; configure a real provider for production-like runs.';
  return 'No recent run evidence; execute a dry-run smoke before delivery.';
}

function buildExecutionRisks(
  riskLevel: 'ready' | 'medium' | 'high',
  readyProviders: number,
): string[] {
  const risks: string[] = [`config readiness risk: ${riskLevel}`];
  if (readyProviders === 0) risks.push('no provider credentials are ready');
  if (riskLevel !== 'ready') risks.push('run stays dry-run until config validation passes');
  return risks;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
