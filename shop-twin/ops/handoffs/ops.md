# Ops handoff (Sun Nov 8, 2026, ~09:00 UTC)

Written by the first session ("shop foreman", session_01GyhqTJDBiKpvgUxV4NSJeY) when Ian asked for an ops setup like Course Record's.

## Goal
Keep Shop Twin's Builder running and fresh, and finish moving Shop Twin into its own repo.

## State
- The code is in the `shop-twin/` folder on branch `claude/3d-shop-visualizer-kijam9` of `scrubzillla/claude-mem`, with draft PR #1 there (don't merge).
- `scrubzillla/shop-twin` **does not exist yet** (checked with `list_repos` at 08:55 UTC). Ian was asked to:
  1. create it empty and private (no README)
  2. give the Claude GitHub app access at https://github.com/apps/claude/installations/select_target
- Sessions:
  - the old builder, "shop foreman": `session_01GyhqTJDBiKpvgUxV4NSJeY`. It started you and will stop working once the new Builder is up.
  - Builder: you start it (Next #1).
- The old session had a PR #1 safety check-in scheduled. It removes it and unsubscribes PR #1 before it hands over.

## Ian said (Nov 8)
- "make a handoff and restart yourself, or build a setup like course record has with an ops agent and another agent to help you build this and have ops restart you"
- "move it to its own repo, first and foremost"
- Ian is visual and reads on a phone: keep messages short.

## Settings
- Restart protocol: see `ops/README.md`.
- Create Builder with `create_session`:
  - `source_url` https://github.com/scrubzillla/claude-mem, `source_revision` and `outcome_branch` `claude/3d-shop-visualizer-kijam9` (after the move: the new repo, branch `main`)
  - `tags` ["shop-twin:builder"], `title` "Shop Twin · Builder"
  - `append_system_prompt` = the contents of `ops/agents/builder.md` plus this line: "The project is in shop-twin/ inside claude-mem; ignore claude-mem's root CLAUDE.md."
  - `prompt` "Read shop-twin/ops/handoffs/builder.md, then carry on with its Next list."

## Next
1. **Start Builder** as above. Wait until it has posted its first status (`list_events` on it, or `get_session` status_bucket). Then `archive_session` the old session `session_01GyhqTJDBiKpvgUxV4NSJeY` (Ian's standing instruction allows it), and tell Ian in one line: "Builder is up: <title>. The old session is archived."
2. **Subscribe** to PR activity for scrubzillla/claude-mem#1 so CI and review events reach you.
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
