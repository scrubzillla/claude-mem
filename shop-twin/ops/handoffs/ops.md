# Ops handoff (Sun Nov 8, 2026, ~09:05 UTC)

First written by "shop foreman" (session_01GyhqTJDBiKpvgUxV4NSJeY); now kept by Ops (session_01GyhqTLsJD8kyfbCtaiAQXH, tag `shop-twin:ops`).

## Goal
Keep Shop Twin's Builder running and fresh, and finish moving Shop Twin into its own repo.

## State
- The code is in the `shop-twin/` folder on branch `claude/3d-shop-visualizer-kijam9` of `scrubzillla/claude-mem`, with draft PR #1 there (don't merge).
- `scrubzillla/shop-twin` **does not exist yet** (checked with `list_repos` at 08:55 UTC). Ian was asked to:
  1. create it empty and private (no README)
  2. give the Claude GitHub app access at https://github.com/apps/claude/installations/select_target
- Sessions:
  - Ops: `session_01GyhqTLsJD8kyfbCtaiAQXH` ("Shop Twin · Ops").
  - Builder: `session_01GyhqTJyFqeUqn7tqVHxykH` ("Shop Twin · Builder"), started 08:59 UTC from handoff commit 69027ef.
  - Old "shop foreman" `session_01GyhqTJDBiKpvgUxV4NSJeY`: **still not archived.** At 09:01 UTC `archive_session` was denied by the auto-mode permission check ("External System Writes"). Ian has to approve it, add an allow rule for `mcp__claude-code-remote__archive_session`, or archive it himself in the app.
- Ops is subscribed to PR activity on claude-mem#1 (since 09:00 UTC).
- Builder handoff last pushed at 4d5c30f (09:38 UTC).
- Waiting on Ian: `scrubzillla/shop-twin` still doesn't exist (`list_repos` at ~09:30 UTC). Ops can't create repos from this session.
- Ideas offered to Ian, waiting on his yes: (a) after the move, add Ponytail plus 3 Superpowers skills (systematic-debugging, verification-before-completion, test-driven-development) in the repo's `.claude/`; (b) after the UI cleanup, Builder upgrades vendored three.js r160 → r187 with before/after screenshots.
- `list_sessions` has no working tags filter ("not currently available"). Use `mine: true` and match the tag. The role files and README now say so.

## Ian said (Nov 8)
- "make a handoff and restart yourself, or build a setup like course record has with an ops agent and another agent to help you build this and have ops restart you"
- "move it to its own repo, first and foremost"
- Ian is visual and reads on a phone: keep messages short.

## Settings
- Restart protocol: see `ops/README.md`.
- Create Builder with `create_session`:
  - `source_url` https://github.com/scrubzillla/claude-mem, `source_revision` and `outcome_branch` `claude/3d-shop-visualizer-kijam9` (after the move: the new repo, branch `main`)
  - `environment_id` **env_01Boz3bqSsnpYPzaxs2ppufQ** (personal env "shop-twin", Ian approved 09:3x UTC Nov 8; allows dl.polyhaven.org, api.polyhaven.com, ambientcg.com for textures, plus package registries). Builder (session_01GyhqTJyFqeUqn7tqVHxykH) runs on the default env and can't switch; it moves on its next restart.
  - `tags` ["shop-twin:builder"], `title` "Shop Twin · Builder"
  - `append_system_prompt` = the contents of `ops/agents/builder.md` plus this line: "The project is in shop-twin/ inside claude-mem; ignore claude-mem's root CLAUDE.md."
  - `prompt` "Read shop-twin/ops/handoffs/builder.md, then carry on with its Next list."

## Next
1. ~~Start Builder~~ (done; it started the shop, reported port 8787, and is on its Next #2). Archive the old `session_01GyhqTJDBiKpvgUxV4NSJeY` once Ian OKs the permission (see State). Don't work around the denial.
2. ~~Subscribe to PR #1~~ (done).
3. **Repo move** (when Ian says the repo exists, or check `list_repos` when Ian next writes):
   1. `add_repo` scrubzillla/shop-twin with push access, and clone claude-mem.
   2. `git subtree split --prefix=shop-twin -b shop-twin-split`.
   3. Push that branch to the new repo's `main`, then check that `main` has `CLAUDE.md`, `ops/` and `app/` at the root.
   4. Update the paths in CLAUDE.md and the handoffs (drop the `shop-twin/` prefix and the claude-mem notes).
   5. Close claude-mem PR #1 with a one-line pointer to the new repo, and unsubscribe.
   6. Restart Builder from the new repo (`source_url` the new repo, `outcome_branch` main, or a feature branch if Ian prefers PRs).
4. Keep this file current, then commit and push (`git pull --rebase` first).

## Files
- `ops/README.md`, `ops/agents.json`, `ops/agents/ops.md`, `ops/agents/builder.md`
- `ops/handoffs/builder.md`
- `CLAUDE.md`
