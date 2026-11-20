# Fleet

A home repo: the control desk for a set of repos and the single source for skills used across all of them. Agents read `AGENTS.md`; this file covers the machine setup.

## Set up a machine

Clone fleet anywhere, then run:

```sh
scripts/setup.sh
```

It:

- asks once for this host's settings (root folder, host name, flat or not, the private data repo) and stores them in `fleet.local.json`; see [Configuration](#configuration);
- clones the data repo, which holds your repo list (`fleet.json`) and the dashboard's usage data;
- clones the repos from `fleet.json` that are missing, and adds their worktrees, after asking; repos limited by `os` to another system are left out;
- writes `REPOS.md`, the repo list for agents (needs Node 22.18+);
- links every global skill from `skills/` into `~/.agents/skills` (Codex, Amp, Delta) and `~/.claude/skills` (Claude Code), and removes links to skills that no longer exist;
- installs the third-party skills from `skills.json` that are missing, after asking, with the `skills` CLI (needs `npx`);
- writes `.claude/settings.local.json` and `.codex/config.toml`, so Claude Code and Codex may work in the repos folder when started in fleet.

The script is safe to rerun. Rerun it after adding a repo to `fleet.json`, changing `fleet.local.json`, adding or removing a global skill, or adding a third-party skill to `skills.json`.

**Nothing personal lives in fleet.** Your repo list and the usage data are in a private repo of your own, the data repo (for example `fleet-data`): create an empty private repo once, put your `fleet.json` in it (start from `fleet.example.json`), and give setup its remote. Without a data repo, `fleet.json` and the usage data stay inside fleet, ignored by Git.

Or let an agent started in fleet walk you through it: the local skill `setup` (`/setup`) checks this host, asks for the settings, runs the script (also installing the third-party skills) and offers the optional parts (dashboard, daily collect, Amp, plan limits). `bash .agents/skills/setup/check.sh` alone reports what is set up and what is missing, and changes nothing.

Two steps stay manual:

1. **Codex**: mark fleet as a trusted project, or it ignores `.codex/config.toml`.
2. **Amp orbs** cannot see local links. Import the skills once into Amp's hosted personal skills; see [docs/skills.md](docs/skills.md#amp-orbs-and-delta).

fleet only clones. Setting a repo up (dependencies, database, `.env`, what a new worktree needs) is the repo's job and lives in its read-first file, not here.

## Configuration

Everything fleet reads or writes, in one place.

| File | In Git | Who writes it | What it holds |
| --- | --- | --- | --- |
| `fleet.json` | in the data repo | you | the repos fleet manages; the same on every host. Without a data repo: in fleet, ignored by Git |
| `fleet.example.json` | yes | | a starting point for your `fleet.json` |
| `fleet.local.json` | no | `scripts/setup.sh`, then you | settings of this host |
| `REPOS.md` | no | `scripts/write-repo-list.ts`, setup, every collector run | readable repo list for agents, generated from `fleet.json`; Claude Code loads it through `CLAUDE.md` |
| `skills.json` | yes | you | the third-party skills every host installs, with the pinned `skills` CLI; see [docs/skills.md](docs/skills.md#skillsjson) |
| `~/.agents/.skill-lock.json` | no, outside fleet | the `skills` CLI | per host: source and installed commit of each skill the CLI installed |
| `.claude/settings.local.json` | no | `scripts/setup.sh` | lets Claude Code work in `root` when started in fleet |
| `.codex/config.toml` | no | `scripts/setup.sh` | lets Codex write in `root` when started in fleet |
| `<data>/<host>/<YYYY-MM>.json` | in the data repo | `pnpm collect` | daily usage rollups of each host; never edit by hand |
| `<data>/<host>/commits-<YYYY-MM>.json` | in the data repo | `pnpm collect` | estimated cost per commit (hash, subject, branch, tokens, cost); never edit by hand |
| `<data>/<host>/amp-threads-<YYYY-MM>.json` | in the data repo | `pnpm collect` | Amp usage per thread and day (title, tokens, billed cost); only on the host with `"amp": true` |
| `pricing.overrides.json` | yes | you | prices for models the LiteLLM list lacks or gets wrong; normally `{}` |
| `stats/` | no | `pnpm collect` | the usage data without a data repo: kept on this host only |
| `.cache/` | no | `pnpm collect` | cached LiteLLM price list (for runs without network) and `snapshot.json` with the pull requests read through `gh`, the work no commit took yet, Codex's plan limits, the site checks; `claude-limits.jsonl` from the status line script |

The types and checks of both JSON files live in `scripts/config.ts` (`Repo`, `HostConfig`).

### pricing.overrides.json

Prices per token, with the keys of the LiteLLM list. A model here is merged over the list's entry:

```json
{
  "some-new-model": {
    "input_cost_per_token": 3e-6,
    "output_cost_per_token": 1.5e-5,
    "cache_read_input_token_cost": 3e-7,
    "cache_creation_input_token_cost": 3.75e-6,
    "cache_creation_input_token_cost_above_1hr": 6e-6
  }
}
```

`pnpm collect` names every model it has no price for. Prices only apply to days computed from now on; stored days keep their cost.

### fleet.json

Lives in the data repo, at `<root>/<data repo>/fleet.json` (without a data repo: in fleet). `fleet.example.json` shows the shape:

```json
{
  "repos": [
    {
      "name": "my-plugin",
      "description": "a CMS plugin.",
      "remote": "https://github.com/you/my-plugin",
      "dir": "Plugins",
      "readFirst": "CLAUDE.md",
      "worktrees": ["2.x"],
      "stack": ["craft@5", "php@8.2", "composer"]
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Repo name, unique. Also its folder name. |
| `description` | yes | What the repo is: a lowercase phrase ending in a full stop. |
| `remote` | yes | Git remote to clone from. |
| `dir` | yes | Parent folder, relative to `root`, e.g. `AI`. `""` = `root` itself. Ignored on a flat host. |
| `readFirst` | no | File an agent reads before touching the repo. |
| `note` | no | Anything else to know. |
| `site` | no | Public site the repo serves (`https://…`); the dashboard will check it. |
| `worktrees` | no | Branches checked out next to the repo: `["2.x"]` → `my-plugin-2.x`. |
| `formerNames` | no | Earlier names of a renamed repo: `["old-name"]`. The dashboard counts sessions in old checkouts and worktrees of that name, or with that remote at the same owner, towards this repo. |
| `os` | no | Systems the repo is cloned on: `["macos"]`, `["linux"]`. Missing = all. Use `macos` for repos that are only Swift/Xcode. |
| `stack` | no | What the repo is built on and what a host must bring: tags `name` or `name@version`, framework first, e.g. `["craft@5", "php@8.4", "composer", "mysql@8.0"]`. Listed in `REPOS.md`; `pnpm stack` checks this host for the tools among them, `pnpm readiness` the tags against the repo's files. Rules and installing: [docs/environments.md](docs/environments.md#host-tools). |

A repo lives at `<root>/<dir>/<name>`, or `<root>/<name>` on a flat host. After changing `fleet.json`, run `node scripts/write-repo-list.ts` (rewrites `REPOS.md`), then commit and push the data repo. The other hosts get the change with their next collector run, which pulls the data repo and rewrites their `REPOS.md`.

### fleet.local.json

Written by `scripts/setup.sh` on its first run; edit it by hand and rerun setup to change a value. Other keys you add are kept.

```json
{
  "root": "/Users/you/Development",
  "host": "studio",
  "flat": false,
  "data": "https://github.com/you/fleet-data",
  "amp": true
}
```

| Field | Meaning |
| --- | --- |
| `root` | Absolute path of the folder that holds the repos. Default: the folder holding fleet. |
| `host` | Short name of this computer: lowercase letters, digits, inner dashes. Default: the host name in that form. The dashboard files its usage data under it (`<data>/<host>/`), so keep it once data exists: a new name starts new data. |
| `data` | Git remote of the private data repo, which holds `fleet.json` and the usage data (`<data>` in this README). It lives directly in `root`, named after the remote (`<root>/fleet-data`), also on a host that is not flat; setup clones it. `null`: no data repo, both stay in fleet, ignored by Git. More in [Keeping the data](#keeping-the-data). |
| `flat` | `false`: repos live in their `dir` (`<root>/Sites/my-site`). `true`: every `dir` is ignored, all repos live directly in `root` (`<root>/my-site`). Use it where the laptop's folders are not wanted, such as a VPS. Switching it does not move repos already cloned. |
| `collectMinutes` | Optional, default `15`. While the dashboard runs, it collects in the background every this many minutes; `0` turns it off. The refresh button in the sidebar collects at once. |
| `amp` | Optional, default `false`. `true`: this host reads the Amp account's usage with the signed-in `amp` CLI. Amp usage belongs to the account, not the computer, so set it on one host only, or it is counted twice. Setup does not ask; add it by hand. |

An old `fleet.conf` (the former format) is moved into `fleet.local.json` on the next setup run.

### Environment variables

Each one skips its question in `scripts/setup.sh`; the first four are stored in `fleet.local.json`.

| Variable | Values | Sets |
| --- | --- | --- |
| `FLEET_ROOT` | a folder, `~` allowed | `root` |
| `FLEET_HOST` | a host name | `host` |
| `FLEET_FLAT` | `yes`, `no` | `flat` |
| `FLEET_DATA` | a Git remote, or `none` | `data` |
| `FLEET_CLONE` | `yes`, `no` | clone missing repos now, or skip; not stored |
| `FLEET_SKILLS` | `yes`, `no` | install missing third-party skills from `skills.json` now, or skip; not stored |

Without a terminal (CI, a pipe), setup takes the defaults: the folder holding fleet, the host name, not flat, no data repo, no clone, no skill install.

### Keeping the data

The usage data lives in the data repo (`data` in `fleet.local.json`, for example `fleet-data`), a private repo of its own next to `fleet.json`, so fleet itself holds none and could be public. Every host writes only its own folder in it, `<data>/<host>/`. Each collector run pulls first, so the dashboard shows the other hosts too and `fleet.json` is current (it rewrites `REPOS.md` when the list changed), and after writing commits this host's folder (`chore(<host>): collect <time>`) and pushes it. Because no two hosts write the same file, the pull never meets a conflict. A failed pull or push is reported in the run's last line (`data: …`) and does not stop the run; the next run pushes what is still waiting. Each run also pulls fleet itself, as a fast-forward only: with uncommitted changes or commits of its own, fleet is left as it is and the run says why (`fleet: …`). So the global skills, which are links into fleet, follow what was pushed on every host within a day; when skills were added or removed or the dependencies changed, the line says to run `scripts/setup.sh` or `pnpm install`. `--no-sync` skips both repos, `--offline` and `--dry-run` too. Pushing needs write access to the data repo on every host (`gh auth setup-git`).

The dashboard collects when it starts, every `collectMinutes` while it runs, and when you press the refresh button (sidebar, bottom). Only one collector runs at a time (`.cache/collect.lock`); a second one, also a manual `pnpm collect`, stops at once. The sidebar shows when the last run ended and offers a reload once newer data exists; pages never reload by themselves.

Claude Code deletes its transcripts after 30 days. If the dashboard stays closed longer, those days are lost. A daily run closes that gap, independent of the dashboard and of T3 Code. Set it up once per host:

```sh
scripts/schedule-collect.sh install          # every day at 12:00
scripts/schedule-collect.sh install 08:30    # another time; rerun to change it
scripts/schedule-collect.sh status           # set up? how did the last runs go?
scripts/schedule-collect.sh remove           # take it out again
scripts/schedule-collect.sh print            # show the files install writes; changes nothing
```

- **macOS:** a LaunchAgent, `~/Library/LaunchAgents/local.fleet.collect.plist`. It runs at the set time (after waking if the Mac slept through it), at every login, and once right after install. macOS may show "Background Items Added" for `node`; that is this job (System Settings → General → Login Items lists it).
- **Linux (VPS):** a systemd user timer, `~/.config/systemd/user/fleet-collect.timer` and `.service`. A run missed while the server was down follows at boot. Without lingering it runs only while you are logged in; `t3 up` usually turned it on already, else install says so and gives the `sudo loginctl enable-linger` line. Run it once by hand with `systemctl --user start fleet-collect.service`. On a host without systemd, install prints a crontab line instead.

The job runs `node dashboard/collect/index.ts` with the `node` and `PATH` of the shell that installed it, because the collector calls `git`, `gh` and `amp`. **Rerun install after switching Node versions** (nvm, fnm), else it points at the old one. Its output goes to `.cache/collect.log`. If the dashboard collects at the same moment, the job stops at once (lock) and that is fine. Like every run, it pulls the data repo, then commits and pushes this host's folder.

### Plan limits

The dashboard shows how much of each plan window is used (Claude: 5 hours and the week; Codex: its windows) and when it resets.

- **Codex** logs its limits; `pnpm collect` picks up the latest.
- **Claude Code** passes them only to the status line command (Pro and Max, after the first reply). `scripts/claude-statusline.ts` records them in `.cache/claude-limits.jsonl` and then runs the status line command already in use, with the same input, so the status line looks as before. Put it in front of that command in `~/.claude/settings.json`:

  ```json
  "statusLine": {
    "type": "command",
    "command": "node /path/to/fleet/scripts/claude-statusline.ts pnpm dlx ccusage statusline"
  }
  ```

  Without a status line in use, leave out everything after the script's path. The script writes only when a value changes and never breaks the status line: errors are ignored and the chained command always runs.

### Commands

| Command | Does |
| --- | --- |
| `scripts/setup.sh` | sets up or updates this host; safe to rerun |
| `FLEET_CLONE=yes scripts/setup.sh` | the same, cloning missing repos and worktrees without asking |
| `FLEET_SKILLS=yes scripts/setup.sh` | the same, installing missing third-party skills from `skills.json` without asking |
| `git pull && FLEET_CLONE=yes FLEET_SKILLS=yes scripts/setup.sh` | catches a host up after changes pushed elsewhere: new repos, new or removed skills; see [docs/vps.md](docs/vps.md#keeping-the-server-current) |
| `bash .agents/skills/setup/check.sh` | reports the setup of this host (tools, `fleet.local.json`, repos, agent access, global and third-party skills, dashboard); changes nothing, exits 1 on a problem |
| `node scripts/write-repo-list.ts` | writes `REPOS.md`, the repo list for agents, from `fleet.json` (Node 22.18+) |
| `node scripts/write-repo-list.ts --check` | exits 1 if that list is out of date; changes nothing |
| `pnpm install` | installs the dashboard's dependencies (once, and after `package.json` changes) |
| `pnpm dashboard` | collects usage, then starts the dashboard on http://localhost:4321; while it runs, it collects every `collectMinutes` |
| `pnpm collect` | reads the agent session logs into `<data>/<host>/` and the pull requests through `gh` into `.cache/`, then pushes this host's data; `-- --dry-run` only reports, `-- --no-gh` skips GitHub, `-- --no-sync` neither pulls nor pushes the data repo nor pulls fleet, `-- --offline` skips GitHub, the site checks, Amp and the sync |
| `scripts/schedule-collect.sh install [HH:MM]` | collects once a day on this host, also with the dashboard closed; `status`, `remove`, `print` (see [Keeping the data](#keeping-the-data)) |
| `pnpm typecheck` | type-checks the dashboard and `scripts/` |
| `pnpm test` | runs the tests |
| `pnpm repo-list`, `pnpm repo-list:check` | the two `write-repo-list.ts` commands above |
| `pnpm readiness` | reports per repo on this host what a fresh environment needs (`.agents/setup`, `dev` script, Node pin, `.env.example`, preview configs); reads only, `-- --json` for scripts; see [docs/environments.md](docs/environments.md#make-a-repo-ready) |
| `pnpm stack` | lists the host tools the repos of this host name in `stack` (PHP, Composer, Node, a database …), which repos need each, and whether this host has it in that version; reads only, `-- --json` for scripts; see [docs/environments.md](docs/environments.md#host-tools) |
| `pnpm skills:update` | updates every global skill installed with the `skills` CLI, the ones from `skills.json` included |

## Set up a VPS

A Linux server can host the repos and the agents, with the laptop connecting through T3 Code. The steps (Git and GitHub, Claude Code, fleet, T3 Connect) are in [docs/vps.md](docs/vps.md); cloud machines that sleep when idle: [docs/t3boat.md](docs/t3boat.md).

## Other environments

Where else agents can run the repos (a personal runner, Delta Cloud Runners, Amp orbs), what reaches them there, how to preview the app on a phone and how to hand work back: [docs/environments.md](docs/environments.md). The global skills `preview` and `wrap-up` do the last two.

## Skills

- **Global** skills live in `skills/<name>/SKILL.md`; setup links them into every project on the machine.
- **Local** skills, only for working in fleet, live in `.agents/skills/<name>/SKILL.md`, such as `setup`, the setup wizard.
- **Third-party** skills are listed in `skills.json`, not copied; setup installs the missing ones on each host with the `skills` CLI, `pnpm skills:update` updates them.

How to add, update or remove each kind, and the fields of `skills.json`: [docs/skills.md](docs/skills.md).

## License

MIT, see `LICENSE`.
