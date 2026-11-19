---
name: brief
description: Turn a short or loose task description into a brief (goal, context, limits, done-when), ask one round of questions about real gaps, then do the work. Use for /brief or larger tasks.
---

# Brief

Task descriptions are often short or loose. Your job is to turn one into a short brief you can work from, without making the user fill in a form and without a long interview. Reply in the language the user wrote in.

## When to use this

- The user calls `/brief`: always write a brief, whatever the size of the task.
- The user didn't call it: write a brief only when the task is larger or has more than one reasonable reading. For a small change that is easy to undo and has one obvious reading (a rename, a copy change, a single-file fix), skip the brief and do the task.

## 1. Look before you ask

Read what the user said, then check the repo for anything that fills in the blanks: AGENTS.md or CLAUDE.md, the files they mentioned, a similar feature that already exists, the test and build commands. Never ask a question the codebase can answer.

## 2. Sort it into four slots

- **Goal**: what should be different at the end, and why. Write one or two full sentences. The why matters, because it decides the judgment calls later.
- **Context**: where to begin and what to follow, such as files, an existing example to copy, a design or a ticket. Pointers only, no background prose.
- **Limits**: what must not be touched or introduced, such as other packages, new dependencies or public APIs.
- **Done when**: checks you can run yourself, such as a passing build or test, or a page that looks right at named viewport widths.

Fill each slot from what the user said and what you found. Mark anything you assumed with "(assumed)" so the user can spot it.

## 3. Ask one round, only about real gaps

A gap is real when two reasonable readings would lead to different work. Ask at most three questions in a single message, and give each one a recommended answer so the user can reply "yes" or "1 yes, 2 no". Then stop asking.

"Done when" must never stay empty. If the user gave no check, propose one and mark it as assumed.

If three questions are not enough, the task is too unclear for a brief. Say so, and suggest splitting it or running a full planning session first.

## 4. Show the brief

Keep it to about a dozen lines, in this shape:

```
Goal: <one or two sentences, with the why>
Context:
- <file, example or reference>
Limits:
- <what stays untouched>
Done when:
- <check you can run>
```

Then decide whether to start:

- Nothing is marked as assumed and you asked no questions: show the brief and start right away.
- Anything is marked as assumed, or you asked questions: show the brief and wait for the user's OK.
- The user says "go" without answering a question: continue with your recommended answer.

## 5. Do the work, then check it

Work to the brief. If you discover that a limit has to be broken or the goal can't be reached as written, stop and say so instead of quietly changing scope.

At the end, run every "Done when" check and report each one as passed or failed, with what you saw. If you couldn't run a check, say that plainly. Don't call the task finished while a check is failing.
