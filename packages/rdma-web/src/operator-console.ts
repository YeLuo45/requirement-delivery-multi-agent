import type { AgentRuntimeConfig } from '@rdma/config';

export interface TuiParityCapability {
  readonly id: 'list' | 'show' | 'config' | 'new' | 'control-plane';
  readonly label: string;
  readonly tuiCommand: string;
  readonly webSurface: string;
  readonly description: string;
  readonly status: 'available';
}

export interface OperatorProposalSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
}

export interface OperatorConsoleModel {
  readonly storageRoot: string;
  readonly totalProposals: number;
  readonly delivered: number;
  readonly inFlight: number;
  readonly recent: ReadonlyArray<OperatorProposalSummary>;
  readonly capabilities: ReadonlyArray<TuiParityCapability>;
}

export interface AgentConfigRow {
  readonly agentId: string;
  readonly llm: string;
  readonly source: string;
  readonly prompts: 'prompts=on' | 'prompts=off';
}

export type RequiredAgentId =
  | 'research'
  | 'coordinator'
  | 'designer'
  | 'pm'
  | 'dev'
  | 'qa'
  | 'boss';

export interface AgentConfigWorkbenchAgent {
  readonly agentId: RequiredAgentId;
  readonly llm: string;
  readonly source: string;
  readonly prompts: 'prompts=on' | 'prompts=off';
  readonly status: 'configured' | 'mock';
  readonly note: string;
}

export interface AgentConfigWorkbenchSummary {
  readonly totalAgents: number;
  readonly configuredAgents: number;
  readonly mockAgents: number;
  readonly promptEnabledAgents: number;
  readonly coverageLabel: string;
  readonly riskLevel: 'ready' | 'medium' | 'high';
}

export interface AgentConfigWorkbenchAction {
  readonly kind: 'copy-template' | 'validate-config' | 'run-smoke';
  readonly label: string;
  readonly command: string;
  readonly description: string;
}

export interface AgentConfigWorkbenchTemplate {
  readonly agentCount: number;
  readonly yamlPreview: string;
}

export interface AgentConfigWorkbench {
  readonly summary: AgentConfigWorkbenchSummary;
  readonly agents: ReadonlyArray<AgentConfigWorkbenchAgent>;
  readonly actions: ReadonlyArray<AgentConfigWorkbenchAction>;
  readonly template: AgentConfigWorkbenchTemplate;
}

export const requiredAgentIds: ReadonlyArray<RequiredAgentId> = [
  'research',
  'coordinator',
  'designer',
  'pm',
  'dev',
  'qa',
  'boss',
];

export const tuiParityCapabilities: ReadonlyArray<TuiParityCapability> = [
  {
    id: 'list',
    label: 'List proposals',
    tuiCommand: 'list',
    webSurface: '/operator',
    description: 'Browse every proposal summary from the operator overview.',
    status: 'available',
  },
  {
    id: 'show',
    label: 'Show proposal',
    tuiCommand: 'show <id>',
    webSurface: '/proposals/:id',
    description: 'Inspect one proposal with handoff chain, artifacts, and audit log.',
    status: 'available',
  },
  {
    id: 'config',
    label: 'Agent config',
    tuiCommand: 'config',
    webSurface: '/config + /api/config',
    description: 'Review resolved per-agent provider, source, and prompt state.',
    status: 'available',
  },
  {
    id: 'new',
    label: 'New proposal',
    tuiCommand: 'new',
    webSurface: '/proposals + /api/proposals/create',
    description: 'Create a local proposal from the Web form.',
    status: 'available',
  },
  {
    id: 'control-plane',
    label: 'Control plane',
    tuiCommand: 'control-plane',
    webSurface: '/control-plane + /api/control-plane/panel',
    description: 'View sandbox, collaboration, policy, and cost-router summaries.',
    status: 'available',
  },
];

export function buildOperatorConsoleModel(input: {
  readonly storageRoot: string;
  readonly proposals: ReadonlyArray<OperatorProposalSummary>;
}): OperatorConsoleModel {
  const recent = [...input.proposals]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const delivered = input.proposals.filter((proposal) => proposal.status === 'delivered').length;
  return {
    storageRoot: input.storageRoot,
    totalProposals: input.proposals.length,
    delivered,
    inFlight: input.proposals.length - delivered,
    recent,
    capabilities: tuiParityCapabilities,
  };
}

export function buildAgentConfigWorkbench(input: {
  readonly configs: Record<string, Pick<AgentRuntimeConfig, 'source' | 'llm' | 'prompts'>>;
}): AgentConfigWorkbench {
  const rowsById = new Map(renderAgentConfigRows(input.configs).map((row) => [row.agentId, row]));
  const agents = requiredAgentIds.map((agentId) => {
    const row = rowsById.get(agentId);
    const status = row?.llm && row.llm !== 'mock' ? 'configured' : 'mock';
    return {
      agentId,
      llm: row?.llm ?? 'mock',
      source: row?.source ?? 'default',
      prompts: row?.prompts ?? 'prompts=off',
      status,
      note:
        status === 'configured'
          ? 'Provider override is active for this pipeline role.'
          : 'Mock mode is active; configure a provider before production-like runs.',
    } satisfies AgentConfigWorkbenchAgent;
  });
  const configuredAgents = agents.filter((agent) => agent.status === 'configured').length;
  const mockAgents = agents.length - configuredAgents;
  const promptEnabledAgents = agents.filter((agent) => agent.prompts === 'prompts=on').length;
  const riskLevel = mockAgents === 0 ? 'ready' : mockAgents <= 2 ? 'medium' : 'high';
  return {
    summary: {
      totalAgents: agents.length,
      configuredAgents,
      mockAgents,
      promptEnabledAgents,
      coverageLabel: `${configuredAgents}/${agents.length} configured`,
      riskLevel,
    },
    agents,
    actions: buildAgentConfigActions(riskLevel),
    template: {
      agentCount: requiredAgentIds.length,
      yamlPreview: buildAgentConfigTemplatePreview(),
    },
  };
}

function buildAgentConfigActions(
  riskLevel: AgentConfigWorkbenchSummary['riskLevel'],
): AgentConfigWorkbenchAction[] {
  const base: AgentConfigWorkbenchAction[] = [
    {
      kind: 'copy-template',
      label: 'Copy seven-agent template',
      command: 'npm run cli -- config init',
      description: 'Create a complete agents.yaml scaffold for every pipeline role.',
    },
    {
      kind: 'validate-config',
      label: 'Validate config',
      command: 'npm run cli -- config validate',
      description: 'Check provider references and prompt files before a run.',
    },
  ];
  if (riskLevel === 'ready') {
    return [
      ...base,
      {
        kind: 'run-smoke',
        label: 'Run configured smoke',
        command: 'npm run e2e',
        description: 'Exercise the configured multi-agent handoff with the hello-world flow.',
      },
    ];
  }
  return base;
}

function buildAgentConfigTemplatePreview(): string {
  const lines = ['agents:'];
  for (const agentId of requiredAgentIds) {
    lines.push(
      `  ${agentId}:`,
      '    llm:',
      '      provider: openai',
      `      model: ${agentId}-model`,
    );
  }
  return lines.join('\n');
}

export function renderAgentConfigRows(
  configs: Record<string, Pick<AgentRuntimeConfig, 'source' | 'llm' | 'prompts'>>,
): AgentConfigRow[] {
  return Object.keys(configs)
    .sort()
    .map((agentId) => {
      const config = configs[agentId];
      if (!config) {
        return {
          agentId,
          llm: 'mock',
          source: 'default',
          prompts: 'prompts=off' as const,
        };
      }
      const llm = config.llm
        ? `${config.llm.provider}${config.llm.model ? ` / ${config.llm.model}` : ''}`
        : 'mock';
      const prompts = config.prompts.soul || config.prompts.user || config.prompts.memory;
      return {
        agentId,
        llm,
        source: config.source,
        prompts: prompts ? 'prompts=on' : 'prompts=off',
      };
    });
}
