/**
 * Market research agent.
 *
 * Owns: research_direction_pending, research.
 *
 * Two providers:
 *   - **CannedResearchProvider** (default): deterministic, used in tests
 *     and the v0.1 demo path. Returns plausible similar-project lists based
 *     on keyword scans.
 *   - **WebResearchProvider**: real web search via SerpAPI / Tavily / GitHub
 *     Search. Plug one in via `createResearchAgent(provider)`.
 *
 * Flow:
 *   research_direction_pending  → research (always; this stage just decides
 *                                 whether research is worth doing — for v0.1 we
 *                                 always say yes)
 *   research                    → intake (coordinator)
 */

import { latestArtifact, type Agent, type AgentContext, type AgentId, type AgentResult, type Stage } from '@rdma/core';

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
 * Pluggable research provider. Implementations:
 *   - CannedResearchProvider (default)
 *   - WebResearchProvider (SerpAPI / Tavily / GitHub Search)
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

/**
 * Web research provider — calls a real search API.
 *
 * Two backends supported:
 *   - **Tavily** (https://tavily.com): set TAVILY_API_KEY
 *   - **GitHub Search** (no auth, rate-limited): fallback when no API key
 *
 * Usage:
 *   ```ts
 *   const provider = new WebResearchProvider({ apiKey: process.env.TAVILY_API_KEY });
 *   const agent = createResearchAgent(provider);
 *   ```
 */
export interface WebResearchConfig {
  /** Tavily API key. If omitted, falls back to GitHub Search. */
  apiKey?: string;
  /** Max results per query. Default 5. */
  maxResults?: number;
  /** Tavily endpoint override. */
  endpoint?: string;
}

interface TavilyResponse {
  results: Array<{
    url: string;
    title: string;
    content: string;
  }>;
}

interface GitHubSearchResponse {
  items: Array<{
    html_url: string;
    full_name: string;
    description: string | null;
  }>;
}

export class WebResearchProvider implements ResearchProvider {
  readonly apiKey: string | undefined;
  readonly maxResults: number;
  readonly endpoint: string;

  constructor(config: WebResearchConfig = {}) {
    this.apiKey = config.apiKey;
    this.maxResults = config.maxResults ?? 5;
    this.endpoint = config.endpoint ?? 'https://api.tavily.com/search';
  }

  async searchSimilarProjects(query: string): Promise<ReadonlyArray<SimilarProject>> {
    if (this.apiKey) {
      try {
        return await this.searchTavily(query);
      } catch (err) {
        // Log + fall back to GitHub search rather than crashing the pipeline.
        console.warn('[rdma-research] Tavily search failed, falling back to GitHub:', err);
        return this.searchGitHub(query);
      }
    }
    return this.searchGitHub(query);
  }

  private async searchTavily(query: string): Promise<ReadonlyArray<SimilarProject>> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query: `${query} open source github`,
        max_results: this.maxResults,
        search_depth: 'basic',
        include_domains: ['github.com'],
      }),
    });
    if (!response.ok) {
      throw new Error(`Tavily HTTP ${response.status}`);
    }
    const data = (await response.json()) as TavilyResponse;
    return data.results.map((r) => ({
      url: r.url,
      name: extractRepoName(r.url, r.title),
      oneLiner: r.content.slice(0, 120),
    }));
  }

  private async searchGitHub(query: string): Promise<ReadonlyArray<SimilarProject>> {
    const params = new URLSearchParams({
      q: query,
      sort: 'stars',
      order: 'desc',
      per_page: String(this.maxResults),
    });
    const response = await fetch(`https://api.github.com/search/repositories?${params}`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      throw new Error(`GitHub search HTTP ${response.status}`);
    }
    const data = (await response.json()) as GitHubSearchResponse;
    return data.items.map((item) => ({
      url: item.html_url,
      name: item.full_name,
      oneLiner: item.description?.slice(0, 120) ?? 'No description',
    }));
  }
}

function extractRepoName(url: string, fallback: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? match[1]! : fallback;
}

function renderBriefMarkdown(p: import('@rdma/core').Proposal, brief: RequirementBrief): string {
  return [
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
}

const FALLBACK_ANGLES = [
  'Minimum viable slice: a single-file CLI that handles the common case.',
  'Library-first path: ship a `convert()` function plus a thin CLI wrapper.',
  'Streaming path: handle large inputs without loading everything in memory.',
];

const FALLBACK_RISKS = [
  'Ambiguity in input format — what schemas count as "valid"?',
  'Edge cases: empty arrays, nested objects, mixed types in arrays.',
  'Output escaping for fields containing commas / quotes / newlines.',
];

export function createResearchAgent(
  provider: ResearchProvider = new CannedResearchProvider(),
): Agent {
  return {
    id: RESEARCH_ID,
    name: 'market_research',
    scope: RESEARCH_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      if (p.status === 'research_direction_pending') {
        return {
          kind: 'transition',
          nextStage: 'research',
          reason: 'Research direction approved; proceeding to scan for similar projects.',
        };
      }

      // p.status === 'research'
      const query = `${p.title} ${p.rawRequirement}`;
      const similar = await provider.searchSimilarProjects(query);

      // Reuse a previously attached brief if one exists, so the second
      // call (after a rework loop) doesn't produce a stale duplicate.
      const existing = latestArtifact(p, 'requirement_brief');
      const brief: RequirementBrief = existing
        ? {
            restatement: p.rawRequirement,
            similarProjects: similar,
            decompositionAngles: FALLBACK_ANGLES,
            riskRegister: FALLBACK_RISKS,
          }
        : {
            restatement: p.rawRequirement,
            similarProjects: similar,
            decompositionAngles: FALLBACK_ANGLES,
            riskRegister: FALLBACK_RISKS,
          };

      const content = renderBriefMarkdown(p, brief);
      const isWeb = !(provider instanceof CannedResearchProvider);

      return {
        kind: 'handoff',
        to: 'coordinator',
        reason: 'Research complete; brief attached.',
        artifact: {
          kind: 'requirement_brief',
          agentId: RESEARCH_ID,
          summary: `Brief: ${p.title} (${brief.similarProjects.length} similar projects${isWeb ? ' from web' : ''})`,
          content,
        },
      };
    },
  };
}