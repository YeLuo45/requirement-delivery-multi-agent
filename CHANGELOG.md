# Changelog

All notable changes to requirement-delivery-multi-agent are documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- (placeholder for the next release)

## [0.1.0] — 2026-06-19

### Added

- Initial release of the 7-agent state machine (`rdma-core`).
- 7 agent packages: `market_research`, `coordinator`, `designer`, `pm`,
  `dev`, `qa`, `boss`.
- CLI with commands: `deliver`, `list`, `show`, `status`, `reset`, `demo`.
- MCP server exposing 6 tools over stdio transport.
- React + Vite web dashboard with overview, proposal list, and detail views.
- End-to-end test suite: happy path, UI routing, QA rework loop, artifact
  sanity.
- `.pi/` directory with 9 commands (`intake`, `clarify`, `prd`, `plan`,
  `implement`, `test`, `accept`, `ship`, `status`) and 6 skills
  (`requirement-intake`, `prd-authoring`, `tdd-implementation`,
  `handoff-protocol`, `subagent-driven-delivery`, `verification-before-completion`).
- Documentation: `architecture.md`, `state-machine.md`, `agents.md`, `workflows.md`.
- Bootstrap demo with 3 sample proposals.
- Hello-world example under `examples/hello-world/`.