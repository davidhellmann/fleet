---
name: preview
description: Start a repo's dev server and hand over a link to open it, also from another device - through the environment's own preview (Delta Cloud Runner, Amp orb portal, T3 Code, Claude Code) or, on a laptop or server, a tailnet-only Tailscale link. Use when asked for a preview, a preview link, or to show the running app on a phone or another computer, and to stop one.
---

# Preview

Get the user a working link to the running app with the least exposure that reaches the device they named. Every environment below has its own preview; use it rather than building a tunnel. Background, sources and limits: fleet's `docs/environments.md`.

## 1. Find the command

The repo says how it runs: its read-first file, then `.claude/launch.json`, `.amp/services.yaml`, `t3.json`, and the `dev` script in `package.json`. Use that command. Install dependencies first when they are missing, with the manager of the lockfile (`npm ci`, `pnpm install --frozen-lockfile`). Pass bind address and port as flags for this run (`--host`, `--port`, or `PORT`); config files stay as they are.

Done when you have one command and the port it serves on.

## 2. Pick the target

Take the first row that matches where you run.

| Where | Detect | Bind | Link | Who can open it |
| --- | --- | --- | --- | --- |
| Delta Cloud Runner | `delta-runner` on `PATH` | `0.0.0.0`, any port but 49983 | `delta-runner preview url <port>`: use its output | people signed in to Delta with access to the thread; the link alone, when the thread is shared with "anyone with the link" |
| Amp orb | `AMP_ORB=1` | `$PORT` for a service in `.amp/services.yaml` | a portal: `amp orb services ensure` for the declared ones, `amp orb portal <port> --title "<name>"` otherwise; use the URL Amp prints | people who can view the thread |
| T3 Code (your instructions say so) | | `localhost` | `http://localhost:<port>`: the user opens it in T3 Code's browser, on the laptop or with **Open on this device** on a phone, also when T3 runs on a server | the user, through their T3 Code |
| Claude Code desktop | preview tools available | from `.claude/launch.json` | its preview pane | the user, on this computer |
| A host of your own, the user on the same computer | | `localhost` | `http://localhost:<port>` | this computer |
| A host of your own, the user on another device | `tailscale status` works | `localhost` | Tailscale Serve, below | devices in the user's tailnet |

**Tailscale Serve.** Run `tailscale serve status` first: the T3 server may already be served there (`t3 pair --tailscale`). Serve on a free HTTPS port, 443 when nothing uses it, else `--https=8443`:

```sh
tailscale serve --bg --https=8443 <port>    # link: https://<machine>.<tailnet>.ts.net:8443
```

Vite and Astro refuse unknown host names. Allow the tailnet name for this run: Vite `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<machine>.<tailnet>.ts.net`, Astro `--allowed-hosts <machine>.<tailnet>.ts.net`.

**Public links stay a request of the user.** Every row above is private by default. A link anyone can open (Tailscale Funnel, `cloudflared tunnel --url`, a public Amp portal, a Delta thread shared with "anyone with the link") is made only when the user asks for a public link in this conversation, after you have named who could then open it. A repo whose read-first file or `note` says its data stays local gets no public link at all; say why.

## 3. Start and check

Start the server in the background and keep its process id or terminal handle. Take the port from the server's own output: Vite and Astro move to the next free port when one is taken, and the server of another checkout or thread may still hold the usual one. Check it answers on the host: `curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:<port>/` returns 200, or the redirect the app makes. An error or a timeout is reported as it is, with the server's last log lines.

Done when the server answers and you hold the link.

## 4. Hand it over

One line each: the link, who can open it, how long it lives (a Delta terminal closes after an hour, an orb sleeps when idle, a local server runs until stopped), and how to stop it.

## Stop

Stop the process you started. Undo what you added to Tailscale with the same flags and `off` (`tailscale serve --bg --https=8443 off`); `tailscale serve reset` would also drop what others set up. Then `tailscale serve status` shows only what was there before.
