---
name: setup
description: Set up fleet on this host as a wizard - check the tools and settings, ask for the missing values, run scripts/setup.sh, then the optional parts. Use after a first checkout, on a new machine or VPS, or to check an existing setup.
---

# Setup wizard

Walk the user through setting up fleet on this host, one round of questions at a time. Facts come from `README.md` (sections Set up a machine, Configuration, Set up a VPS); this skill only orders them into a wizard. Reply in the user's language.

The wizard ends at the clone. Setting up a cloned repo (dependencies, database, `.env`) follows that repo's read-first file; name it, leave it to the user.

## How to ask

- Ask with the agent's question tool (AskUserQuestion in Claude Code) where there is one, else as a numbered list in chat.
- Each question carries a recommended answer, taken from what you found: the user can answer "yes" to every round.
- Ask only about values that are missing, broken, or that the user wants to change. A value `check.sh` reports as `ok` is shown, not asked.

## 1. Check

Run `bash .agents/skills/setup/check.sh` from the fleet root and show its report. Each line is `ok`, `--` (optional or not chosen yet) or `!!` (broken). An agent sandbox can block the keychain (`gh` then looks signed out) and writes to `~` and to the repos folder; say so when a line could be the sandbox, not the host.

If every line is `ok`, say so and ask whether anything should change; otherwise go on.

## 2. Host settings

Ask for each value of `fleet.local.json` that is missing or `!!`. With a valid file, ask once: "keep these settings?"

- **root**: the folder that holds the repos. Recommend the folder holding fleet; on a VPS `~/Development`.
- **host**: the short name of this computer, its folder name in the usage data (`<data repo>/<host>/`). Recommend the host name, lowercased, dashes for anything else. When that folder exists, recommend keeping the name: a new name starts new data.
- **flat**: recommend `no` on a laptop (repos in their `dir`), `yes` on a VPS.
- **data**: the Git remote of the user's private data repo, which holds `fleet.json` (the repo list) and the usage data. Recommend the remote the other hosts use (their `fleet.local.json`); a user without one creates an empty private repo and puts a `fleet.json` in it, started from `fleet.example.json`. `none` keeps both inside fleet, ignored by Git.
- **clone**: when `check.sh` lists missing repos, ask whether to clone them now. Recommend yes, and name the repos `os` leaves out here.
- **third-party skills**: when `check.sh` lists missing skills from `skills.json`, ask whether to install them now. Recommend yes; it needs Node and the network.

## 3. Run setup

Run `scripts/setup.sh` with the answers as environment variables, so it asks nothing:

```sh
FLEET_ROOT=<root> FLEET_HOST=<host> FLEET_FLAT=<yes|no> FLEET_DATA=<remote|none> FLEET_CLONE=<yes|no> FLEET_SKILLS=<yes|no> scripts/setup.sh
```

It clones the data repo first (it holds the list), writes `~/.agents/skills`, `~/.claude/skills` and `REPOS.md`, installs the third-party skills with the `skills` CLI, and clones into root. When the agent's sandbox stops it, hand the user that exact line to run in their own terminal and wait for "done". Show the script's output.

## 4. Optional parts

Ask one multi-select round with the parts that are still `--`, each with a one-line reason:

- **Dashboard dependencies**: `pnpm install`. Needed for `pnpm dashboard`; a VPS that only collects can skip it.
- **Daily collect**: `scripts/schedule-collect.sh install [HH:MM]`, default 12:00; ask for the time. Recommend it on every host: Claude Code deletes transcripts after 30 days. It writes outside fleet (a LaunchAgent or a systemd timer), so the user may have to run it.
- **Amp usage on this host**: sets `"amp": true` in `fleet.local.json`. Offer it only when `check.sh` says no host reads Amp usage yet and the `amp` CLI is installed; one host only, or usage counts twice.
- **Background collect interval**: `collectMinutes` in `fleet.local.json`, default 15, `0` for off. Offer it only when the user asks about the dashboard's refresh.
- **Plan limits in the status line**: puts `scripts/claude-statusline.ts` in front of the status line command in `~/.claude/settings.json` (README, Plan limits). That is the user's global settings file: show the old and the new `statusLine` value and change it only on a yes.

Then do the chosen parts, the ones the sandbox allows yourself, the rest as exact commands for the user.

## 5. Steps only the user can do

List those that apply, each with what to click or type:

- `gh` signed out: `gh auth login`, then `gh auth setup-git`.
- Git identity missing: `git config --global user.name` and `user.email`.
- Codex trust `!!`: open Codex in fleet and trust the project, or it ignores `.codex/config.toml`.
- Amp orbs: import the global skills once (README, Set up a machine, step 2).
- On a VPS: T3 Connect and the rest of README, Set up a VPS, steps 4 to 6.

## Done when

`check.sh` runs again with no `!!` line, every optional part the user chose is `ok`, and you have told the user, in a short list, which steps are left for them and which `--` lines they chose to skip. A `!!` the user must fix themselves stays in that list.
