# Dashboard concept

A local dashboard in fleet that shows, in one place, what is open across all repos and what the agent work costs. It replaces checking a dozen repos and several agent apps one by one, and keeps long-term usage stats that the apps themselves throw away.

Status: stage 1 done. Built: groundwork (`fleet.json`, `fleet.local.json`), app shell, collector with readers for Claude Code, Codex, Pi and gh (git is read live), cost per PR and an estimated cost per commit, and the pages Overview, Projects with project pages, Usage, and Hosts with host pages. Stages 2 and 3 done: plan limits, site checks, issues and Dependabot alerts; Amp usage through the `amp` CLI.

## Principles

- **Local only.** Runs on the host, no hosting, no server. Reads local logs, `git` and the signed-in `gh` CLI.
- **Proven over custom.** A common stack and ready-made components rather than hand-built ones; it is easier to maintain, for people and for agents. Every dependency is named in this file with its reason.
- **Component-driven.** Astro components for pages and static parts, React only where the page reacts to input.
- **Aggregates are kept, raw data is not.** Usage rollups live in the private data repo, never in fleet; prompts, transcripts and logs never leave the host.
- **Credentials are never read by fleet code.** GitHub goes through `gh`; a future API token comes from the environment, set by the user.

## Stack


| Dependency | Role | Why |
| --- | --- | --- |
| Astro | pages, routing, layouts; reads the data on the server | file-based routing and server-side data reading without an API layer |
| React (Astro islands) | interactive parts: period switch, filters, charts | widespread; what shadcn and the chart library target |
| shadcn/ui (with Tailwind) | sidebar, toggle group, cards, tables, tooltips | ready-made, owned in the repo; Tailwind comes with it and is the only styling system |
| TanStack Charts | line, bar, stacked and composed charts | typed against the data rows, composable marks (bars under a line without a new chart type), SVG, framework-agnostic; 1.0 since Oct 2026 |
| TypeScript (dev) | `astro check` / `tsc` | type checks |

- **Charts, the alternative:** Recharts through shadcn's chart component. More mature and better known to agents, but chart types are fixed and the types are looser. Fall back to it only if TanStack Charts hits a wall.
- The collector runs on Node 22.18+ directly as TypeScript (type stripping; checked with 22.22.3), so it needs no build step.
- Check `modern-web-guidance` before writing HTML and CSS.

## Design

The look:

- sidebar navigation, breadcrumb, a period switch in the header (today, 7 d, 30 d, 1 y, all);
- a data-sheet look: small uppercase mono labels, tabular numbers, one brand accent;
- Geist and Geist Mono; light, dark and auto theme.
- An activity calendar like GitHub's contribution graph: overall by default, switchable to one project or one host. A small own component (a grid of days), not a chart.

## Modules

| Module | Shows | Source | Stage |
| --- | --- | --- | --- |
| Repos | branch, uncommitted changes, ahead/behind, worktrees, last commit | `git` | 1 |
| Pull requests | open PRs, review state, CI status | `gh` | 1 |
| Usage | tokens and cost per repo, app, model and host, for every period | session logs (below) | 1 |
| Activity | GitHub-style calendar of agent sessions per day; overall, per project or per host | session logs | 1 |
| Cost per PR | cost of the sessions on a PR's branch | session logs + `gh` | 2 |
| Plan limits | Claude 5 h and weekly, Codex windows, with reset times | see Limits | 2 |
| Sites | each repo's `site` reachable, with its certificate | HTTP check | 2 |
| Issues | filtered only (assigned, labelled), not a GitHub copy | `gh` | 2 |
| Security | Dependabot alerts per repo | `gh api` | 2 |
| Amp | cost per thread and day | Amp external API | 3 |

## Usage data sources

| App | Where | What it holds | Notes |
| --- | --- | --- | --- |
| Claude Code (also Desktop, T3 Code via Claude) | `~/.claude/projects/<encoded-cwd>/<session>.jsonl` | per assistant message: `message.model`, `message.usage` (input, output, cache read, cache creation), `cwd`, `gitBranch`, `timestamp` | Tokens only, no cost (see Pricing). Lines repeat per `message.id` + `requestId`; dedupe. Claude Code deletes transcripts after `cleanupPeriodDays` (default 30). |
| Codex (CLI, app, T3 Code via Codex, Zed) | `~/.codex/sessions/YYYY/MM/DD/*.jsonl.zst` (zstd; `CODEX_HOME` moves it) | `session_meta` (cwd, `originator`), `turn_context` (model, cwd), `token_usage_record` per response in newer sessions, else `token_count` with the session's running total and often `rate_limits` | Per file the records when there are any (dedupe by `response_id`), else the growth of the running total (repeats skipped). Cached input is inside `input_tokens` and moved to cache read. No Git branch. Node 22 reads zstd itself. |
| Pi | `~/.pi/agent/sessions/--<cwd>--/*.jsonl` | session header with cwd; per assistant message usage and Pi's own list-price cost | Cost taken as is; it matches LiteLLM for the main models. Dedupe by the provider's response id (forks repeat entries). No Git branch. |
| Amp | ampcode.com, read with the signed-in `amp` CLI | `amp usage --details --start <iso> --end <iso>`: a Markdown report with the tier balance (agent dollars, orb hours, period end), a Models table (uncached input, cache read, cache write, output, recorded cost), Usage by Thread (tokens, orb hours, recorded cost) and daily recorded cost | No token in fleet: the CLI uses its own sign-in, like gh. `--start` and `--end` go together; a range over about 90 days returns nothing. 60 account and thread lookups an hour. Thread usage kept 90 days. |
| Delta | Zed account | no known export | Out of scope until Delta offers one. |

T3 Code drives Claude Code and Codex, so its sessions should land in their logs; verify on real data.

## Pricing

Claude Code and Codex log tokens, not money. The collector turns tokens into cost with per-model prices (input, output, cache read, cache write per million tokens):

- Source: the public LiteLLM price list (`model_prices_and_context_window.json`), which ccusage uses too. The collector fetches it on each run and caches it in `.cache/`; offline it uses the cache.
- `pricing.overrides.json` in the repo fills in models the list lacks or prices wrongly, with LiteLLM's keys per token (`input_cost_per_token`, `output_cost_per_token`, `cache_read_input_token_cost`, `cache_creation_input_token_cost`, `cache_creation_input_token_cost_above_1hr`). Normally `{}`. The collector names models without a price; their rows get `cost: null`.
- Claude Code splits cache writes into 5-minute and 1-hour ones, priced differently (`cache_creation_input_token_cost` and `…_above_1hr`); the collector prices them apart and stores their sum as cache write.
- Cost is computed when a day is rolled up and stored in the rollup, so past costs do not shift when prices change later.
- On a subscription (Claude Max, ChatGPT) this is the API list price, not money paid; the dashboard says so. Pi logs its own cost and is taken as is.

## Limits

- **Claude**: no local log. Claude Code passes `rate_limits.five_hour` and `rate_limits.seven_day` (`used_percentage`, `resets_at`) to the status line command, for Pro and Max only, after the first reply. `scripts/claude-statusline.ts` goes in front of the status line command in use (for example ccusage), passes it the same input and prints its output; it appends `{ at, rate_limits }` to `.cache/claude-limits.jsonl` only when the values change (last value in `.cache/claude-limits.last`). The pages read the last line live. Field spellings are read loosely (`used_percentage` or `used_percent`, seconds, milliseconds or ISO times), as the input is not versioned.
- **Codex**: latest `rate_limits` of the `token_count` events (`primary`: 5 h, `secondary`: week; `used_percent`, `window_minutes`, `resets_at`, `plan_type`); the collector keeps it in `.cache/snapshot.json`.
- Overview shows both. A window whose reset time has passed since the reading shows as reset (with the old value), not as current.

## Persisted stats

Keeping them in Git keeps the history: Claude Code deletes transcripts after 30 days, and each host has its own logs.

- Layout: `<host>/<YYYY-MM>.json` in the data repo (fleet.local.json `data`, a private repo cloned next to the repos, which also holds `fleet.json`), one file per host and month, so two hosts never edit the same file. The dashboard can filter and compare by host. fleet itself holds no usage data and can be public. Without `data`, `stats/` in fleet (ignored by Git) is the fallback.
- Sync (`dashboard/collect/sync.ts`): every collector run pulls the data repo with `--rebase --autostash`, writes, then commits only `<host>/` and pushes; a refused push gets one pull and one retry. Each host writes only its own folder, so rebases never conflict. Failures are reported in the `data:` line, never fatal; the next run pushes what waits. Git over a database: the files are small, history and offline come for free, and `gh` is already signed in on every host.
- Row: day, host, app, client, repo, branch, model, sessions, input, output, cache read, cache write tokens, cost (USD to four decimals, `null` without a price). `client` is the program behind the session: for Claude Code its `entrypoint` (`claude-desktop`, `t3-code`, `cli`, `sdk-ts` for Delta, …).
- File format: a header (`host`, `month`) and one row per line, sorted, so Git diffs stay readable.
- The collector recomputes only days still covered by local logs and leaves older rows as they are, so history survives log cleanup. Covered means newer than the app's retention minus one day of margin (Claude Code: `cleanupPeriodDays` in its settings, default 30): transcripts are deleted whole, so every later day still has all its sessions. Older days without a stored row are filled once (first run, new host).
- Claude Code logs one reply several times (per content block, and again in a resumed session's file); output tokens grow between copies while the reply streams. The reader deduplicates across all files by `message.id` + `requestId` and keeps the highest value of each count.
- Repo is derived from the session's `cwd` against the repo list: by Git remote first, then by path, then by a repo name in the folders below a `worktrees` folder (`~/.t3/worktrees/<repo>/…`, `~/.herdr/worktrees/<repo>/…`), for worktrees deleted since; anything else becomes `other`. Stored days outside a recompute window keep the mapping they were written with.
- Recompute windows per app: Claude Code from today minus its retention (plus one day of margin); Codex and Pi keep their logs, so from the day after their first logged day.
- The host name comes from `host` in `fleet.local.json`; setup suggests the short host name.

## Repo list

Two JSON files, the pattern of `settings.json` and `settings.local.json`:

- `fleet.json` (in the private data repo, so fleet holds nothing personal; `REPOS.md` in fleet, ignored by Git, is generated from it for agents) is the single source for the repos (name, description, remote, dir, read-first file, note, site, worktrees, os); the repo name is its folder name.
- `fleet.local.json` (ignored, one per host) holds `root`, `host`, `flat` and `data` (the data repo's remote), plus the optional `amp` and `collectMinutes`. A flat host ignores `dir` and keeps every repo at `<root>/<name>`, so the VPS need not copy the laptop's folders.

JSON because Node reads it without a parser dependency. `scripts/config.ts` holds both types, loads both files with checks and renders the list; `node scripts/write-repo-list.ts` writes `REPOS.md` (`--check` for drift); setup and every collector run do it too. `fleetPaths()` there is the one place that knows where the list, the usage data and `REPOS.md` live. The collector imports `loadRepos()`, `loadHostConfig()` and `repoDir()` from there to map a session's `cwd` to a repo. As the layout differs between hosts, it matches by Git remote first and by path second. `scripts/setup.sh` reads both files with Python, so a fresh host needs no Node to clone.

## Cost per PR and per commit

Checked against real logs:

- **Per PR: feasible.** Every stats row has the branch. A PR has a head branch and a time span, so its cost is the cost of the rows on that branch in that repo from the branch's first day to the merge or close. Reused branch names are told apart by those spans. Roughly half the cost runs on feature branches; work on `main`/`master` has no PR, and a small share runs on a detached `HEAD` (agent worktrees before their branch exists).
- **Per commit: only as an estimate, built.** The logs name no commits. Commit output (`[branch abc1234] …`) shows up in only a few sessions, because people commit themselves or agents run `git commit -q`. So the collector assigns each reply on a branch to the first commit that landed on that branch after it (`git log --first-parent`, committer time; `origin/<branch>` when the local branch is gone) while the logs still exist, and stores one row per commit in `<data>/<host>/commits-<YYYY-MM>.json` (hash, subject cut to 100 characters, day, branch, first and last reply, replies, sessions, tokens, cost). Exploration that led nowhere lands on the next commit.
  - Merge rule: a stored commit is recomputed only while all its replies are still in the logs. On every recomputed branch, stored commits inside that window that the branch no longer has (rebase, amend) are dropped, so work is not counted under old and new hashes.
  - Not on any commit, kept in `.cache/snapshot.json` as of the last run: work after the last commit on a branch, and cost on branches git no longer has (deleted after a merge, agent worktrees).
  - Detached `HEAD` and `other` are skipped.
- Cost per branch is shown on each project page already.

## Architecture

```
package.json      one package for fleet: scripts, Astro, tests (pnpm)
vitest.config.ts  tests in dashboard/src and scripts
dashboard/
  collect/        Node: index.ts (entry), claude.ts (reader), repo-map.ts (cwd → repo), pricing.ts, rollup.ts, stats.ts;
                  readers for codex, pi, git and gh follow; writes the data repo and .cache/snapshot.json; sync.ts pulls and pushes it
  src/
    pages/        index (overview), projects/, usage, hosts/; detail pages projects/[name], hosts/[host] follow
    layouts/      Base.astro: head, theme script, the AppShell island around the page
    components/app/  shell, sidebar, period switch, theme menu, card label, empty state
    components/ui/   shadcn components
    lib/          period maths, formatting, theme, fleet.ts (fleet.json and fleet.local.json for the pages)
  astro.config.ts
```

- `pnpm dashboard` runs the collector, then starts Astro on localhost (`astro dev`, `output: 'server'`). A failing collector does not stop the dashboard. `pnpm collect -- --dry-run` reports without writing.
- While the server runs, an Astro integration (`dashboard/background-collect.ts`) starts the collector every `collectMinutes` (fleet.local.json, default 15, 0 = off). The sidebar's refresh button posts to `/api/collect`, which starts a run in the background and returns to the page; GET `/api/collect` gives the state the sidebar polls (every 5 s in its first minute, then every 30 s) to show "collecting" and a reload link once newer data exists. Pages never reload by themselves. Every run takes `.cache/collect.lock`; a second collector stops at once, a lock whose process is gone is taken over. The last run's report is `.cache/last-collect.json`.
- Daily, independent of the dashboard: `scripts/schedule-collect.sh install` sets up a LaunchAgent (macOS) or a persistent systemd user timer (Linux) that runs the collector once a day, so Claude Code's transcripts never expire unread. It touches the host's system configuration, so each host runs it once by hand; fleet's setup does not. A T3 Code project script would not do: it runs on a button or on worktree creation, not on its own; a T3 scheduled task would start an agent for a command that needs none. Pages render on request, so a reload shows fresh data; a refresh button reruns the collector first.
- The period is part of the URL (`?period=7d`), so pages render it on the server and links keep it.
- Pages read the data repo and `.cache/snapshot.json` directly; `.cache/` and `dist/` are ignored by Git.
- Exact costs are not the goal: the numbers are for comparing tasks, repos and periods.

## Stages

1. Done: `fleet.json` with a generated repo list for agents (now `REPOS.md`); `fleet.local.json` with `root`, `host` and `flat` in setup.
   Done: app shell (Astro, React, shadcn, Tailwind), theme, period switch and maths, pages Overview, Projects, Usage, Hosts without usage data.
   Done: collector with the Claude Code reader, pricing and rollups (`pnpm collect`; `pnpm dashboard` runs it first).
   Done: pages on the stats: key figures with change against the previous period, activity calendar, breakdowns by app, client, model, repo and host, cost per project.
   Done: cost over time as stacked bars (TanStack Charts): by model on Overview, by repo on Usage.
   Done: git reader (branch, sync, changes, last commit, worktrees) on Projects; project pages `/projects/<name>` with repo facts, git state, usage, cost per branch, client and model, and the project's activity calendar. fleet itself is a project.
   Done: gh reader in the collector (pull requests with review and checks, `.cache/snapshot.json`); pull requests in the projects table and on project pages, with cost per PR (brought forward from stage 2).
   Done: Codex and Pi readers; usage per app on every page. Host pages `/hosts/<host>` (settings of this host, usage by app, repo, client and model, activity). `formerNames` in fleet.json maps renamed repos.
   Done: cost per commit as an estimate (collector, `<data>/<host>/commits-<YYYY-MM>.json`), shown on project pages with the work after the last commit and on branches git no longer has.
2. Stage 1: readers for git, gh, Claude Code, Codex, Pi; pricing; rollups in the data repo; pages Overview (usage by period, activity), Projects (status, PRs, usage per repo) and Usage (by app, model, host).
3. Stage 2: cost per PR, plan limits, sites, issues, security.
4. Stage 3: Amp. Done, through the `amp` CLI instead of the API (no token needed).

## Decisions

- Issues and security come from gh in the collector next to the pull requests: open issues per repo (`gh issue list`), open Dependabot alerts per repo (`gh api --paginate --slurp repos/<slug>/dependabot/alerts`, every page; withdrawn advisories left out), and the signed-in user (`gh api user`). Overview shows only the issues assigned to that user (filtered, not a GitHub copy) and the alerts per repo, most severe first; project pages list the repo's issues and alerts. A repo whose alerts or issues are off, or not readable, says so instead of showing none; reading alerts may need `gh auth refresh -s security_events`.
- Site checks run in the collector: a GET with redirects (some hosts refuse HEAD), status and time to headers, where the redirects ended, and the TLS certificate's expiry (read with a direct TLS connection). Up means 2xx or 3xx at the end. Results in `.cache/snapshot.json`; Overview lists all sites, project pages show their site's state. `--offline` skips them and GitHub.
- Branch names, commit subjects and Amp thread titles are stored in the data repo (private; needed for cost per PR and commit), never in fleet.
- Amp: one `amp usage` call per local day (local midnight to midnight; today up to now): today and yesterday on every read, then up to ten missing older days, oldest first, within 88 days, as Amp drops thread usage after 90. At most one read every 15 minutes (60 lookups an hour). Days that came back empty are noted in the snapshot and not read again. Only days read in a run change; a failed read keeps what was stored.
  - Recorded cost is what Amp billed; usage over a linked Claude or ChatGPT subscription records $0. The stats store each model at its list price from its tokens, like every other app; models without tokens or price (image, voice, transcription) keep their recorded cost. The thread table shows what Amp billed.
  - Rows: one per day and model, app and client `amp`, repo `other` (Amp names no working directory), no branch. The day's thread count sits on its model row with the most tokens, so sessions add up per day. Threads per day go to `<data>/<host>/amp-threads-<YYYY-MM>.json` (id, title cut to 120 characters, tokens, orb hours, recorded cost); the Usage page lists them.
  - Usage is per account: only the host with `"amp": true` in `fleet.local.json` reads it.
  - The tier balance (agent dollars and orb hours used, period end) shows under Plan limits.
- Prices come from the LiteLLM list with a local cache and an override file, not a hand-kept table.
- Host, not machine, is the term for a computer running fleet.
- The shortest period is today (local calendar day), not a rolling 24 h: every period is whole days, so the daily rollups suffice.
- Astro + React + shadcn/ui (Tailwind) + TanStack Charts.
- Astro stays on 7.3 and `@astrojs/react` on 7.1.0: Astro 7.4 and `@astrojs/react` 7.1.9 need Node 22.23.4, the hosts run 22.22. Lift the pins together with Node.
- Colours: cool greys in light, navy in dark, pink as the one accent (`--brand`), the categories and the calendar scale alike (`src/styles/app.css`). (Indigo and a Dracula palette were tried and dropped.)
- Theme: system by default, light or dark as an override. The choice sits in `<meta name="color-scheme">`, every token is a `light-dark()` pair, and without JavaScript the page follows the system. No `.dark` class.
- Browsers: current evergreen browsers only, as it is a local tool. Baseline features that are only newly available (`light-dark()`, `:has()`) are used without fallbacks.
- The period switch is plain links (`?period=`), no script; the current one carries `aria-current`.
- Activity calendar: the last 53 weeks, Monday on top, shaded by the day's cost in four steps by rank among active days (⌈4 · rank / n⌉), so one expensive day does not flatten the rest. Server-rendered, no script; each day names cost, tokens and sessions. Sessions there are summed over the day's rows, so a session spanning two models or repos counts twice.
- Changes against the previous period are neutral ink, not green or red: more usage is neither good nor bad.
- Pull requests come from `gh pr list` per GitHub repo, two calls each (the latest 60 in any state; the open ones with review and checks), four repos at a time, in the collector; `--no-gh` skips it. A failing repo keeps its error in the snapshot and the pages show it. Cost per PR is computed by the page from the stats: the PR's head branch from the day after the previous PR on the same branch name ended to its merge or close (today while open), work before the PR was opened included.
- git state is read live on every request (in parallel, about 50 ms for a few repos), not by the collector: a reload shows the current state. Ahead and behind are as of the last fetch; nothing fetches. gh needs the network and goes into the collector's snapshot.
- Cost chart: `@tanstack/charts` with its React adapter (`@tanstack/charts/react`); `@tanstack/react-charts` is only its compatibility package. Server-rendered SVG, hydrated with `client:visible` for focus and tooltips. Buckets follow the period: days up to 31 days, weeks up to a year, months beyond; every bucket keeps its slot. The five most expensive series stand alone, the rest is `Other` in grey. Colours are the `--category-*` tokens passed as `var()` paint, so light and dark need no extra code; the tooltip takes the popover tokens through `--ts-chart-tooltip-*` (`app.css`).
