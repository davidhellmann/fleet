---
name: setup
description: Set up fleet on this host as a wizard - check the tools and settings, ask for the missing values, run scripts/setup.sh, then the optional parts; on a Linux server also Node, T3 Code and the daily collect. Use after a first checkout, on a new machine or VPS, or to check an existing setup.
---

# Setup wizard

Walk the user through setting up fleet on this host, one round of questions at a time. Facts come from `README.md` (sections Set up a machine, Configuration), `docs/vps.md` and `docs/skills.md`; this skill only orders them into a wizard. Reply in the user's language.

The wizard ends at the clone. Setting up a cloned repo (dependencies, database, `.env`) follows that repo's read-first file; name it, leave it to the user.

**On a server** (`check.sh` prints `on linux` and a Server section) the wizard also does the server steps of `docs/vps.md`: sections 2 and 5 below. The user started it after the short way in `docs/vps.md`, so `gh` and `claude` are usually signed in already.

## How to ask

- Ask with the agent's question tool (AskUserQuestion in Claude Code) where there is one, else as a numbered list in chat.
- Each question carries a recommended answer, taken from what you found: the user can answer "yes" to every round.
- Ask only about values that are missing, broken, or that the user wants to change. A value `check.sh` reports as `ok` is shown, not asked.

## Commands only the user can run

Never ask for a password, token or login code, and never run a login or `sudo` yourself. Hand the user the exact command instead and wait for "done":

- A command that asks for input (`sudo`, `gh auth login`, `claude auth login`, `t3 up --connect`): in their own terminal, such as a second SSH session.
- A command that asks nothing: they can also type it in Claude Code with `!` in front (`! <command>`); its output then reaches you.

Then run `check.sh` again to see that it worked.

## 1. Check

Run `bash .agents/skills/setup/check.sh` from the fleet root and show its report. Each line is `ok`, `--` (optional or not chosen yet) or `!!` (broken). An agent sandbox can block the keychain (`gh` then looks signed out) and writes to `~` and to the repos folder; say so when a line could be the sandbox, not the host.

If every line is `ok`, say so and ask whether anything should change; otherwise go on.

## 2. Server tools (Linux only)

Before `scripts/setup.sh`, which needs them. Skip what is `ok`.

- **user `!!`** (running as root): stop. The user logs in as their normal user (`forge` on a Forge server), clones fleet there and starts again.
- **git identity**: ask for name and email, then run `git config --global user.name` and `user.email` yourself.
- **gh** missing or signed out: hand over `sudo apt install gh`, then `gh auth login` and `gh auth setup-git`. Needed for the private repos and to push the usage data.
- **node** missing or too old: install it yourself with nvm, no `sudo` needed. Take the install line from https://github.com/nvm-sh/nvm (its README names the current version), then `nvm install --lts`. Your shell does not reload the profile between commands: start each later command that needs Node with `. "$HOME/.nvm/nvm.sh" &&`. Check `node -v` is 22.18 or newer.

## 3. Host settings

Ask for each value of `fleet.local.json` that is missing or `!!`. With a valid file, ask once: "keep these settings?"

- **root**: the folder that holds the repos. Recommend the folder holding fleet; on a server `~/Development`.
- **host**: the short name of this computer, its folder name in the usage data (`<data repo>/<host>/`). Recommend the host name, lowercased, dashes for anything else; on a server a short name such as `vps`. When that folder exists, recommend keeping the name: a new name starts new data.
- **flat**: recommend `no` on a laptop (repos in their `dir`), `yes` on a server.
- **data**: the Git remote of the user's private data repo, which holds `fleet.json` (the repo list) and the usage data. Recommend the remote the other hosts use (their `fleet.local.json`); a user without one creates an empty private repo and puts a `fleet.json` in it, started from `fleet.example.json`. `none` keeps both inside fleet, ignored by Git.
- **clone**: when `check.sh` lists missing repos, ask whether to clone them now. Recommend yes, and name the repos `os` leaves out here.
- **third-party skills**: when `check.sh` lists missing skills from `skills.json`, ask whether to install them now. Recommend yes; it needs Node and the network.

## 4. Run setup

Run `scripts/setup.sh` with the answers as environment variables, so it asks nothing:

```sh
FLEET_ROOT=<root> FLEET_HOST=<host> FLEET_FLAT=<yes|no> FLEET_DATA=<remote|none> FLEET_CLONE=<yes|no> FLEET_SKILLS=<yes|no> scripts/setup.sh
```

With Node from nvm, put `. "$HOME/.nvm/nvm.sh" &&` in front. It clones the data repo first (it holds the list), writes `~/.agents/skills`, `~/.claude/skills` and `REPOS.md`, installs the third-party skills with the `skills` CLI, and clones into root. When the agent's sandbox stops it, hand the user that exact line to run in their own terminal and wait for "done". Show the script's output.

## 5. Server services (Linux only)

`docs/vps.md`, steps 4 and 5. Do them in this order:

1. **T3 Code**: install the CLI yourself (`curl -fsSL https://t3.codes/install.sh | sh`). Then hand over `t3 up --connect`: it prints a link and a code, the user opens the link on the laptop, checks the code and approves. Check with `t3 status`.
2. **Lingering** `--`: hand over `sudo loginctl enable-linger "$(id -un)"`, then run `t3 up` once more yourself. Without it T3 Code and the daily collect stop when the user logs out.
3. **Daily collect**: run `scripts/schedule-collect.sh install` yourself, with nvm loaded so the job gets that `node`; ask for the time, default 12:00. Recommend it: no dashboard runs on a server, so nothing else collects there.
4. **Optional**, ask in one multi-select round: `t3 service protect` (the server stays reachable when agents fill the memory; run it yourself) and `sudo t3 browser setup` (only if browser tabs or HTML previews fail; hand it over).

## 6. Optional parts

Ask one multi-select round with the parts that are still `--`, each with a one-line reason; on a server only those that apply there:

- **Dashboard dependencies**: `pnpm install`. Needed for `pnpm dashboard`; a server that only collects skips it.
- **Daily collect** (not on a server, done in section 5): `scripts/schedule-collect.sh install [HH:MM]`, default 12:00; ask for the time. Recommend it on every host: Claude Code deletes transcripts after 30 days. It writes outside fleet (a LaunchAgent or a systemd timer), so the user may have to run it.
- **Amp usage on this host**: sets `"amp": true` in `fleet.local.json`. Offer it only when `check.sh` says no host reads Amp usage yet and the `amp` CLI is installed; one host only, or usage counts twice.
- **Background collect interval**: `collectMinutes` in `fleet.local.json`, default 15, `0` for off. Offer it only when the user asks about the dashboard's refresh.
- **Tools the repos need**: run `node scripts/stack.ts` and offer this when it shows `!!` lines: what the repos' `stack` in `fleet.json` names (PHP, Composer, Node, pnpm, a database) and this host lacks, with the repos that need each. Install per `docs/environments.md`, Host tools: Node versions with nvm yourself, the rest as commands for the user (`brew` on a Mac, `sudo apt` on a server; on a Forge server PHP versions, MySQL and Redis come from Forge). A `--` line is a database or Redis outside `PATH`: ask whether it runs elsewhere before installing one.
- **Plan limits in the status line**: puts `scripts/claude-statusline.ts` in front of the status line command in `~/.claude/settings.json` (README, Plan limits). That is the user's global settings file: show the old and the new `statusLine` value and change it only on a yes.

Then do the chosen parts, the ones the sandbox allows yourself, the rest as exact commands for the user.

## 7. Steps only the user can do

List those that apply, each with what to click or type:

- `gh` signed out: `gh auth login`, then `gh auth setup-git`.
- Git identity missing (on a server, section 2 sets it): `git config --global user.name` and `user.email`.
- Codex trust `!!`: open Codex in fleet and trust the project, or it ignores `.codex/config.toml`.
- Amp orbs: import the global skills once (`docs/skills.md`, Amp orbs and Delta).
- On a server, on the laptop: in T3 Code choose the server, enable Claude under **Settings → Providers** and add the projects by their path on the server (`docs/vps.md`, step 6). Each project's `.env` and the rest of its setup: `docs/vps.md`, Setting up a project.
- On a server, later: after changes pushed from the laptop, the one line in `docs/vps.md`, Keeping the server current.

## Done when

`check.sh` runs again with no `!!` line, every optional part the user chose is `ok`, and you have told the user, in a short list, which steps are left for them and which `--` lines they chose to skip. A `!!` the user must fix themselves stays in that list.
