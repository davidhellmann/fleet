# fleet on a VPS

A Linux server, such as a VPS provisioned with Laravel Forge, can host the repos and the agents. The laptop only connects to it through T3 Code; code, agent work and provider logins stay on the server. Claude Code is the agent here.

For cloud machines that sleep when idle instead of a server that runs all the time, see [t3boat.md](t3boat.md); for the same server as a Delta Personal Runner, and for previews from it, see [environments.md](environments.md#personal-runner). Every setting named below: [README, Configuration](../README.md#configuration).

## The short way: let the agent do it

Sign in to GitHub and Claude Code, clone fleet, and start the `setup` wizard in it. As the `forge` user, never as root:

```sh
ssh forge@<server>
sudo apt install gh && gh auth login && gh auth setup-git
curl -fsSL https://claude.ai/install.sh | bash && claude auth login
git clone <your fleet remote> ~/Development/fleet
cd ~/Development/fleet && claude "/setup"
```

If the shell does not find `claude` after the install, open a new one (`exec $SHELL -l`). The wizard checks the server and asks only for what is missing. It sets your Git identity, installs Node with nvm, runs `scripts/setup.sh`, installs T3 Code and the daily collect. Commands that need `sudo`, a login or your approval it hands to you: run them in a second SSH session, or in Claude Code with `!` in front when they ask for nothing. Last, it lists what is left on the laptop (step 6).

## Set it up by hand

The same steps without the wizard. On the server, work as the `forge` user, never as root. Steps 1–3 and 5 need a terminal there (`ssh forge@<server>`).

1. **Git and GitHub.** Set your Git name and email, then give the server access to the private repos with the GitHub CLI (`sudo apt install gh`):

   ```sh
   git config --global user.name "<your name>"
   git config --global user.email "<email>"
   gh auth login
   gh auth setup-git
   ```

   `gh auth setup-git` makes plain `git clone https://github.com/...` use that login, so `fleet.json` stays as it is. With an SSH key instead, add it to GitHub and run once: `git config --global url."git@github.com:".insteadOf "https://github.com/"`.
2. **Claude Code.** Install it and sign in on the server (the login prints a link to open on the laptop):

   ```sh
   curl -fsSL https://claude.ai/install.sh | bash
   claude auth login
   ```

   T3 Code runs it from the server's `PATH`; check with `sh -lc 'command -v claude'`.
3. **fleet and the repos.**

   ```sh
   mkdir -p ~/Development
   git clone <your fleet remote> ~/Development/fleet
   cd ~/Development/fleet
   FLEET_ROOT=~/Development FLEET_HOST=vps FLEET_FLAT=yes FLEET_DATA=<your data repo remote> FLEET_CLONE=yes FLEET_SKILLS=yes scripts/setup.sh
   ```

   This puts every repo directly in `~/Development` (`FLEET_FLAT=yes`); leave it out to keep the folders from `fleet.json`. Repos limited to `macos` are skipped. The data repo is cloned first, to `~/Development/fleet-data`, as it holds the list; the server's usage lands there under `vps/` and reaches the laptop's dashboard on its next run. The third-party skills need Node (`npx`); without it setup warns and skips them, so install Node first (step 5) or rerun setup afterwards ([skills.md](skills.md)).
4. **T3 Code with T3 Connect.** Install the `t3` CLI, then make the server reachable:

   ```sh
   curl -fsSL https://t3.codes/install.sh | sh
   t3 up --connect
   ```

   It prints a link and a code; open the link on the laptop, check the code and approve. `t3 up` installs T3 Code as a background service that starts at boot. If it says lingering is disabled, run `sudo loginctl enable-linger "$(id -un)"` and `t3 up` again. `t3 status` shows the state.
5. **Optional, on the server:** `scripts/schedule-collect.sh install` in `~/Development/fleet`, so the server collects its agents' usage once a day ([README, Keeping the data](../README.md#keeping-the-data)). It needs Node 22.18 or newer (for example through nvm), not `pnpm install`. Also `sudo t3 browser setup` if browser tabs or HTML previews fail to start (Ubuntu 23.10+), and `t3 service protect` so the server stays reachable when agents fill the memory.
6. **On the laptop.** In T3 Code, sign in to the same T3 Connect account and choose the server. In **Settings → Providers**, select the server and enable Claude. Add the projects by their path on the server, such as `~/Development/my-site` (flat).

T3 Connect links up to 3 machines per account. Details: [T3 Code remote access](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md), [background service](https://github.com/pingdotgg/t3code/blob/main/docs/user/background-service.md).

## Working on a project

Work in the project itself, not in fleet. In T3 Code, add each project once by its path on the server, such as `~/Development/my-site`, and start its threads there. The agent then reads the repo's own `AGENTS.md` or `CLAUDE.md`, and the global and third-party skills are there too: setup put them in `~/.claude/skills` and `~/.agents/skills`, which every project sees.

The agent runs on the server, so it sees only the server's files: its skills, `~/.claude/CLAUDE.md`, logins and `.env` files, never the laptop's. The server keeps its own skills: the global ones are links into `~/Development/fleet`, which the daily collector pulls (step 5; fast-forward only), or `git pull` there by hand. Third-party skills follow `skills.json` only through `FLEET_SKILLS=yes scripts/setup.sh` and `pnpm skills:update`, both run on the server ([skills.md](skills.md)).

Open fleet as a project only for work across several repos or on fleet itself (setup, skills, dashboard). The rules in fleet's `AGENTS.md`, such as Conventional Commits, reach the agent only when it starts in fleet; a rule every repo should follow belongs in each repo, in `~/.claude/CLAUDE.md` on the server or in a global skill.

## Keeping the server current

After a change is pushed from the laptop:

| Change | On the server |
| --- | --- |
| a global skill edited | nothing: the daily collector pulls fleet, the links already point there |
| a global skill added or removed | the collector pulls fleet; then run `scripts/setup.sh` (the collector's `fleet:` line says so) |
| a skill added to `skills.json` | the collector pulls fleet; then run `FLEET_SKILLS=yes scripts/setup.sh` |
| a repo added to `fleet.json` | the collector pulls the data repo and rewrites `REPOS.md`; then run `FLEET_CLONE=yes scripts/setup.sh` |
| new commits of third-party skills | `pnpm skills:update`, when you want them |

One line catches up on everything and leaves the rest as it is; the `git pull` only saves waiting for the collector:

```sh
cd ~/Development/fleet && git pull && FLEET_CLONE=yes FLEET_SKILLS=yes scripts/setup.sh
```

## Setting up a project

Setup clones every repo from `fleet.json` (apart from those limited by `os` to another system) and adds its worktrees. That is all: it does not install dependencies, create `.env` files or set up a database. Each repo brings that itself:

- **Once per repo, by hand:** create its `.env` (it is not in Git; copy it from the laptop or write it anew), install dependencies in the main checkout if you work there, and for a Craft site set up the site and database in Forge. The repo's read-first file says what it needs.
- **Per worktree, automatically:** a T3 Code project script set to run when a worktree is created, such as linking the main checkout's `.env` into the worktree and installing dependencies. The repo can share its scripts in a committed `t3.json`, so it reaches the server with the clone. A repo whose worktrees run without any setup needs none. When T3 removes old worktrees is set in **Settings → Worktrees → Cleanup**.
