# How the Shop Twin agents work

This is the cloud version of Course Record's ops setup. Course Record runs its agents in terminal tabs on Ian's PC and restarts them with PowerShell. Shop Twin's agents are **Claude Code cloud sessions**, so:
- a restart means starting a new session from the agent's handoff, then archiving the old one
- the handoff lives in git, because a session's container is thrown away

| Handle | Session tag | Lane |
|---|---|---|
| `builder` | `shop-twin:builder` | The product: `app/` code, UI, tests, the running dummy shop. Ian talks to Builder about how Shop Twin works. |
| `ops` | `shop-twin:ops` | Keeps Builder alive and fresh: restarts, handoff checks, repo moves, PR housekeeping. Ian talks to Ops about the team and the setup. |

Agents find each other with `list_sessions` (`mine: true`, then match the tag; the tags filter isn't available), and talk with `send_message`.

## Handoffs

Each agent keeps `ops/handoffs/<handle>.md` current, under 16 KB, with these sections:
- **Goal**
- **State**
- **Ian said**
- **Settings**
- **Next**
- **Files**

Rewrite it whenever you finish a step. Commit and push it, so the agent can be restarted at any moment and pick up from git.

## Restart protocol

1. **Builder:** save `ops/handoffs/builder.md`, commit and push it, then send Ops: `builder handoff saved at <commit sha>, restart me`. End your turn.
   - Do this when Ian says "restart", when context is past about 60% (check `get_session` → `context_usage`), or before a big new phase.
2. **Ops:**
   - Check that the sha is on the remote branch and that the handoff file changed.
   - Start a fresh Builder with `create_session`: the environment in `ops/handoffs/ops.md` → Settings, the same repo and branch, `outcome_branch` set to that branch, tags `["shop-twin:builder"]`, title `Shop Twin · Builder`, `append_system_prompt` = `ops/agents/builder.md`, and prompt "Read ops/handoffs/builder.md, then carry on with Next."
   - Wait until it reports in, then `archive_session` the old Builder.
   - Update `ops/handoffs/ops.md`, and tell Ian in the Ops chat (one line, with the new session).
3. **Ian's standing instruction (Nov 8, 2026):** "have ops restart you". Ops may archive a Builder session it has replaced, without asking again. Ops never archives a session for any other reason without asking Ian.

## After a chat gets summarized

Once this folder is the root of its own repo, `.claude/settings.json` runs a SessionStart hook on `compact`. It reminds the agent to reread its handoff (`ops/hooks/after-compact.md`).
