#!/usr/bin/env bash
# Report how far fleet is set up on this host. Reads only; changes nothing. Safe to run any time.
#
# One line per check:
#   ok  works
#   --  optional, or a choice not made yet
#   !!  broken or missing; setup is not done
# Exits 1 when any line is !!, else 0.
set -uo pipefail

FLEET_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
cd "$FLEET_DIR" || exit 2

case "$(uname -s)" in
  Darwin) this_os=macos ;;
  Linux) this_os=linux ;;
  *) this_os=other ;;
esac

ok() { printf 'ok  %-22s %s\n' "$1" "${2:-}"; }
opt() { printf -- '--  %-22s %s\n' "$1" "${2:-}"; }
bad() { printf '!!  %-22s %s\n' "$1" "${2:-}"; }
have() { command -v "$1" >/dev/null 2>&1; }
section() { printf '\n%s\n' "$1"; }

node_ok=no

checks() {
  printf 'fleet at %s on %s\n' "$FLEET_DIR" "$this_os"

  # --- Tools: git and python3 are what scripts/setup.sh needs; the rest is for the dashboard and agents.
  section "Tools"
  if have git; then ok git "$(git --version | awk '{print $3}')"; else bad git "missing; install Git"; fi
  if [ -n "$(git config --global user.name 2>/dev/null)" ] && [ -n "$(git config --global user.email 2>/dev/null)" ]; then
    ok "git identity" "$(git config --global user.name)"
  else
    bad "git identity" "set git config --global user.name and user.email"
  fi
  if have python3; then ok python3 "$(python3 -V 2>&1 | awk '{print $2}')"; else bad python3 "missing; scripts/setup.sh needs it"; fi
  if have node; then
    if node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
      ok node "$(node -v)"; node_ok=yes
    else
      bad node "$(node -v) is too old; needs 22.18 or newer"
    fi
  else
    opt node "missing; needs 22.18+ for the dashboard, the daily collect, write-repo-list and third-party skills"
  fi
  if have pnpm; then ok pnpm "$(pnpm -v 2>/dev/null)"; else opt pnpm "missing; needed for the dashboard (corepack enable pnpm)"; fi
  if have gh; then
    if gh_status="$(gh auth status 2>&1)"; then
      ok gh "signed in"
    elif printf '%s' "$gh_status" | grep -q keyring; then
      opt gh "token in the keyring unreadable; signed out, or an agent sandbox blocks the keychain"
    else
      opt gh "not signed in; gh auth login, then gh auth setup-git"
    fi
  else
    opt gh "missing; needed for private clones and the dashboard's pull requests"
  fi
  for tool in claude codex amp; do
    if have "$tool"; then ok "$tool" "installed"; else opt "$tool" "not installed"; fi
  done

  # --- Linux server: the parts docs/vps.md sets up beyond fleet (user, T3 Code, lingering).
  if [ "$this_os" = linux ]; then
    section "Server (docs/vps.md)"
    if [ "$(id -u)" = 0 ]; then bad user "running as root; work as your normal user (forge on a Forge server)"; else ok user "$(id -un)"; fi
    if have t3; then ok t3 "installed; t3 status shows the service and T3 Connect"; else opt t3 "not installed; curl -fsSL https://t3.codes/install.sh | sh, then t3 up --connect"; fi
    if have loginctl; then
      if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" = yes ]; then
        ok lingering "on; T3 Code and the daily collect run without a login"
      else
        opt lingering "off; T3 Code and the daily collect run only while logged in: sudo loginctl enable-linger $(id -un)"
      fi
    fi
  fi

  # --- Settings, repos, access config: read from JSON, so in Python like scripts/setup.sh.
  if have python3; then
    python3 - "$FLEET_DIR" "$this_os" "$(have amp && echo yes || echo no)" "$(have codex && echo yes || echo no)" <<'PY'
import glob, json, os, re, sys

fleet, this_os, has_amp, has_codex = sys.argv[1:]
home = os.path.expanduser("~")

def line(mark, item, detail=""):
    print(f"{mark:<3} {item:<22} {detail}".rstrip())

def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except Exception as e:
        return e

print("\nHost settings (fleet.local.json)")
cfg = load(os.path.join(fleet, "fleet.local.json"))
root = host = None
flat = False
data_remote = (cfg or {}).get("data") if isinstance(cfg, dict) else None
data_name = re.split(r"[/:]", data_remote.rstrip("/"))[-1].removesuffix(".git") if isinstance(data_remote, str) and data_remote.strip() else None

def data_repo_dir(root):
    """The private data repo, as fleetPaths() in scripts/config.ts: <root>/<name from its remote>."""
    return os.path.join(root or os.path.dirname(fleet), data_name) if data_name else None

def data_dir(root):
    """Where the usage data lives: the data repo, else stats/ in fleet."""
    return data_repo_dir(root) or os.path.join(fleet, "stats")

def list_file(root):
    """Where fleet.json lives: the data repo, else fleet."""
    return os.path.join(data_repo_dir(root) or fleet, "fleet.json")
if cfg is None:
    line("!!", "fleet.local.json", "missing; root, host and flat are not set yet")
elif isinstance(cfg, Exception) or not isinstance(cfg, dict):
    line("!!", "fleet.local.json", f"not valid JSON: {cfg}")
    cfg = None
else:
    r = cfg.get("root")
    if isinstance(r, str) and r.startswith("/") and os.path.isdir(r):
        root = r
        line("ok", "root", r)
    else:
        line("!!", "root", f"{r!r} must be an absolute path to an existing folder")

    h = cfg.get("host")
    if isinstance(h, str) and re.fullmatch(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?", h):
        host = h
        stats = os.path.join(data_dir(root), h)
        shown = os.path.relpath(stats, os.path.dirname(fleet))
        line("ok", "host", h + (f"  ({shown}/ exists: keep this name)" if os.path.isdir(stats) else "  (no usage data yet)"))
    else:
        line("!!", "host", f"{h!r}: lowercase letters, digits and inner dashes only")

    f = cfg.get("flat", False)
    if isinstance(f, bool):
        flat = f
        line("ok", "flat", "yes: every repo directly in root" if f else "no: repos in their dir")
    else:
        line("!!", "flat", f"{f!r} must be true or false")

    if "data" not in cfg:
        line("--", "data", "not set; the private repo for the repo list and usage data (FLEET_DATA)")
    elif cfg["data"] is None:
        line("ok", "data", "none: fleet.json and the usage data stay in fleet")
    elif data_name:
        line("ok", "data", f"{data_remote} -> {data_name}/")
    else:
        line("!!", "data", f"{cfg['data']!r} must be the Git remote of the data repo, or null")

    m = cfg.get("collectMinutes", 15)
    if isinstance(m, int) and not isinstance(m, bool) and m >= 0:
        line("ok", "collectMinutes", "off" if m == 0 else f"{m}" + ("" if "collectMinutes" in cfg else " (default)"))
    else:
        line("!!", "collectMinutes", f"{m!r} must be a whole number of minutes, 0 for off")

    # Amp usage belongs to the account: exactly one host should read it.
    amp = cfg.get("amp", False)
    others = sorted({os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(data_dir(root), "*", "amp-threads-*.json"))} - {host})
    if not isinstance(amp, bool):
        line("!!", "amp", f"{amp!r} must be true or false")
    elif amp and others:
        line("!!", "amp", f"true here and also read on {', '.join(others)}: counted twice; keep it on one host")
    elif amp and has_amp != "yes":
        line("!!", "amp", "true, but the amp CLI is not installed")
    elif amp:
        line("ok", "amp", "this host reads the Amp account's usage")
    elif others:
        line("ok", "amp", f"off; read on {', '.join(others)}")
    else:
        line("--", "amp", "no host reads Amp usage yet" + ("; this one could" if has_amp == "yes" else ""))

print("\nRepos (fleet.json)")
fleet_json = load(list_file(root)) if root else None
if root is None:
    line("--", "repos", "not checked; root is not set")
elif data_name and not os.path.isdir(data_repo_dir(root)):
    line("!!", "data repo", f"{data_name} missing at {data_repo_dir(root)}; scripts/setup.sh clones it")
elif fleet_json is None:
    line("!!", "fleet.json", f"missing at {list_file(root)}; start one from fleet.example.json")
elif not isinstance(fleet_json, dict):
    line("!!", "fleet.json", f"cannot read: {fleet_json}")
else:
    if data_name:
        line("ok", "data repo", f"{data_name} at {data_repo_dir(root)}")
    missing, skipped, total = [], [], 0
    for repo in fleet_json.get("repos", []):
        name = repo.get("name", "?")
        systems = repo.get("os") or []
        if systems and this_os not in systems:
            skipped.append(name)
            continue
        total += 1
        parent = root if flat else os.path.join(root, repo.get("dir", "").strip("/"))
        path = os.path.normpath(os.path.join(parent, name))
        if not os.path.exists(path):
            missing.append(name)
        for branch in repo.get("worktrees") or []:
            if not os.path.exists(f"{path}-{branch}"):
                missing.append(f"{name}-{branch} (worktree)")
    if missing:
        line("--", "repos", f"missing: {', '.join(missing)}")
    else:
        line("ok", "repos", f"all {total} present")
    if skipped:
        line("ok", "other systems", f"left out here: {', '.join(skipped)}")

print("\nAgent access (written by scripts/setup.sh)")
claude_local = load(os.path.join(fleet, ".claude", "settings.local.json"))
dirs = ((claude_local or {}).get("permissions") or {}).get("additionalDirectories") if isinstance(claude_local, dict) else None
if root and dirs and root in dirs:
    line("ok", "Claude Code", f"may work in {root}")
else:
    line("!!", "Claude Code", ".claude/settings.local.json lacks root; rerun scripts/setup.sh")
codex_local = os.path.join(fleet, ".codex", "config.toml")
if root and os.path.exists(codex_local) and root in open(codex_local).read():
    line("ok", "Codex sandbox", f"may write in {root}")
else:
    line("!!" if has_codex == "yes" else "--", "Codex sandbox", ".codex/config.toml lacks root; rerun scripts/setup.sh")
if has_codex == "yes":
    user_codex = os.path.join(os.environ.get("CODEX_HOME") or os.path.join(home, ".codex"), "config.toml")
    text = open(user_codex).read() if os.path.exists(user_codex) else ""
    trusted = re.search(r"\[projects\.[\"']" + re.escape(fleet) + r"[\"']\]\s*\n\s*trust_level\s*=\s*\"trusted\"", text)
    if trusted:
        line("ok", "Codex trust", "fleet is a trusted project")
    else:
        line("!!", "Codex trust", "fleet is not trusted, so Codex ignores .codex/config.toml; trust it in Codex")

print("\nClaude Code status line (plan limits)")
claude_settings = load(os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(home, ".claude"), "settings.json"))
command = ((claude_settings or {}).get("statusLine") or {}).get("command", "") if isinstance(claude_settings, dict) else ""
if "claude-statusline.ts" in command:
    line("ok", "status line", "records plan limits")
else:
    line("--", "status line", "plan limits not recorded; README, Plan limits")
PY
  else
    section "Host settings, repos, agent access"
    bad "not checked" "python3 is missing"
  fi

  # --- Skills: every global skill linked where the agents look.
  section "Global skills (skills/)"
  missing_agents="" missing_claude="" count=0
  for skill in skills/*/; do
    [ -f "$skill/SKILL.md" ] || continue
    name="$(basename "$skill")"
    count=$((count + 1))
    [ -e "$HOME/.agents/skills/$name/SKILL.md" ] || missing_agents="$missing_agents $name"
    [ -e "$HOME/.claude/skills/$name/SKILL.md" ] || missing_claude="$missing_claude $name"
  done
  if [ -z "$missing_agents" ]; then ok "~/.agents/skills" "all $count linked"; else bad "~/.agents/skills" "missing:$missing_agents; rerun scripts/setup.sh"; fi
  if [ -z "$missing_claude" ]; then ok "~/.claude/skills" "all $count linked"; else bad "~/.claude/skills" "missing:$missing_claude; rerun scripts/setup.sh"; fi

  # --- Third-party skills: what skills.json lists, installed by the skills CLI.
  if [ -f skills.json ] && have python3; then
    section "Third-party skills (skills.json)"
    python3 - "$FLEET_DIR" <<'PY'
import json, os, sys
fleet = sys.argv[1]
home = os.path.expanduser("~")
with open(os.path.join(fleet, "skills.json")) as f:
    manifest = json.load(f)
dirs = [os.path.join(home, ".agents", "skills"), os.path.join(home, ".claude", "skills")]
width = max([22] + [len(e["source"]) for e in manifest.get("sources", [])])
for entry in manifest.get("sources", []):
    names = entry.get("skills", [])
    missing = [n for n in names if not all(os.path.isfile(os.path.join(d, n, "SKILL.md")) for d in dirs)]
    detail = f"all {len(names)} installed" if not missing else f"missing: {', '.join(missing)}; FLEET_SKILLS=yes scripts/setup.sh"
    print(f"{'--' if missing else 'ok':<3} {entry['source']:<{width}} {detail}")
PY
  fi

  # --- Dashboard and daily collect.
  section "Dashboard"
  if [ -d node_modules/astro ]; then ok "dependencies" "installed"; else opt "dependencies" "not installed; pnpm install"; fi
  if [ "$node_ok" = yes ]; then
    if node scripts/write-repo-list.ts --check >/dev/null 2>&1; then ok "repo list" "REPOS.md matches fleet.json"; else bad "repo list" "REPOS.md is missing or out of date; node scripts/write-repo-list.ts"; fi
  fi
  case "$this_os" in
    macos) job="$HOME/Library/LaunchAgents/local.fleet.collect.plist" ;;
    linux) job="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/fleet-collect.timer" ;;
    *) job="" ;;
  esac
  if [ -n "$job" ] && [ -f "$job" ]; then
    ok "daily collect" "set up; scripts/schedule-collect.sh status for the last runs"
  else
    opt "daily collect" "not set up; scripts/schedule-collect.sh install [HH:MM]"
  fi
}

out="$(checks)"
printf '%s\n' "$out"
if printf '%s\n' "$out" | grep -q '^!!'; then
  printf '\nNot done: fix the !! lines.\n'
  exit 1
fi
printf '\nNo problems. The -- lines are optional.\n'
