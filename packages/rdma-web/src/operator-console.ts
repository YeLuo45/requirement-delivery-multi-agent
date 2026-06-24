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
