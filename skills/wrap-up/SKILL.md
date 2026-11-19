---
name: wrap-up
description: Hand a finished task back to a person who reviews it later, on another computer or a phone - one block with repo, branch, PR or commit, preview link, checks, changes, open points and the thread link. Use when the user or a task prompt asks for a wrap-up, hand-back or status to review elsewhere.
---

# Wrap-up

The reader was not here. They open this on a phone, maybe hours later, maybe in another app than the one you ran in. Every field is a fact you checked in this session or says plainly that it is missing; a field is never dropped. (For handing work to another agent, the `handoff` skill fits instead.)

## The block

```markdown
**<repo>** · `<branch>` · <PR URL | commit <short hash> pushed | commit <short hash>, not pushed | uncommitted>
Preview: <URL> (<who can open it>, <how long it lives>) | none
Checks: `<command>` passed | `<command>` failed: <one line> | not run: <why>
Changed:
- <what is different for the user or the code, one line each>
Open:
- <what is left, unsure or needs a decision> | nothing
Thread: <URL | id> | none in this app
```

## Filling it

- **Repo and branch**: `git rev-parse --abbrev-ref HEAD`; a PR from `gh pr view --json url -q .url`. Push state from `git status -sb`.
- **Preview**: the link the `preview` skill handed over, with who can open it. A link that needs the laptop to stay awake says so.
- **Checks**: each command you ran, as you saw it end. A check you skipped is listed with its reason.
- **Changed**: outcomes, not a file list; the diff and the PR hold the files.
- **Thread**: where to find this conversation, as the app names it: Amp `https://ampcode.com/threads/$AMP_THREAD_ID` when that variable is set; Delta the id in `DELTA_CURRENT_THREAD_ID` (the user opens it from Delta's thread list); T3 Code the thread link its tools return; Claude Code on the web the id in `CLAUDE_CODE_REMOTE_SESSION_ID`. Write `<URL | id> | none in this app`. A thread is private by default; its link is for the people it is shared with.

Write full URLs, so they open from a phone. Leave out secrets, tokens and `.env` values.

## Where it goes

Into your final reply. When you write or update the PR body in the same task anyway, put the block there too, under the `pr` skill's Evidence. Comments on GitHub or in other apps go out only when the user asks.
