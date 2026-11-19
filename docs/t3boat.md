# fleet on t3boat

[t3boat](https://t3boat.paukraft.com) ([source](https://github.com/paukraft/t3boat)) creates cloud machines on a [Boat](https://boat.dev) account and adds them to T3 Code. A machine sleeps when idle and wakes when a message comes in, so it costs only the minutes agents run. This file says how to run fleet and its repos on such a machine.

Status: not tried yet. Written on 2026-11-19 from t3boat's README, its [architecture notes](https://github.com/paukraft/t3boat/blob/main/apps/desktop/docs/architecture.md), its provisioning script and Boat's site. t3boat is a one-person project, not made by T3 or Boat, with no prebuilt download yet.

## Where it fits

| | Amp orb | t3boat machine | VPS ([vps.md](vps.md)) |
| --- | --- | --- | --- |
| Machine | Amp's, per thread | a full Ubuntu VM on Boat, yours | a server, yours |
| Runs | while the thread runs | while agents work; sleeps after 5 idle minutes | always |
| Disk | gone after the thread | kept: saved at every sleep | kept |
| Cost | Amp usage | per second while awake: 4 vCPU / 8 GB about $0.036/h, plan from $20/month | fixed monthly price |
| Agents | Amp | Claude Code, Codex (signed in on the machine) | Claude Code |
| Reached through | Amp | T3 Code on the laptop, through t3boat | T3 Code with T3 Connect |
| Skills | imported into Amp | fleet's `scripts/setup.sh` on the machine | fleet's `scripts/setup.sh` on the server |
| Long-lived services (a Craft site, a database) | no | only while awake | yes |

Use a t3boat machine for agent work that should go on with the laptop closed, or several tasks at once on separate machines, without paying for a server that idles. Keep the VPS for what must stay up.

## How it works

```
T3 Code ──> t3boat (menu bar app, a localhost proxy per machine) ──> T3 server on a Boat sandbox
                 └─ boat CLI: new, resume, exec, delete              └─ watchdog: sleeps when idle
```

- Each machine runs a T3 server pinned to the desktop app's version. T3 Code talks to the local proxy, so a new sandbox address after a wake does not matter.
- While a machine sleeps, the proxy shows the chats as they were. Sending a message wakes it; the message shows as sent at once.
- The watchdog on the machine decides when to sleep: no agent run, no build, nobody using it for 5 minutes. Work in flight finishes with the laptop closed.
- Before it sleeps, the disk is saved as a Boat snapshot. Files, installed tools and logins stay; running processes and memory do not.
- Boat signs every sandbox in to GitHub as the Boat account (`gh` as git's credential helper). Clones and pushes use that login.
- With linked environments on in T3 Code (**Settings → Labs**), t3boat links every machine to the desktop app's T3 server. Agents on the laptop can then hand work to a machine (`delegate_task`, `t3_thread_launch` with its `environmentId`).

## What this means for fleet

t3boat clones a project to T3's add-project folder on the machine: `~/<repo name>` unless **Add project base directory** is changed in T3 there. That is fleet's flat layout with `root` set to `~`. So fleet on the machine lives at `~/fleet`, setup runs flat with root `~`, and repos t3boat adds and repos fleet clones end up in the same place. Setup sees a repo t3boat already cloned and leaves it alone.

## Set up

### On the laptop, once

1. **Boat.** Make an account on [boat.dev](https://boat.dev) (7-day trial, then from $20/month). t3boat walks through the CLI sign-in; the CLI comes from `curl -fsSL https://boat.dev/install | sh`. Link the GitHub account that can read the private repos: every machine uses it.
2. **t3boat.** Build it from source; it needs [Rust](https://rustup.rs) and [Bun](https://bun.sh):

   ```sh
   git clone https://github.com/paukraft/t3boat && cd t3boat
   bun install
   bun run build:desktop
   ```

   Copy `apps/desktop/src-tauri/target/release/bundle/macos/t3boat.app` to `/Applications` and open it. It lives in the menu bar.
3. **T3 Code.** Turn on linked environments (**Settings → Labs**), so agents in fleet can reach the machines.
4. **Optional:** in t3boat's settings, click **Add** next to Claude Code and Codex. Agents on the laptop then get t3boat's MCP tools (`list_machines`, `create_machine`, `sleep_machine`, `wake_machine`, `resize_machine`, `add_project`, ...) and can start a machine themselves.

### Per machine

1. **Create it.** In the menu bar, create a machine, such as `dev` with the default size, and accept the new backend in T3 Code. Pick fleet as its first project; t3boat clones it to `~/fleet`.
2. **Claude Code.** Sign it in from t3boat. It runs `claude auth login` on the machine and forwards the login's callback, so the credential is made on the machine; the laptop's login is not touched. If `claude` is missing there, install it as in the [VPS steps](vps.md#set-it-up-by-hand), step 2.
3. **Git and fleet.** Open a terminal on the machine (a terminal in a T3 Code thread on it, or `boat ssh`; `boat list` shows the sandbox names), then:

   ```sh
   git config --global user.name "<your name>"
   git config --global user.email "<email>"
   cd ~/fleet
   FLEET_ROOT=~ FLEET_HOST=boat-dev FLEET_FLAT=yes FLEET_DATA=<your data repo remote> FLEET_CLONE=yes scripts/setup.sh
   ```

   This clones the data repo (with the repo list) and every repo to `~/<name>`, adds the worktrees and links the global skills into `~/.claude/skills` and `~/.agents/skills`. Give each machine its own host name (`boat-<machine>`); the dashboard files usage under it. Leave `amp` out of `fleet.local.json`: the laptop already counts Amp. Repos limited to `macos` are skipped.
4. **Projects in T3 Code.** For a repo that needs its `.env`, add it from the machine's details in t3boat: it copies the `.env` files from the laptop's project, like T3's "Add to another machine". For the rest, add the project in T3 Code by its path on the machine, such as `~/my-site`. Then each repo's read-first file covers its setup (dependencies, database), as on any host.

## Working

- **One repo:** pick the machine in T3 Code and start a thread in its project. Push or open a PR from there; nothing syncs back to the laptop by itself.
- **From fleet on the laptop:** an agent hands a task to a machine with `delegate_task` or `t3_thread_launch`, using the machine's `environmentId` and the repo's path there (`~/<name>`). This is the t3boat answer to the line on Amp orbs in `AGENTS.md`.
- **Several at once:** one machine per task or repo. Each sleeps on its own.
- **Phone or browser:** turn on T3 Connect for the machine in t3boat. Only t3boat on the laptop wakes a sleeping machine, so a phone sees it asleep until then.

## Usage stats

The machine's Claude Code transcripts stay on its disk. To count them on the dashboard, run `pnpm collect` in `~/fleet` on the machine (Node 22.18+); it writes `boat-<machine>/` in the data repo and pushes it, and the laptop's dashboard shows it after its next run. A timer on the machine only runs while it is awake.

## Limits

- **Linux only.** Swift and Xcode work stays on the Mac.
- **Asleep means down.** A dev server or a Craft site on the machine is reachable only while it is awake. Boat has Docker inside the VM, so a repo's own container setup can run there for agent work; long-lived sites stay on the VPS.
- **Data leaves the laptop.** t3boat copies `.env` files into the machine, and Boat keeps the disk in snapshots (machines in Germany, Finland and France; snapshot copies can be stored outside the EU). A repo whose data must stay local (its read-first file says so): add it by path, not with its `.env` files, and keep the data off the machine.
- **GitHub login is Boat's.** A repo the Boat account's GitHub login cannot read fails to clone.
- **t3boat must run.** Scheduled T3 automations and the keep-alive wake only happen while t3boat runs on the laptop. A machine asleep for 14 days with t3boat closed loses its Boat disk; the next wake rebuilds it from the snapshot saved at its last sleep.
- **No GPU**, and the sandbox address changes at every wake (t3boat hides that).
