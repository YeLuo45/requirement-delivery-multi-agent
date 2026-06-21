# 迭代路线图（ITERATIONS）

> v0.1 已交付：33/33 tests passing、7-Agent 状态机、CLI/MCP/Web 三入口、`.pi/` + docs + examples。
> 
> 本文档列出后续可推进的方向。每个方向独立，可单独进入一轮迭代。

## 总览：5 个候选方向

| 方向 | 标题 | 核心交付 | 估算 | 优先级 |
|---|---|---|---|---|
| **A** | 真实 LLM 接入 | 所有 Agent 用真实 LLM 跑通端到端 | 5–8 轮 | ★★★★★ |
| **B** | 真实持久层 | SQLite 后端 + WebSocket 实时推送 | 5–8 轮 | ★★★★ |
| **C** | 真实 Web 部署 | Vite build 修复 + GitHub Pages 部署 + 端到端可视化 | 3–5 轮 | ★★★★ |
| **D** | 多租户 + 协作 | 会话隔离 + 提案分享 + 并发锁 | 8–12 轮 | ★★★ |
| **E** | Agent 协议增强 | 跨 Agent 通讯总线 + 实时 debug + 回放 | 5–8 轮 | ★★★ |

每个方向独立成文。如果 Boss 没指定，按 **A → C → B → E → D** 顺序推进（A 和 C 价值最高、能跑通真链路）。

---

## 方向 A：真实 LLM 接入（推荐先做）

### 目标

把 7 个 Agent 全部从"确定性 mock"换成"真实 LLM 调用"，保留确定性 mock 作为 fallback（用于 e2e 测试）。

### 子任务

| # | 任务 | 细节 | 估时 |
|---|---|---|---|
| A1 | LLM Provider 抽象 | 新建 `packages/rdma-llm/`，定义 `LLMProvider` 接口（`complete()` / `embed()` / `stream()`） | 1 轮 |
| A2 | Anthropic Provider | 实现 `AnthropicProvider`，支持 Claude Sonnet/Opus | 1 轮 |
| A3 | OpenAI Provider | 实现 `OpenAIProvider`，支持 GPT-4o / o1 | 1 轮 |
| A4 | 替换 PM Agent | 用 LLM 渲染 PRD 和 plan；保留确定性版本作为 fallback | 1 轮 |
| A5 | 替换 Dev Agent | 用 LLM 渲染 test_plan + implementation；可调用 `bash`/`write_file` 工具 | 2 轮 |
| A6 | 替换 QA Agent | 用 LLM 评估 implementation vs test_plan；真实跑测试套件（vitest/jest） | 1 轮 |
| A7 | 替换 Research Agent | 接 Tavily/Google CSE/GitHub Search；LLM 综合生成需求简报 | 1 轮 |
| A8 | e2e 真实链路测试 | 跑 3 个真实需求，确认从 raw text 到可运行代码 | 1 轮 |

### 验收标准

- 跑 `npm run cli -- deliver "..." --requirement "..."`，7 个 Agent 全部用 LLM 调用真实接口
- 产出的 implementation 在 `dist/` 下可 `node` 跑
- E2E 测试加 1 个 "real LLM" 套件（用 env 变量切 mock vs real）
- 单次完整跑通成本 < $0.50

### 风险

| 风险 | 缓解 |
|---|---|
| LLM 输出非确定性 | 关键路径加 golden test；PRD/plan 加 schema 校验 |
| API 限流 | 加 retry + exponential backoff |
| Dev Agent 写出不能跑的代码 | QA Agent 用真实测试套件校验，失败回流 |

---

## 方向 C：真实 Web 部署（性价比高）

### 目标

修复 Vite build 问题，把 `@rdma/web` 部署到 GitHub Pages，作为可公开访问的监控面板 demo。

### 子任务

| # | 任务 | 细节 | 估时 |
|---|---|---|---|
| C1 | 修复 Vite build | 切 pnpm 或在 npm install 时显式装 vite@6；lockfile 锁定 | 0.5 轮 |
| C2 | 静态资源 + base path | 配置 vite.config.ts 的 `base: '/requirement-delivery-multi-agent/'` | 0.5 轮 |
| C3 | GitHub Actions 部署 | 加 `.github/workflows/deploy-web.yml`：push master → build → deploy-pages | 1 轮 |
| C4 | Mock 数据 fallback | web 部署版默认显示 canned proposals，标注"demo data" | 0.5 轮 |
| C5 | 真实数据接入 | 增加可选后端 proxy（cloudflare worker 读 .rdma/） | 1 轮 |
| C6 | 端到端验证 | 在 PR 中截图确认面板正常 | 0.5 轮 |

### 验收标准

- 访问 `https://yeluo45.github.io/requirement-delivery-multi-agent/` 能看到 demo 监控面板
- 主分支 push 自动触发部署
- README 加 "Live Demo" 链接

### 风险

| 风险 | 缓解 |
|---|---|
| vite 安装阻塞 | 用 pnpm 兜底；或在 package.json 里加 `preinstall` 钩子 |
| GitHub Pages 404 | 配置 `base` 路径 + `.nojekyll` |
| 隐私 | 默认显示 demo 数据，真实数据需 OAuth |

---

## 方向 B：真实持久层

### 目标

把 `.rdma/data/*.json` 换成 SQLite，加上 WebSocket 实时推送（审计日志流式更新）。

### 子任务

| # | 任务 | 细节 | 估时 |
|---|---|---|---|
| B1 | SQLite Storage 实现 | `packages/rdma-core/src/storage-sqlite.ts` 实现 `Storage` 接口 | 1 轮 |
| B2 | Migration 系统 | 加 schema 版本 + 自动 migration | 1 轮 |
| B3 | JSON ↔ SQLite 双写 | 过渡期同时支持两种 backend | 1 轮 |
| B4 | 实时审计推送 | 加 `EventBus` 接口，Storage 写完后 emit 事件 | 1 轮 |
| B5 | WebSocket 服务端 | `packages/rdma-realtime/`，封装 WebSocket | 1 轮 |
| B6 | WebSocket 客户端 | `@rdma/web` 接入，实时刷新 audit log | 1 轮 |
| B7 | 性能基准 | 跑 100 个并发 proposal，确认无 race condition | 1 轮 |

### 验收标准

- 单 SQLite 文件 < 50MB 装 1000 个 proposal
- 实时面板：新 proposal 创建后 < 500ms 在 UI 出现
- CLI / MCP / Web 三入口共享同一份数据

### 风险

| 风险 | 缓解 |
|---|---|
| WebSocket 防火墙 | 提供 SSE fallback |
| SQLite 写锁 | 用 WAL 模式 + busy_timeout |
| 数据迁移丢失 | 写迁移前先 tarball 备份 |

---

## 方向 E：Agent 协议增强

### 目标

给 Agent 加调试能力：每个 Agent 都能 broadcast 自己的状态、断点续跑、回放整个 handoff。

### 子任务

| # | 任务 | 细节 | 估时 |
|---|---|---|---|
| E1 | Agent Event Bus | 加 `EventBus` 接口，所有 handle 调用 emit 细粒度事件 | 1 轮 |
| E2 | Handoff 回放 | CLI 加 `rdma replay <proposal-id>`，从审计日志重放每一步 | 1 轮 |
| E3 | 断点续跑 | CLI 加 `rdma resume <proposal-id> --from <stage>` | 1 轮 |
| E4 | Dry-run 模式 | `rdma deliver --dry-run`，不写存储，只打印每个 Agent 会做什么 | 0.5 轮 |
| E5 | Agent Inspector | Web 面板加 `/agents` 页面，显示每个 Agent 的 scope + 最近 10 次 handle | 1 轮 |
| E6 | 实时调试面板 | WebSocket 推送时显示哪个 Agent 在做什么 | 1 轮 |

### 验收标准

- 任何失败的 proposal 可一键回放
- 任何 stage 可手动暂停 / 恢复
- 每个 Agent 的实时状态在 Web 可见

---

## 方向 D：多租户 + 协作

### 目标

支持多个用户在同一个 RDMA 实例上协作，互不干扰；支持提案分享链接。

### 子任务

| # | 任务 | 细节 | 估时 |
|---|---|---|---|
| D1 | User 模型 | 加 user 概念；提案 owner = userId | 1 轮 |
| D2 | Session 隔离 | 每个用户独立存储根；token 鉴权 | 2 轮 |
| D3 | OAuth 集成 | GitHub OAuth / Google OAuth | 2 轮 |
| D4 | 提案分享 | `rdma share <id>` 生成只读链接 | 1 轮 |
| D5 | 评论 + 修订建议 | Web 面板加评论功能 | 2 轮 |
| D6 | 并发锁 | 同一提案同时只能一个用户改 | 1 轮 |
| D7 | 多用户 e2e | 两个用户同时跑需求交付，验证隔离 | 1 轮 |

### 验收标准

- 两个用户在不同浏览器登录，看到各自的提案
- 用户 A 分享提案给用户 B，B 可查看但不可改
- 评论 / 修订建议可追溯

---

## 推荐推进顺序

```
第 1 轮 ──→ 方向 C（Vite build 修复 + GitHub Pages 部署）  ← ✅ 已完成 (5c38c0d)
   │
   ▼
第 2 轮 ──→ 方向 A1-A3（LLM Provider 抽象 + Anthropic + OpenAI）  ← ✅ 已完成 (031f7df)
   │
   ▼
第 3 轮 ──→ 方向 A4-A5（PM + Dev 接 LLM）  ← ✅ 已完成 (b7aad0e)
   │
   ▼
第 4 轮 ──→ 方向 A6-A8（QA + Research + 真实链路测试）  ← ✅ 已完成 (b7aad0e)
   │
   ▼
第 5+ 轮 ─→ 方向 B（SQLite + 实时推送） 或 方向 E（协议增强）
```

当前进度：A + B + C 全部完成，78/78 tests passing。下一步候选：
- **E**（Agent Event Bus + 回放 + 断点续跑 + Agent Inspector，5-8 轮）— 提升调试能力
- **D**（多租户 + 协作，8-12 轮）— 支持多用户

每轮 5 个左右的原子提交。每轮结束跑一次完整 e2e + 上传 GitHub。

## 单轮执行模板（仿其它高速迭代项目）

```bash
# 进入新一轮
git checkout master && git pull
git checkout -b feature/rdma-A1-llm-provider

# PRD 草稿
$EDITOR docs/iterations/A1-prd.md

# 委托 dev agent（或自己实现）
$EDITOR packages/rdma-llm/src/provider.ts

# 测试
npm run test:core
npm run test:e2e

# commit + push + PR
git add packages/rdma-llm/ docs/iterations/A1-prd.md
git commit -m "feat(llm): add LLM provider interface (Anthropic + OpenAI) (A1)"
git push -u origin feature/rdma-A1-llm-provider

# 等 PR 合并 → 下一轮
```

## 指标追踪

每轮交付后，更新下面这张表：

| 轮次 | 方向 | 子任务 | tests pass | 新增 LoC | commit |
|---|---|---|---|---|---|
| 0 | (v0.1.0) | — | 33/33 | ~3500 | 349eba5 |
| 1 | C | vite build fix + GH Pages | 33/33 | ~200 | 5c38c0d |
| 2 | A1 | LLM provider 接口 | 36/36 | ~400 | 031f7df |
| 3 | A2-A3 | Anthropic + OpenAI | 40/40 | ~600 | 031f7df |
| 4 | A4 | PM 接 LLM | 47/47 | ~500 | b7aad0e |
| 5 | A5 | Dev 接 LLM | 54/54 | ~500 | b7aad0e |
| 6 | A6-A8 | QA + Research + WebResearchProvider | 63/63 | ~790 | b7aad0e |
| 7 | A8-fu | mock-LLM e2e test | 65/65 | ~230 | 347bd9d |
| 8 | B1-B3 | StorageDriver + JSON/SQLite + factory | 67/67 | ~500 | 5fe2a54 |
| 9 | B4-B5 | EventBus 集成 + WS server/client | 74/74 | ~700 | b28aea5 |
| 10 | B6 | web 接入 WS + 实时 indicator | 74/74 | ~190 | cd0f243 |
| 11 | B7 | perf bench + index 修 | 78/78 | ~225 | 0e2921b |
| 12 | B8 | `rdma serve` daemon (HTTP + WS) | 84/84 | ~530 | 9c2b1fa |
| 13 | E1 | EventBus sequence + replay buffer | 109/109 | ~420 | d517d3a |
| 14 | E2 | EventEmittingStorage wrapper | 119/119 | ~240 | f17fce9 |
| 15 | E3 | `Pipeline.resumeFromStage` | 119/119 | ~260 | 9508064 |
| 16 | E4-E6 | inspect/events/diff/replay CLI + HTTP endpoints + durable journal + observability + README/CI gates | 278/278 | ~2500 | pending |
| 17 | F2-F5 + G4 | Pipeline tracer/metrics hooks + `rdma metrics` CLI + `/metrics` + `/traces` HTTP endpoints + release-on-tag workflow + bump-version script | 310+/310+ | ~700 | pending |

> 实测当前完整 **310+/310+ tests passing**（含 F2 5 + F3 5 + F5 3 + bump-version 2 = 15 新增）；源码覆盖率 **4964/4964 = 100.00%**。本轮新增门禁：`scripts/test/bump-version.test.mjs`（release 工具单元测试）已接入 `npm test` 套件。CI：`test.yml` Node 18/20/22 矩阵 + `verify-readme.yml` PR-only + `release.yml` tag-driven（含 bump-version + release-notes 自动生成）。

### B 方向性能数字

| 场景 | 结果 |
|---|---|
| JSON: 50 proposals 端到端 | **3.5s** (≈70ms/proposal) |
| SQLite: 50 proposals 端到端 | SKIP (binding absent) / ≈3s (with binding) |
| EventBus: 10k events 派发 | **30ms** (≈3μs/event) |
| WS: 5 clients × 1k events | **297ms** (≈3ms/event-incl-broadcast) |
| WS: 单 client round-trip latency | **0.2ms avg / 0.6ms max** |

---

## 决策点

进哪一轮由 boss 指定：

- `A` → 进入 LLM 接入路径
- `B` → 进入持久层路径
- `C` → 进入 Web 部署路径（最快）
- `D` → 进入多租户路径
- `E` → 进入协议增强路径
- `auto` → 按推荐顺序自动推进（先 C 后 A）

如果 Boss 不指定且无 auto 指令，进入 **C**（成本最低、价值最高）。