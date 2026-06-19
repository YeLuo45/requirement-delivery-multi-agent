/**
 * Market research agent.
 *
 * Runs as a deterministic mock by default — produces a plausible
 * requirement brief from the raw text. Real implementations can plug a
 * web search provider behind `searchSimilarProjects()` without changing
 * the agent's handle() signature.
 *
 * Owns: research_direction_pending, research.
 *
 * Flow:
 *   research_direction_pending  → research (always; this stage just decides
 *                                 whether research is worth doing — for v0.1 we
 *                                 always say yes)
 *   research                    → intake (coordinator)
 */

import type { Agent, AgentContext, AgentId, AgentResult, Stage } from '@rdma/core';

export const RESEARCH_ID: AgentId = 'market_research';

export const RESEARCH_SCOPE: ReadonlyArray<Stage> = [
  'research_direction_pending',
  'research',
];

export interface SimilarProject {
  readonly url: string;
  readonly name: string;
  readonly oneLiner: string;
}

export interface RequirementBrief {
  readonly restatement: string;
  readonly similarProjects: ReadonlyArray<SimilarProject>;
  readonly decompositionAngles: ReadonlyArray<string>;
  readonly riskRegister: ReadonlyArray<string>;
}

/**
 * Pluggable research provider. The default implementation returns canned
 * data so the e2e flow works without a network or an API key. Replace with
 * a real provider (Tavily, Google CSE, GitHub Search) behind the same
 * interface.
 */
export interface ResearchProvider {
  searchSimilarProjects(query: string): Promise<ReadonlyArray<SimilarProject>>;
}

export class CannedResearchProvider implements ResearchProvider {
  async searchSimilarProjects(query: string): Promise<ReadonlyArray<SimilarProject>> {
    const q = query.toLowerCase();
    if (q.includes('json') && q.includes('csv')) {
      return [
        { url: 'https://github.com/flatjson/flatjson', name: 'flatjson', oneLiner: 'Flat JSON to CSV converter (Node)' },
        { url: 'https://github.com/d3/d3-dsv', name: 'd3-dsv', oneLiner: 'CSV / TSV parser and formatter (d3)' },
        { url: 'https://github.com/mafintosh/csv-parser', name: 'csv-parser', oneLiner: 'Streaming CSV parser for Node' },
      ];
    }
    if (q.includes('cli') || q.includes('command')) {
      return [
        { url: 'https://github.com/tj/commander.js', name: 'commander.js', oneLiner: 'Node CLI framework' },
        { url: 'https://github.com/yargs/yargs', name: 'yargs', oneLiner: 'CLI argument parser' },
        { url: 'https://github.com/charmbracelet/bubbletea', name: 'bubbletea', oneLiner: 'Go TUI framework for CLIs' },
      ];
    }
    return [
      { url: 'https://github.com/topics/' + encodeURIComponent(q.split(/\s+/).slice(0, 2).join('-')), name: 'github topic search', oneLiner: 'Browse related projects on GitHub' },
    ];
  }
}

export function createResearchAgent(provider: ResearchProvider = new CannedResearchProvider()): Agent {
  return {
    id: RESEARCH_ID,
    name: 'market_research',
    scope: RESEARCH_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      if (p.status === 'research_direction_pending') {
        // Always proceed to research — the real implementation would
        // ask the user (or score the requirement) whether research is
        // worth doing.
        return {
          kind: 'transition',
          nextStage: 'research',
          reason: 'Research direction approved; proceeding to scan for similar projects.',
        };
      }

      // p.status === 'research'
      const similar = await provider.searchSimilarProjects(`${p.title} ${p.rawRequirement}`);
      const brief: RequirementBrief = {
        restatement: p.rawRequirement,
        similarProjects: similar,
        decompositionAngles: [
          'Minimum viable slice: a single-file CLI that handles the common case.',
          'Library-first path: ship a `convert()` function plus a thin CLI wrapper.',
          'Streaming path: handle large inputs without loading everything in memory.',
        ],
        riskRegister: [
          'Ambiguity in input format — what schemas count as "valid"?',
          'Edge cases: empty arrays, nested objects, mixed types in arrays.',
          'Output CSV escaping for fields containing commas / quotes / newlines.',
        ],
      };

      const content = [
        `# Requirement Brief: ${p.title}`,
        '',
        `## Restatement`,
        brief.restatement,
        '',
        `## Similar open-source projects`,
        ...brief.similarProjects.map((s) => `- [${s.name}](${s.url}) — ${s.oneLiner}`),
        '',
        `## Candidate decomposition angles`,
        ...brief.decompositionAngles.map((a, i) => `${i + 1}. ${a}`),
        '',
        `## Risk register`,
        ...brief.riskRegister.map((r) => `- ${r}`),
      ].join('\n');

      return {
        kind: 'handoff',
        to: 'coordinator',
        reason: 'Research complete; brief attached.',
        artifact: {
          kind: 'requirement_brief',
          agentId: RESEARCH_ID,
          summary: `Brief: ${p.title} (${brief.similarProjects.length} similar projects)`,
          content,
        },
      };
    },
  };
}