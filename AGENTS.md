# AGENTS.md

Steering for AI agents working on nightingale-song-queue. Keep edits surgical. Verify before claiming.

## Agent skills (workflow picks)

This repo is Pocock-flow territory (no OpenSpec). Picks from the fleet overlap matrix:

- Debugging: `diagnosing-bugs`. No theory until one command goes red.
- Code review: `code-review` (Standards + Spec axes).
- Spec: `to-spec` / `to-tickets` for behavior changes; only when Jason names the flow. One spec system per repo, always.
- Breakdown: `to-tickets` (tracer-bullet slices, blocking edges).
- Triage: `triage` skill using the labels in `docs/agents/triage-labels.md`. Plain issue CRUD via `gh`.
- Handoff: `handoff` skill to pass plans to Pi or a fresh session.
- Safe edits: `safe-refactor` (restructure) vs `surgical-patch` (smallest fix).
- Coding routes to Pi by default. Do not implement here unless Jason explicitly assigns the work to the current session.

## Setup notes

Engineering skills read `docs/agents/` (issue tracker, triage labels, domain docs). Configured by setup-matt-pocock-skills on 2026-10-20.
