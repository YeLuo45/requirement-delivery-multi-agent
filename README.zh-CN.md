# requirement-delivery-multi-agent（多智能体需求交付）

> 一个多智能体系统，通过 7 个 Agent 状态机，端到端交付来自互联网的需求。

## 这是什么？

RDMA 是一个**接收原始需求 → 自动交付完成**的多智能体系统。给定一个需求（比如 "给我做一个把 JSON 转成 CSV 的 CLI"），系统会：

1. `market_research` Agent：扫描互联网，找到类似开源项目、拆解角度、风险清单
2. `coordinator` Agent：登记需求提案，捕获用户意图
3. `designer` Agent：（可选）输出 UI/UX 设计稿
4. `pm` Agent：撰写 PRD、多轮澄清
5. `dev` Agent：TDD + subagent 驱动的实施
6. `qa` Agent：测试验收
7. `boss` Agent：最终决策（验收 / 修订 / 上线）

每一步都有完整审计日志 + Handoff 时间线，可追溯哪个 Agent 在什么时候做了什么。

## 7-Agent 状态机

```
   ┌────────────────┐
   │ market_research│  ← 扫描互联网获取需求上下文
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │   coordinator  │  ← 登记提案，捕获意图
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │    designer    │  ← （可选）UI/UX 规格
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │       pm       │  ← PRD 撰写 + 澄清回合
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │       dev      │  ← TDD + subagent 驱动实施
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │       qa       │  ← 测试验收
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │      boss      │  ← 最终接受 / 修订 / 上线
   └────────────────┘
```

完整状态列表见 `docs/state-machine.md`：

`research_direction_pending` → `research` → `intake` → `ideation` → `clarifying` →
`prd_pending_confirmation` → `approved_for_dev` → `in_tdd_test` → `in_dev` →
`in_test_acceptance` → `test_failed` → `accepted` → `deployed` → `delivered`

## 快速开始

```bash
# 安装
npm install --ignore-scripts

# 跑端到端冒烟测试（不需要 API key）
npm run e2e

# 手动执行一个需求
npm run cli -- deliver "Build me a CLI that converts JSON to CSV"

# 启动监控面板
npm run dev:web

# 启动 MCP server（对外暴露 RDMA 工具）
npm run dev:server
```

CLI 把所有提案写在 `.rdma/` 下（本地 JSON + 审计日志）。Web 面板读同一个目录。

## 仓库结构

```
requirement-delivery-multi-agent/
├── AGENTS.md              # 编码 Agent 单一事实源
├── README.md              # 英文 README
├── README.zh-CN.md        # 本文件
├── docs/                  # 架构、状态机、Agent、工作流
├── .pi/                   # 面向 Agent 的 prompts + skills + extensions
├── packages/
│   ├── rdma-core/         # 状态机、Agent 协议、Handoff、存储
│   ├── rdma-coordinator/  # 需求登记 + 分发
│   ├── rdma-research/     # 互联网需求扫描
│   ├── rdma-designer/     # UI/UX 规格
│   ├── rdma-pm/           # PRD + 澄清
│   ├── rdma-dev/          # TDD + 实施
│   ├── rdma-qa/           # 测试验收
│   ├── rdma-boss/         # 最终决策
│   ├── rdma-mcp-server/   # MCP 工具接口
│   ├── rdma-cli/          # `rdma` CLI 入口
│   └── rdma-web/          # React + Vite 监控面板
└── examples/
    └── hello-world/       # 端到端示例
```

## 为什么是 monorepo？

7 个 Agent + 核心状态机 + 存储层 + CLI + 监控面板必须同步演进。Monorepo 保证：

- `STATUS_TRANSITIONS` 表和 `OWNERSHIP` 表保持同步
- Proposal / artifact 类型定义无需包边界
- 端到端测试可以一次性跑完所有包

## 什么是 "互联网需求"？

`market_research` Agent 接收一个需求 URL（或原始文本），生成结构化的**需求简报**（requirement brief），后续流水线消费这个简报。简报包括：

- 用用户的话复述需求
- 找到的 3 个最相似开源项目（URL + 一句话总结）
- 3-5 个候选拆解角度（最小可交付切片是什么？）
- 风险清单：未知、歧义、难点

简报交给 coordinator，登记提案，开始流水线。

## 当前状态

**v0.1.0** — 初始脚手架。端到端流程用确定性 mock Agent 跑通。`market_research` Agent 用桩 web 搜索返回假数据；可换成真实 Provider（同接口）。

## License

MIT — 见 [LICENSE](LICENSE)。

## 参考仓库

- [pi-mono](https://github.com/YeLuo45/pi-mono) — 底座 monorepo 约定
- [ma-prj-proposal-manager](https://github.com/YeLuo45/ma-prj-proposal-manager) — 多智能体提案管理
- [spec-kit](https://github.com/YeLuo45/spec-kit) — Spec-Driven Development 工具集
- [OpenSpec](https://github.com/YeLuo45/OpenSpec) — OpenSpec 框架
- [pm-skills](https://github.com/YeLuo45/pm-skills) — PM 技能市场
- [superpowers](https://github.com/YeLuo45/superpowers) — Agent 技能方法论