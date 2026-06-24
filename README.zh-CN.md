# requirement-delivery-multi-agent（多智能体需求交付）

> 一个通过 7-Agent 状态机，端到端交付"互联网来源需求"的多智能体系统。
> 
> 给出需求 → 产出可上线的工作产物，每一步可追溯、可审计、可回放。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![Tests: 222 passing](https://img.shields.io/badge/tests-222%20passing-brightgreen)](scripts/test-all.sh)
[![Coverage: 100.00%](https://img.shields.io/badge/coverage-100.00%25-brightgreen)](scripts/check-coverage.mjs)
[![Packages: 17](https://img.shields.io/badge/packages-17-blue)](packages)
[![Status: v0.1.0](https://img.shields.io/badge/status-v0.1.0-orange)](CHANGELOG.md)

[English README](README.md) · [项目仓库](https://github.com/YeLuo45/requirement-delivery-multi-agent) · [CHANGELOG](CHANGELOG.md)

---

## 这是什么？

RDMA 是一个**接收互联网需求 → 自动交付完成**的多智能体系统。

给定一个原始需求（例如 *"给我做一个把 JSON 转成 CSV 的 CLI"*），系统会：

```
   ┌────────────────┐
   │ market_research│  ← 1. 扫描互联网，找到类似开源项目、拆解角度、风险清单
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │   coordinator  │  ← 2. 登记提案，捕获用户意图
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │    designer    │  ← 3. （可选）UI/UX 设计稿，仅 UI 类需求进入
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │       pm       │  ← 4. 撰写 PRD、多轮澄清、产出实施计划
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │       dev      │  ← 5. TDD 用例 + 实施代码
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │       qa       │  ← 6. 验收测试；失败回流到 dev 重新实施
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │      boss      │  ← 7. 最终决策（验收 / 修订 / 上线）
   └────────────────┘
```

**每个 Agent 都留下一份 artifact、一条审计记录**。整条流水线跑完后，你可以：

- 看到完整的 **handoff 时间线**（哪个 Agent 何时接手、何时交接）
- 看到所有 **artifact 内容**（需求简报、PRD、测试用例、实施代码、验收报告、部署记录）
- 看到逐行 **审计日志**（状态转移、handoff 触发、QA 失败、Boss 决策）

## 适用场景

| 场景 | 是否适用 |
|---|---|
| 给 PM/老板一个完整的需求交付报告（含 PRD + 测试 + 实施 + 验收） | ✅ |
| 让多 Agent 自动跑完一次完整 SDD 流程（Spec → Plan → Implement → Test → Ship） | ✅ |
| 给外部 LLM Agent 暴露一组工具（via MCP），让它能交付需求 | ✅ |
| 跨多项目追踪需求交付状态（CLI + Web 面板） | ✅ |
| 在 IDE / AI 编辑器里手动指定 Agent 推进流水线 | ✅（via MCP） |
| 实时协作 / 并行多用户编辑同一个提案 | ❌（v0.1 单租户） |
| 远程数据库 / SaaS 部署 | ❌（v0.1 本地 JSON） |

## 快速开始

### 1. 安装

```bash
git clone https://github.com/YeLuo45/requirement-delivery-multi-agent.git
cd requirement-delivery-multi-agent
npm install --include=dev --ignore-scripts
```

### 2. 跑端到端冒烟测试（无需 API key）

```bash
npm test               # 全量测试：222 个测试，要求 100% 通过
npm run coverage       # 源码覆盖率门禁：要求 >=95%
npm run verify:readme  # README 命令真实验收
npm run doctor         # Node + devDeps + bin 健全性检查
npm run smoke:serve    # 端到端跑 rdma serve daemon（HTTP+WS+REST）
```

预期：

```
# tests 222
# pass  222
# fail  0
Coverage gate passed: 100.00% >= 95.00%
All README commands verified.
```

### 3. 手动交付一个需求

```bash
npm run cli -- deliver "JSON to CSV CLI" \
  --requirement "Convert a JSON array of objects to CSV." \
  --priority P2 \
  --scope small
```

输出：

```
Created P-20260619-001 (PRJ-20260619-001)
Driving through the pipeline...

Delivered: P-20260619-001
  status:      delivered
  artifacts:   8
    - requirement_brief      by market_research  — Brief: JSON to CSV CLI (3 similar projects)
    - requirement_brief      by coordinator      — Captured intent; routing directly to PM.
    - prd                    by pm               — PRD: JSON to CSV CLI
    - plan                   by pm               — Implementation plan: JSON to CSV CLI
    - test_plan              by dev              — Test plan for JSON to CSV CLI
    - implementation         by dev              — Implementation for JSON to CSV CLI
    - test_report            by qa               — QA PASS: JSON to CSV CLI
    - deployment_record      by boss             — Deployed: JSON to CSV CLI
```

### 4. 查看运行结果

```bash
# 列出所有提案
npm run cli -- list

# 查看单个提案详情（含 artifact + 审计日志）
npm run cli -- show <proposal-id>

# 系统总览
npm run cli -- status

# 检查单个提案（handoff + artifacts + audit timeline）
npm run cli -- inspect <proposal-id>

# 查看审计事件流
npm run cli -- events --proposal <proposal-id> --limit 50

# 对比两个 proposal 的 artifact + 阶段差异
npm run cli -- diff <proposal-id-a> <proposal-id-b>

# 重放单个 proposal 的 audit log 事件流（调试用）
npm run cli -- replay <proposal-id>

# 看当前 metrics snapshot（默认 read-only；`--walk` 跑一次完整管线以填充 counters）
npm run cli -- metrics
npm run cli -- metrics --no-run --format prom
npm run cli -- metrics --no-run --format json
npm run cli -- metrics --walk

# 发布验收自动化：失败 gate、PR draft、CI summary、状态推进 dry-run / recovery plan
npm run cli -- release-ops --pr-draft
npm run cli -- release-ops --json
npm run cli -- release-ops --ci-summary
npm run cli -- release-ops --write-reports
npm run cli -- release-ops apply-status --proposal P-20260623-022 --to deployed --dry-run
npm run cli -- release-ops --recovery-plan
```

### 5. 跑示例

```bash
# 单需求 hello-world
node --import tsx examples/hello-world/run.mjs

# 三样本演示（JSON→CSV / Markdown linter / 阅读追踪 Web App）
npm run bootstrap
```

### 6. 启动 MCP Server（让外部 Agent 用 RDMA）

```bash
# 长驻进程；停止用 Ctrl+C
npm run dev:server
```

把以下配置加到你的 MCP 客户端（如 Claude Code）：

```json
{
  "mcpServers": {
    "rdma": {
      "command": "npm",
      "args": ["run", "start", "--workspace=@rdma/mcp-server"],
      "cwd": "/path/to/requirement-delivery-multi-agent"
    }
  }
}
```

暴露的 6 个工具：`rdma.deliver` / `rdma.list` / `rdma.show` / `rdma.status` / `rdma.step` / `rdma.reset`。

### 7. 启动 Web 监控面板（开发模式）

```bash
# 长驻进程；停止用 Ctrl+C
npm run dev:web   # http://localhost:5173
```

> ⚠️ v0.1 web 包的 Vite build 在某些 npm registry 环境下安装 vite 失败。源码完整、API 端点就绪，开发模式（`npm run dev:web`）可用。详见 [CHANGELOG](CHANGELOG.md) v0.1.0 已知项。

## CLI 命令速查

| 命令 | 说明 | 示例 |
|---|---|---|
| `rdma deliver <title> --requirement "..."` | 创建一个提案并跑完整流水线 | `rdma deliver "Foo" --requirement "..."` |
| `rdma list [--status <stage>]` | 列出所有提案（可选按状态过滤） | `rdma list --status delivered` |
| `rdma show <proposal-id>` | 查看单个提案的完整细节 | `rdma show P-20260619-001` |
| `rdma status` | 系统状态：存储根、提案数、已注册 Agent | — |
| `rdma reset --yes` | 清空本地存储 | `rdma reset --yes` |
| `rdma demo` | 跑 3 个样本演示 | — |
| `rdma serve [--port 47555]` | 长驻 daemon：HTTP + WebSocket + `/metrics` | `rdma serve --port 47555` |
| `rdma tui [--once]` | 终端提案浏览器（`--once` 输出快照退出） | `rdma tui --once` |
| `rdma inspect <id>` | 显示单个提案的 handoff 链 + 审计时间线 | `rdma inspect P-20260619-001` |
| `rdma events [--proposal <id>]` | 流式审计事件 | `rdma events --limit 20` |
| `rdma diff <a> <b>` | 比较两个提案的 artifact 差异（`--format patch`） | `rdma diff P-A P-B --format patch` |
| `rdma replay <id>` | 把审计日志重放到 bus 上 | `rdma replay P-20260619-001` |
| `rdma metrics [--walk]` | 列出各 Agent 的指标快照 | `rdma metrics` |
| `rdma config show [--all] [<agent>]` | 显示解析后的 per-agent 配置 | `rdma config show --all` |
| `rdma config init [--force]` | 写一份模板 `.rdma/agents.yaml` | `rdma config init` |
| `rdma config validate` | 校验 `.rdma/agents.yaml` 语法 | `rdma config validate` |
| `rdma config path` | 打印 `.rdma` 根路径 | `rdma config path` |
| `rdma help` | 显示所有命令 | — |

可选 flag：`--url <src>`（需求来源 URL）、`--priority P0|P1|P2|P3`、`--scope small|medium|large`。

### Per-agent configuration（`.rdma/agents.yaml`）

每个 Agent 可以单独配置 LLM provider、模型、temperature、maxTokens、maxRetries、baseUrl，以及 `soul.md` / `user.md` / `memory.md` 三份 markdown prompt。`${ENV_VAR}` 占位符会被自动展开。

```yaml
# .rdma/agents.yaml
defaults:
  provider: anthropic
  model: claude-sonnet-4
  temperature: 0.2
  maxTokens: 4096

agents:
  pm:
    # 覆盖 defaults 的 provider + 模型
    provider: openai
    model: gpt-5.4
    apiKey: ${OPENAI_API_KEY}
    # 内联 system prompt；与 .rdma/agents/pm/soul.md 二选一，yaml 优先
    systemPrompt: |
      You are the RDMA PM agent. Always respond in JSON.
    # user.md 模板（`.rdma/agents/pm/user.md`），缺省用 agent 自带结构化 prompt
  dev:
    apiKey: ${ANTHROPIC_API_KEY}
    temperature: 0.1
  qa:
    apiKey: ${ANTHROPIC_API_KEY}
    forceFailure: false
```

```
.rdma/
├── agents.yaml                # 全局默认 + per-agent overrides
├── agents/
│   ├── pm/{soul,user,memory}.md
│   ├── dev/{soul,user,memory}.md
│   └── qa/{soul,user,memory}.md
├── data/
│   ├── meta.json
│   ├── proposals/<PRJ-id>/<P-id>.json
│   └── audit/<PRJ-id>/<P-id>.jsonl
└── shipped/<PRJ-id>/<P-id>.json
```

`rdma config show pm` 输出解析后的 `provider / model / apiKey / temperature / maxTokens / prompts.soul | user | memory`。`rdma config init` 写一份带 pm / dev / qa stub 的模板；`rdma config validate` 是 CI 友好的 0/1 退出码脚本。配置缺失时所有 Agent 自动降级到 mock 模式（CLI/Web/MCP 通用），保证流水线永远能跑完。

## 数据落盘位置

CLI、MCP server、Web 面板共享同一个数据目录（自动从 cwd 向上找到 monorepo root）：

```
.rdma/
├── agents.yaml                                # per-agent LLM + prompt 配置
├── agents/<id>/{soul,user,memory}.md         # 每个 agent 的人格 / 模板 / 上下文
├── data/
│   ├── meta.json                              # schema 版本
│   ├── proposals/<PRJ-id>/<P-id>.json         # 提案状态
│   └── audit/<PRJ-id>/<P-id>.jsonl            # 追加式审计日志
└── shipped/<PRJ-id>/<P-id>.json               # 部署记录
```

可通过环境变量覆盖：

```bash
RDMA_STORAGE_ROOT=/path/to/data       npm run cli -- status
RDMA_SHIPPED_ROOT=/path/to/shipped    npm run cli -- deliver "..."
RDMA_CONFIG_ROOT=/path/to/.rdma       npm run cli -- config show --all
```

## 核心概念

### Proposal（提案）

一个从需求登记到交付完成的工作单元。结构：

```ts
{
  id: "P-20260619-001",              // 全局唯一
  projectId: "PRJ-20260619-001",     // 项目分组（一天一个 PRJ）
  title: "JSON to CSV CLI",
  rawRequirement: "Convert a JSON array of objects to CSV.",
  status: "delivered",                // 当前状态
  owner: "boss",                     // 当前持有 Agent
  clarificationRound: 1,
  artifacts: [...],                  // 历史产出
  tags: { priority: "P2", scope: "small" },
  createdAt: "...",
  updatedAt: "..."
}
```

### Artifact（工作产物）

每个 Agent 在自己的 stage 上产出的工作单元。共 9 种 kind：

| kind | 产出 Agent | 内容 |
|---|---|---|
| `requirement_brief` | research / coordinator | 需求复述 + 类似项目 + 拆解角度 + 风险清单 |
| `design_spec` | designer | UI/UX 规格（布局、组件、用户流、可访问性） |
| `prd` | pm | 完整 PRD（问题、目标、非目标、验收标准） |
| `plan` | pm | 实施计划（阶段、退出标准） |
| `test_plan` | dev | TDD 用例（Jest/node:test 风格伪代码） |
| `implementation` | dev | 实施代码骨架 |
| `test_report` | qa | 验收结果（PASS / FAIL） |
| `acceptance_decision` | boss | Boss 的接受决策 |
| `deployment_record` | boss | 部署记录（路径 + 元数据） |

### Handoff（交接）

Agent 之间**不直接调用**，而是通过 `emitHandoff()` 发出 handoff 事件，由 `Pipeline.step()` 走状态机统一派发。这是组合性的关键：新增一个 Agent 不需要改其它 Agent 的代码。

### Audit Log（审计日志）

JSONL 追加日志，每个事件一行：

```json
{
  "id": "...",
  "proposalId": "P-...",
  "actor": "pm",
  "action": "stage.transition",
  "at": "2026-06-19T01:42:01.539Z",
  "detail": { "from": "clarifying", "to": "prd_pending_confirmation", "reason": "..." }
}
```

Action 类型：`proposal.create` / `stage.transition` / `artifact.append` / `handoff.emit` / `agent.handle.start` / `agent.handle.end` / `qa.failure` / `boss.accept`。

## 仓库结构

```
requirement-delivery-multi-agent/
├── AGENTS.md                       # 编码 Agent 单一事实源（必读）
├── README.md / README.zh-CN.md     # 双语项目说明
├── CHANGELOG.md                    # 版本变更记录
├── LICENSE                         # MIT
│
├── package.json                    # monorepo 根（npm workspaces）
├── tsconfig.base.json              # TS 配置（strip-only mode）
├── biome.json                      # lint + format
│
├── .pi/                            # 仿 pi-mono 的 Agent 配置目录
│   ├── prompts/                    # 9 个命令式 prompt
│   └── skills/                     # 6 个技能
│
├── docs/                           # 设计文档
│   ├── architecture.md             # 架构图 + 数据流 + 扩展点
│   ├── state-machine.md            # 14 个状态 + 转移表 + 所有权
│   ├── agents.md                   # 7 个 Agent 详解
│   └── workflows.md                # 端到端 + MCP + 返工环
│
├── packages/                       # 17 个 npm workspace 包
│   ├── rdma-core/                  # 状态机 + 协议 + 存储 + 审计
│   ├── rdma-coordinator/           # Pipeline 驱动
│   ├── rdma-research/              # 互联网需求扫描
│   ├── rdma-designer/              # UI/UX 规格
│   ├── rdma-pm/                    # PRD + 澄清 + 计划
│   ├── rdma-dev/                   # TDD + 实施
│   ├── rdma-qa/                    # 验收 + 返工环
│   ├── rdma-boss/                  # 最终决策 + 部署
│   ├── rdma-mcp-server/            # MCP 工具（stdio）
│   ├── rdma-cli/                   # `rdma` CLI 入口
│   ├── rdma-web/                   # React + Vite 监控面板
│   └── rdma-delivery-control/      # 沙箱、协作、工具策略、成本路由控制面
│
├── scripts/                        # 工具脚本
│   ├── e2e-hello-world.test.ts     # 端到端测试
│   ├── bootstrap-demo.mjs          # 3 样本演示
│   └── test-all.sh                 # 全套测试入口
│
└── examples/
    └── hello-world/                # 单需求 hello-world 示例
        ├── README.md
        └── run.mjs
```

## 为什么是 monorepo？

7 个 Agent + 核心状态机 + 存储层 + CLI + 监控面板必须同步演进。Monorepo 保证：

| 痛点 | Monorepo 解法 |
|---|---|
| `STATUS_TRANSITIONS` 表和 `OWNERSHIP` 表容易漂移 | 在同一个包，编译期就能发现 |
| Proposal / Artifact 类型定义不一致 | `@rdma/core` 是唯一定义点 |
| 端到端测试需要跨包组合 | `scripts/e2e-hello-world.test.ts` 一次性跑完所有包 |
| Agent 之间类型不匹配 | 通过 `@rdma/core` 的 `Agent` 接口约束 |

## 测试

| 命令 | 覆盖 |
|---|---|
| `npm run test:core` | 27 个 `@rdma/core` 单元测试（状态机 + 路径 + 所有权 + 存储 + 审计） |
| `npm run test:e2e` | 6 个端到端测试（happy path / UI 路由 / QA 返工 / artifact 健全性） |
| `npm test` | 同时跑上面两个 |

## 扩展指南

### 添加一个新 Agent

1. 在 `packages/rdma-core/src/types.ts` 的 `AGENT_IDS` 数组加上 id
2. 在 `packages/rdma-core/src/state-machine.ts` 的 `OWNERSHIP` 给新 stages 指派 owner
3. 创建 `packages/rdma-<id>/src/agent.ts`，实现 `Agent` 接口
4. 在 `packages/rdma-cli/src/run.ts` 的 `buildDeps()` 注册
5. 在 `state-machine.test.ts` 加 ownership 校验测试

### 添加一个新 Stage

1. 在 `STAGES` 数组追加 stage 名
2. 在 `STATUS_TRANSITIONS` 给出合法入边和出边
3. 在 `OWNERSHIP` 关联 owner
4. 在 `state-machine.test.ts` 加边遍历测试
5. 更新 `docs/state-machine.md`

### 添加新 Artifact Kind

1. 在 `ARTIFACT_KINDS` 数组追加 kind
2. 在对应 Agent 的 `handle()` 中 emit 该 kind 的 artifact

## 已知限制（v0.1）

| 限制 | 影响 | 路线图 |
|---|---|---|
| `market_research` 用桩数据 | 真实场景下需接入 Tavily / Google CSE | v0.2 替换 `CannedResearchProvider` |
| 单租户 / 单用户 | 不支持多人协作同一提案 | v0.3 引入 session 模型 |
| 本地 JSON 存储 | 无并发写保护 | v0.2 替换为 SQLite（接口不变） |
| `pm`/`qa`/`boss` 自动推进 | 真实场景需人工介入 | v0.2 加入 prompt-and-block 模式 |
| Web 面板 build 在某些 npm registry 受阻 | 监控面板不能用生产 build | 切 pnpm 或等 registry 恢复 |
| 没有 LLM | 所有 Agent 用确定性 mock | v0.2 在每个 Agent 加 `modelProvider` 注入点 |

## 设计参考

| 仓库 | 采纳的设计 |
|---|---|
| [pi-mono](https://github.com/YeLuo45/pi-mono) | monorepo 结构、`packages/*`、`.pi/` 目录、AGENTS.md 规则、Node strip-only TS |
| [ma-prj-proposal-manager](https://github.com/YeLuo45/ma-prj-proposal-manager) | 7-Agent 状态机、Handoff Timeline、Agent Roster |
| [spec-kit](https://github.com/YeLuo45/spec-kit) | Spec-Driven Development、IntegrationBase、模板驱动 |
| [OpenSpec](https://github.com/YeLuo45/OpenSpec) | Artifact Graph 数据模型 |
| [pm-skills](https://github.com/YeLuo45/pm-skills) | Plugin > Command > Skill 三层架构 |
| [superpowers](https://github.com/YeLuo45/superpowers) | Brainstorm → Spec → TDD → subagent → verification |

## 贡献

详见 [AGENTS.md](AGENTS.md) §10-14（Git / Issue / PR / Test / Changelog / Release）。

提交 PR 前必读：

- 代码改动跑 `npm run check`（biome + tsc）
- 测试改动跑对应包的测试
- 状态机改动必须更新 `state-machine.test.ts`
- 新 Agent 必须更新 `docs/agents.md` 和 OWNERSHIP 表

## Delivery Control Plane

`@rdma/delivery-control` 提供安全自治交付所需的控制面工具：

- `buildDeliveryPlan()` + `executeSandboxPatch()`：规划并写入隔离 sandbox，输出可审查 patch bundle。
- `evaluateToolRequest()` + `publishPolicyAuditEvent()`：把工具策略 allow/deny 决策转成审计事件。
- `subscribePolicyAuditBus()`：把策略事件 fan-out 给多个订阅者（CLI/TUI/Web）。
- `attachPolicyAuditToEventBus()`：把 `PolicyAuditBus` 适配到真实 `EventBus`，让 allow/deny 事件走 realtime 流。
- `renderCostPrometheus()`：输出 `rdma_cost_*` Prometheus 文本。
- `renderControlPlanePanel({mode: 'prom' | 'json' | 'tui'})`：统一输出 CLI/TUI/Web 面板。
- `buildSandboxPreview()`：在不写盘的情况下生成 patch bundle。
- `rdma sandbox apply --workspace-root <path> --proposal <id> --files <path>=<content> [--dry-run]`：从 CLI 应用或预览 sandbox 补丁。
- `rdma metrics --cost` 输出成本 Prometheus 指标；`rdma tui --control-plane`（或在 TUI 内输入 `[p]lane`）打印面板摘要。
- Web 面板 `GET /api/control-plane/panel` 与 `GET /api/control-plane/cost`：分别返回四个方向 JSON 与 Prometheus 文本。
- Web 面板 `GET /api/acceptance-evidence`：返回与首页 Overview 相同的验收证据模型。
- Web 首页 Overview 直接展示验收证据面板：从 accepted/deployed/delivered 提案 notes 中汇总 `check`、`npm test`、`coverage`、`verify:readme`、`build` 五个硬门禁。
- `npm run release:local`：本地串行执行 check/test/coverage/verify:readme/build，并把 README demo JSON 副作用与普通脏文件分开报告。
- `npm run release:local -- --json --proposal P-20260623-019 --title "V22-V24 ledger"`：只输出机器可读 release evidence JSON，不执行五个 gate。
- `npm run release:local -- --json --proposal P-20260623-019 --title "V22-V24 ledger" --write-history`：把同一 JSON payload 写入 `artifacts/release-local/<timestamp>.json`，用于本地验收历史 ledger。
- `npm run cli -- release-ops --pr-draft`：汇总最新 release history、失败 gate、commit manifest，并生成可复制的 PR 文本与 `git add -- <path>` 暂存建议；命令只打印建议，不执行 git。
- `npm run cli -- release-ops --json`：输出稳定 `release-ops.v2` 自动化 JSON，包含 `stageCommands`、`statusSuggestions`、`prDraftMarkdown`。
- `npm run cli -- release-ops --ci-summary`：输出 GitHub Actions step summary 友好的交付闭环摘要，只建议安全下一状态，不修改提案。
- `npm run cli -- release-ops --write-reports`：把 `delivery-report.md`、`ci-evidence.md`、`automation.json` 写入 `release-local/`，供 CI artifact 和 Web 页面复用。
- `npm run cli -- release-ops --recovery-plan`：根据最新 release history 和当前 status 输出 MCP 状态恢复命令，避免跳级或回退。

这些 API 都是本地纯 TypeScript 逻辑，不执行 shell，不访问外网。

## License

MIT — 见 [LICENSE](LICENSE)。

---

**v0.1.0** · 33/33 tests passing · GitHub: [YeLuo45/requirement-delivery-multi-agent](https://github.com/YeLuo45/requirement-delivery-multi-agent) · 后续路线见 [ITERATIONS.md](ITERATIONS.md)