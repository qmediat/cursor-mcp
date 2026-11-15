# Supervised Coding Skill

Optional [Claude Code skill](https://code.claude.com/docs) that lets Claude Code act as a **supervisor** while any Cursor model does the coding.

**How it works:** Claude Code analyzes the task, sends precise instructions to Cursor via `cursor_agent`, reviews the output by reading actual files from disk, and iterates with `cursor_reply` until satisfied (max 3 rounds).

> **Prerequisite:** The `cursor-cli` MCP server (this package) must be installed and configured in Claude Code first.

## Usage

```
/cursor-code <task>                              # default: auto (Cursor chooses)
/cursor-code --model <id> <task>                 # any id cursor_models lists
```

Run `cursor_models` to list the ids your CLI offers.

## Install the skill

```bash
mkdir -p ~/.claude/skills/cursor-code
```

Create `~/.claude/skills/cursor-code/SKILL.md` with the following content:

<details>
<summary>SKILL.md (click to expand)</summary>

```markdown
---
name: cursor-code
description: Delegate coding to any Cursor model while Claude Code supervises.
  Use when user says "cursor-code", "delegate to cursor", "cursor code this",
  or "/cursor-code". Works with any model id cursor_models lists (the Composer,
  Claude, GPT, Gemini and Grok families on your Cursor plan).
metadata:
  version: 1.1.0
---

# Supervised Coding: Claude Code (Supervisor) -> Cursor (Coder)

You are the **supervisor** (Claude Code). A Cursor model is the **coder**.
You give precise instructions, the coder writes code, you review and iterate.

## Parsing

Extract from user input:
- `--model <id>` -> model to use (default: `auto`, Cursor chooses)
- Everything else -> the task description

If user says a model name naturally (e.g. "use composer", "with gemini", "z grok"),
extract it and map to an id from cursor_models.

## Workflow

### Step 1: Analyze
- Read the relevant files to understand current state
- Break the user's task into a single, focused coding instruction
- Identify: target files, constraints, acceptance criteria

### Step 2: Instruct
Call `cursor_agent` with:
- `model`: extracted model or `auto`
- `workspace`: current working directory
- `prompt`: precise instruction with file paths, function names, constraints
- Keep prompt focused -- one task per call, not an entire feature
- Extract and store the `session_id` from the response for use in Step 4

Output before calling: `[cursor-cli -> <model>]`

### Step 3: Verify
After the coder returns:
- Run `git diff --name-only` to discover ALL files the coder modified
- Read EVERY modified file from disk (use Read tool) -- not just the ones from your prompt
- Diff against expectations
- Check: correctness, edge cases, security, type safety

### Step 4: Iterate (max 3 rounds)
If issues found:
- Call `cursor_reply` with the same session_id
- Give specific fix instructions (file:line, what's wrong, what to do)
- Re-verify after each round
- If the coder is fundamentally off-track (wrong approach, not just small bugs),
  abandon the session early and start fresh with a more explicit prompt

### Step 5: Report
Summarize to the user:
- Model used (confirm from response, not just request)
- What was done
- Files changed
- Rounds needed (1 = clean, 2-3 = corrections applied)
- Any manual fixes Claude Code applied directly

## Rules
- ONE task per cursor_agent call -- don't batch entire features
- ALWAYS read files from disk after coder finishes
- NEVER trust cached file contents -- Cursor writes directly to disk
- Set timeout_seconds appropriately (30-120s for typical tasks)
- If the task is trivial (< 5 lines) -- just do it yourself, don't delegate
- Follow model transparency rules -- always state [cursor-cli -> model] before call
- If cursor_agent/cursor_reply fails (timeout, auth, CLI not found) -- report the error to the user and run cursor_health to diagnose. Do not retry silently
- If unsure about valid model IDs -- call cursor_models first
```

<!-- Skill v1.1.0 — keep in sync with ~/.claude/skills/cursor-code/SKILL.md -->
</details>

Restart Claude Code after creating the skill file.
