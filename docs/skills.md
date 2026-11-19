# Skills

fleet is the single source for the skills used across all repos. There are three kinds:

| Kind | Lives in | Reaches the agents by | Updated by |
| --- | --- | --- | --- |
| **Global** | `skills/<name>/SKILL.md` | `scripts/setup.sh` links it into `~/.agents/skills` and `~/.claude/skills` | editing it in fleet; the links show the change at once |
| **Local** | `.agents/skills/<name>/SKILL.md` | apps started in fleet load it directly (`.claude/skills` points there) | editing it in fleet |
| **Third-party** | listed in `skills.json`, installed outside fleet | `scripts/setup.sh` installs it with the `skills` CLI | `pnpm skills:update`, per host |

Global and local skills are yours and versioned in fleet. Third-party skills are listed, not copied: fleet records which ones every host gets, the `skills` CLI records which commit each host has.

## Global skills

For every project on the machine.

- **Add:** create `skills/<name>/SKILL.md`, rerun `scripts/setup.sh`, commit. Other hosts get it with `git pull` and a setup run.
- **Change:** edit the file and commit. The links point into fleet, so this host sees it at once; other hosts after `git pull`.
- **Remove:** delete the folder and rerun setup; it removes the dead links.

Agents that read `~/.agents/skills`: Codex, Amp, Pi, Zed, Delta. Claude Code reads `~/.claude/skills`.

## Local skills

Only for working in fleet, such as `setup`, the setup wizard. Create `.agents/skills/<name>/SKILL.md`; no setup run needed. Apps started in another repo do not see them.

## Third-party skills

Skills from other people, such as those listed on [skills.sh](https://skills.sh), installed with the [`skills` CLI](https://github.com/vercel-labs/skills).

### Add one

1. **Find its name.** A source often holds several skills; this lists them and installs nothing:

   ```sh
   npx skills add <owner/repo> --list
   ```

2. **Add it to `skills.json`.** A new source gets its own entry; for a source already listed, add the name to its `skills`:

   ```json
   { "source": "acme/agent-skills", "skills": ["foo"] }
   ```

3. **Install it on this host:**

   ```sh
   FLEET_SKILLS=yes scripts/setup.sh
   ```

   Setup installs only the skills that are missing, for every agent in `agents`, with `npx <cli> add <source> --global --yes --agent … --skill …`. Without `FLEET_SKILLS` it asks first.
4. **Commit** `skills.json`.
5. **On the other hosts:** `git pull` in fleet, then `FLEET_SKILLS=yes scripts/setup.sh`. Until then `bash .agents/skills/setup/check.sh` lists the skill as missing (`--`).

To try one before keeping it, install it directly, as skills.sh suggests: `npx skills add <owner/repo> --skill foo -g`. If it stays, add it to `skills.json` afterwards; it is already installed, so the next setup run leaves it alone. Until it is in the list, it exists only on this host and `check.sh` does not mention it.

### Update

```sh
pnpm skills:update
```

Moves every skill the CLI installed to the latest commit of its source, on this host only; run it on each host. Nothing updates by itself. The installed commits are in `~/.agents/.skill-lock.json`, per host, not in fleet, so two hosts can be on different commits until both have run it.

### Remove

Take the name out of `skills.json`, commit, and run on each host:

```sh
npx skills remove -g foo
```

Setup never uninstalls anything.

### Change one

A third-party skill you change becomes yours: copy it into `skills/`, note where it came from in its `SKILL.md`, take it out of `skills.json` and remove the installed copy (`npx skills remove -g <name>`). From then on `pnpm skills:update` leaves it alone. A name in both `skills/` and `skills.json` is a mistake: setup warns and uses the one in `skills/`.

### skills.json

```json
{
  "cli": "skills@1.9.0",
  "agents": ["claude-code", "codex", "amp", "pi", "zed"],
  "sources": [{ "source": "mattpocock/skills", "skills": ["tdd", "grilling"] }]
}
```

| Field | Meaning |
| --- | --- |
| `cli` | The `skills` CLI package with its pinned version; setup and `pnpm skills:update` run it through `npx`. To raise the version, change it here. |
| `agents` | The agents the CLI installs for (its `--agent` names). |
| `sources` | One entry per source the CLI accepts (`owner/repo`, a Git URL), with the skill names to install from it. |

## Amp orbs and Delta

**Amp orbs** run on Amp's machines and see no local skills. Import them once into Amp's hosted personal skills, in any Amp thread:

- Global skills: "Import the skills in `skills/` from <your fleet remote> into my personal skills." After changing one, ask Amp: "Check if any of my imported skills are out of date."
- Third-party skills are not in `skills/`; import them from their own sources: "Import the skills `tdd`, `grilling` from https://github.com/mattpocock/skills".

**Delta** web and Cloud Runners only load skills committed to the attached project; personal skills stay on the desktop.
