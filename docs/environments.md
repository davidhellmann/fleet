# Environments

Where agents can run the repos, what reaches them there, how to preview the app and how to hand the work back. fleet adds conventions here, not infrastructure: each provider's own setup, preview and sharing is used as it is, and the repos carry what any environment needs.

Checked on 2026-11-19 against the Delta 0.26 CLI and app and [delta.dev/docs](https://delta.dev/docs), the [Amp docs](https://ampcode.com/docs/orbs) and CLI, the [T3 Code docs](https://github.com/pingdotgg/t3code/tree/main/docs/user) and the [Claude Code docs](https://code.claude.com/docs/en/desktop). These products change weekly; [Limits](#limits) lists what was read but not tried.

## What travels, what stays

| What | Lives in | Reaches |
| --- | --- | --- |
| Project knowledge: `AGENTS.md` or `CLAUDE.md`, skills in `.agents/skills/` | the repo | every agent in every environment |
| How the repo runs: `package.json` scripts, Node pin, lockfile, `.env.example` | the repo | every environment |
| Setup of a fresh checkout: `.agents/setup` | the repo | Amp orbs, Delta Cloud Runners |
| Provider configs: `.amp/services.yaml`, `.claude/launch.json`, `t3.json` | the repo | their provider |
| Global and third-party skills, `REPOS.md`, the rules in fleet's `AGENTS.md` | fleet, linked by `scripts/setup.sh` | hosts that ran setup: laptop, VPS, t3boat machine; not managed cloud |
| Secrets | each provider's settings, a host's `.env` | that provider or host only |
| Threads, sessions, snapshots, preview links | the provider | that provider only |

Conversations and agent state do not move between providers. What moves is the branch: push it, and the next agent, in any app, starts from the repo, the PR and the hand-back (`wrap-up` skill; `handoff` for a fresh agent in the same app).

## Targets

| | Local | Personal runner | Managed cloud |
| --- | --- | --- | --- |
| Machine | the laptop | a server or Mac that stays on (VPS) | Delta Cloud Runner, Amp orb, t3boat machine |
| Repo arrives by | `scripts/setup.sh` | `scripts/setup.sh` | the provider checks it out per thread |
| Repo setup | the repo's read-first file | the same | `.agents/setup`, run by the provider |
| Skills | all, through setup | all, through setup | the repo's own; Amp also imported ones ([Skills](#skills-in-the-cloud)) |
| Secrets | `.env` | `.env` on the server | the provider's settings, as environment variables |
| Lives | always | always | per thread; sleeps when idle, deleted with the thread |

### Local

The laptop as set up by fleet's README. Previews on `localhost`; for a phone, through T3 Code or Tailscale ([Previews](#previews)).

Delta on the laptop works in copies, not in the repo folder. Seen on 2026-11-19, matching [Delta's worktree docs](https://delta.dev/docs/concepts/worktrees#where-new-threads-start):

- **Push before a new thread.** A new thread fetches the remote and starts from its default branch (`origin/main`), not from the local branch: a commit that is only local, or uncommitted work, does not reach it. Another starting branch: **Settings → General → Project Checkouts**. A thread set to **Existing Local Checkout** before its first message works in the folder itself.
- **A running thread keeps its copy.** Later commits, also those a Merge subthread landed, reach it only when the agent brings them in: "Fetch origin and bring this thread up to date with origin/main; local changes already in origin/main can be dropped." **Check** in the project menu tells whether the thread is behind the remote. Stay in a thread for follow-ups to its task; start a new one for independent work, and archive a thread once its work has landed.
- **One dev server per thread.** Each server sees only its own thread's files. Servers of earlier threads keep running, and keep their ports, until stopped in **Running Terminals** (`Cmd+Option+S`) or Delta quits.

### Personal runner

A machine of your own that agents use while the laptop is closed. Three ways in, which can share one server:

- **T3 Code with T3 Connect**: the server runs T3 Code, the laptop and phone connect to it. Set up in [vps.md](vps.md).
- **Delta Personal Runner**: `delta runner serve --name <name>` registers the machine with your Delta account and runs the turns other Delta clients send to it, with the machine's checkouts, tools and logins. It serves until stopped; it is offline after. Install headless with `curl -fsSL https://delta.dev/install.sh -o delta-install.sh && sh delta-install.sh` ([docs](https://delta.dev/docs/agents/cloud-runners)).
- **Amp**: a runner on the machine can serve portals for local threads (`--remote-control-portals`; [docs](https://ampcode.com/docs/cli/runners)); such portals cannot be public.

### Managed cloud

| | Delta Cloud Runner | Amp orb |
| --- | --- | --- |
| Machine | Debian on E2B; 2/4/8 CPUs | Amp's sandbox; sizes per project |
| Checkout | every repo attached to the thread, from Delta's servers: committed files only, no ignored or `.agents/linked` files | the project repo; more repos under `../repos/` |
| Setup | `.agents/prepare` (every checkout), then `.agents/setup`; `.delta/setup` overrides it. Snapshot cached about a day | `.agents/setup` when no fresh snapshot exists (20 min limit, snapshot kept up to 72 h); `.agents/resume` on every wake (10 s) |
| Secrets | Settings → Runners → environment variables, or import a `.env`; redacted in the transcript | workspace, project or personal settings, or `amp secrets`; personal ones not in setup |
| GitHub | Delta GitHub App or `GITHUB_TOKEN`; no `gh auth setup-git` in setup | `gh` not signed in during setup |
| Limits | 6 at once, terminals close after 1 h, pause after 10 idle min; Claude Agent turns not yet | sleeps when the agent stops, wakes with files and services |
| Ends | when the thread is archived or deleted | per thread |

A t3boat machine is closer to a personal runner that sleeps: fleet's setup runs on it ([t3boat.md](t3boat.md)). Claude Code on the web has its own setup script and environment variables in its environment settings ([docs](https://code.claude.com/docs/en/cloud-environments)); it does not read `.agents/setup`.

## Make a repo ready

`pnpm readiness` reports for every repo on this host what is there and what is missing (columns below; `--json` for scripts). It reads only.

| Column | Wants | Why |
| --- | --- | --- |
| read first | the file `readFirst` in `fleet.json` names, else `AGENTS.md` or `CLAUDE.md` | the only instructions a cloud agent gets |
| `.agents/setup` | an executable, committed script | Amp orbs and Delta Cloud Runners run it on a fresh checkout |
| dev | a `dev` script in `package.json` | the one command every preview starts |
| runtime | a Node pin (`.node-version`, `.nvmrc`, `mise.toml`, `engines`) and a package manager (`packageManager` or a lockfile) | the setup installs the right one |
| env names | `.env.example` with every variable name, no values | `!!` when a `.env` exists here but its names are nowhere in Git: a fresh environment cannot know them |
| previews | `.amp/services.yaml`, `.claude/launch.json`, `t3.json` | optional; each helps one app |
| stack | every tag the repo's files show is in its `stack` in `fleet.json`, in an agreeing version: `--` names the tags to add, `!!` a version that disagrees | agents and `pnpm stack` read it ([Host tools](#host-tools)) |

### `.agents/setup`

One script for both Amp and Delta:

- At the repo root, committed with the executable bit (`chmod +x`), `#!/usr/bin/env bash` and `set -euo pipefail`.
- **Idempotent**: Amp reruns it on top of an old snapshot. **Short**: Amp suggests under two minutes.
- Checks the runtime and installs from the lockfile (`npm ci`, `pnpm install --frozen-lockfile`).
- Leaves secrets to the provider's settings, which reach the script and the agent as environment variables. When the app cannot start without a `.env`, copy the example without overwriting: `cp -n .env.example .env`.
- Starts no servers: Amp stops what is still running when the script ends. Servers belong in `.amp/services.yaml` or start on request (`preview` skill).
- Steps for every new worktree go where each app runs them: `.agents/prepare` (Delta, keep it fast), a `t3.json` script with `runOnWorktreeCreate` (T3 Code).
- `.delta/setup` replaces `.agents/setup` for Delta only; use it only when the two must differ.

Delta keeps its local checkouts inside the repo folder, in `.delta/worktrees/` and `.delta/clones/`, and excludes them from Git itself (`.git/info/exclude`). Tools that search the folder on their own do not read that file: test runners, file watchers, linters and type checkers then also run over every thread's copy (Vitest counted each test three times). Exclude `**/.delta/**` in their config, in the repo, when it is used with Delta. The other files under `.delta/` (`setup`, `prepare`, `linked`, `skills/`) are meant to be committed.

### Host tools

`stack` in `fleet.json` names what a repo is built on and what a host must bring to run it, as tags: `name` or `name@version`.

```json
"stack": ["craft@5", "php@8.4", "composer", "mysql@8.0", "redis@7", "node@22"]
```

- The framework first, with its major (`craft@5`, `astro@7`): context for agents in `REPOS.md`, and a way to find every repo on one version.
- Then what the host installs, with the version the host has to match: PHP to the minor (`php@8.4`), Node, MySQL and Redis to the major or minor the repo needs. Package managers without one (`pnpm`): `packageManager` in `package.json` pins it.
- Nothing that `pnpm install` or `composer install` brings (Vite in an Astro repo, Craft plugins), and nothing about how a host provides a tool (Valet, DBngin, nginx).

The host tools are the tags in `HOST_TOOLS` in `scripts/stack.ts`: `php`, `composer`, `node`, `pnpm`, `yarn`, `bun`, `mysql`, `mariadb`, `postgres`, `redis`, `xcode` (macOS only). `pnpm stack` lists each one the repos of this host name, with the repos and what the host has: `ok` with the version and where it was found, also beside the active one (`php8.2` on Debian/Ubuntu, Homebrew's `opt/php@8.2`, nvm's Node versions); `!!` missing or another version; `--` a database or Redis not on `PATH`, which is fine when it runs in DBngin, Docker or on another machine. It reads only.

Installing what is `!!`:

| Tool | macOS | Ubuntu server |
| --- | --- | --- |
| PHP | `brew install php@8.4`; Valet switches per repo (`.valetrc`) | Forge: install the version under the server's PHP settings. Without Forge: `ppa:ondrej/php`, then `php8.4-cli` and the extensions the repo needs (Craft: `bcmath curl gd intl mbstring mysql xml zip`) |
| Composer | `brew install composer` | Forge brings it; else the installer from getcomposer.org |
| Node | `nvm install 22` | `nvm install 22` ([vps.md](vps.md)) |
| pnpm, Yarn | `corepack enable pnpm` with Node 22 or 24, else `npm i -g pnpm` | the same |
| MySQL, Redis | DBngin or `brew install mysql@8.0 redis` | Forge provisions both; else `apt install mysql-server redis-server` |
| Xcode | the App Store | no |

Installing needs `sudo` on a server: hand those commands to the user. A database server is only the start: the database itself, its data and the site's `.env` follow the repo's read-first file ([vps.md](vps.md#setting-up-a-project)).

### Why no run manifest

The facts a manifest would hold already have a home every tool reads: scripts and the package manager in `package.json`, the Node version in its pin file, the port in the framework config, variable names in `.env.example`, and each provider's format in its own file. A fleet manifest would be one more copy that no provider reads. So `fleet.json` stays a list of where repos live, and the report checks the repos' own files instead. Writing a provider file (`.amp/services.yaml` is five lines) is a task for the agent in that repo, not a generator.

`stack` is the one exception, for what no repo file holds: the database and the tools a host installs before any lockfile helps, and a summary to find repos by. Where a repo does pin a version (`config.platform.php` in `composer.json`, `.valetrc`, `.node-version`, `.nvmrc`, the framework in its manifest), the readiness report compares it with the tag, so the copy cannot drift unnoticed.

## Previews

The `preview` skill starts a repo's dev server and returns a link, by environment:

| Where | Link | Who can open it |
| --- | --- | --- |
| Delta Cloud Runner | `delta-runner preview url <port>`, server on `0.0.0.0` | people signed in to Delta with access to the thread; anyone with the link when the thread is shared that way |
| Amp orb | a portal (`.amp/services.yaml` with `portal`, or `amp orb portal <port>`) | people who can view the thread; public for 1 h to 7 days only when set in Amp |
| T3 Code, local or on a server | `http://localhost:<port>` in T3 Code's browser; on a phone **Open on this device** | the user, through T3 Code |
| Claude Code desktop | preview pane from `.claude/launch.json` | this computer |
| Laptop or server, another device | Tailscale Serve: `https://<machine>.<tailnet>.ts.net:<https port>` | devices in your tailnet |

Rules the skill follows:

- Private first. A public link (Tailscale Funnel, `cloudflared tunnel --url`, a public portal, a thread shared with anyone) only when the user asks for one, after naming who could open it; never for a repo whose data stays local.
- Tailscale Serve may already carry the T3 server (`t3 pair --tailscale`): check `tailscale serve status`, use a free HTTPS port, remove only its own entry.
- Vite and Astro refuse unknown host names: allow the tailnet name for the run (`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, Astro `--allowed-hosts`).
- Delta and Amp give each port its own host name; an app that calls an API on another port needs the dev server's proxy.

fleet has no `preview` command: every environment above already turns a port into a link, and a wrapper would hide the differences (who can open it, how long it lives) that matter most.

## Skills in the cloud

| Environment | Reads |
| --- | --- |
| Hosts with fleet's setup | global skills from `skills/`, third-party skills from `skills.json`, the repo's `.agents/skills/` |
| Amp orb | the repo's `.agents/skills/`, and personal skills imported into Amp ([skills.md](skills.md#amp-orbs-and-delta)) |
| Delta Cloud Runner, Delta in the browser | only the repo's `.agents/skills/` and `.delta/skills/` (the latter wins on the same name) |
| Claude Code on the web | the repo's `.claude/skills/` |

A skill a repo needs in the cloud belongs in that repo. fleet's global skills, `preview` and `wrap-up` among them, reach the cloud only by import into Amp.

## Handing back

The `wrap-up` skill ends a task with one block a person can read on a phone: repo, branch, PR or commit, preview link and who can open it, checks, changes, open points, thread. The PR stays the place to review; the block goes into the reply and, when the agent writes the PR body anyway, into it.

Threads are private by default. Sharing one is the user's call:

| App | Share |
| --- | --- |
| Delta | `delta thread share --visibility organization <thread>`, `delta thread invite`; in the app also "anyone with the link" |
| Amp | `amp threads share <T-…> --visibility workspace` (also `unlisted`, `group`, `private`) |
| T3 Code | guest links (Labs, read-only, 24 h) |

## Limits

- Read, not tried: Delta Cloud Runners and their previews (docs and the agent instructions bundled with Delta 0.26), Amp portals beyond an existing `.amp/services.yaml`, Tailscale Serve on a port other than 443, previews in Claude Code on the web (not documented).
- Delta Cloud Runners cannot run Claude Agent turns yet; use Delta's own agent there.
- A link that needs the laptop (localhost, Tailscale Serve from the laptop) dies when the laptop sleeps. For review from a phone while the laptop is closed, preview on a runner or in the cloud.

## Next

P1, when a repo should run in Delta Cloud or Amp orbs:

- Add `.agents/setup` and, where the report shows `!!`, `.env.example` to that repo, in the repo, following its own rules.
- Put the skills that repo needs in the cloud into its `.agents/skills/`.
- Show the readiness columns on the dashboard's project pages, if the report gets used (`assessRepo()` in `scripts/repo-readiness.ts` is ready for it).

P2, when a personal runner exists:

- Run `delta runner serve` there as a systemd user service next to T3 Code, and document it in [vps.md](vps.md).
- Tailscale on the server, so previews reach the phone without T3 Code.
