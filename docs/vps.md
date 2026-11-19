# fleet on a VPS

A Linux server, such as a VPS provisioned with Laravel Forge, can host the repos and the agents. The laptop only connects to it through T3 Code; code, agent work and provider logins stay on the server. Claude Code is the agent here.

For cloud machines that sleep when idle instead of a server that runs all the time, see [t3boat.md](t3boat.md). Every setting named below: [README, Configuration](../README.md#configuration).

## Set it up

On the server, work as the `forge` user, never as root. Steps 1–3 and 5 need a terminal there (`ssh forge@<server>`).

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

The local `setup` skill walks through steps 3 and 5 as well: start Claude Code in `~/Development/fleet` on the server and run `/setup`.

## Projects on the VPS

Each repo brings its own setup, not fleet:

- **Long-lived setup**, such as a Craft site in Forge with its database and `.env`: describe it in the repo's read-first file.
- **Per worktree**, such as installing dependencies or copying `.env`: a T3 Code project script set to run when a worktree is created. The repo can share its scripts in `t3.json`. When T3 removes old worktrees is set in **Settings → Worktrees → Cleanup**.
