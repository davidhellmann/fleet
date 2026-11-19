# Fleet

Home repo and control desk. Start here when a task spans several repos or does not belong to one yet. This repo holds the skills, the machine setup and the dashboard; the code lives in the repos. Nothing personal lives here: the repo list and the usage data are in a private data repo.

- Global skills live in `skills/` and are linked into every project by `scripts/setup.sh`; third-party ones are listed in `skills.json` and installed by it. Skills only for fleet live in `.agents/skills/`.
- To set up or check a machine, use the local `setup` skill, a wizard over `README.md` and `docs/vps.md`. To add, update or remove a skill, follow `docs/skills.md`.
- The local dashboard lives in `dashboard/` (Astro, React, shadcn, Tailwind; `pnpm dashboard`). Read `docs/dashboard.md` before working on it; its Decisions section holds the version pins, the theme and the browser policy. Run `pnpm typecheck` and `pnpm test` after changes.
- The private data repo (`data` in `fleet.local.json`, at `<root>/<its name>`) holds `fleet.json`, the repo list, and the dashboard's usage data (`<host>/`). The collector writes and pushes the usage data; never edit it by hand. Never copy anything from the data repo into fleet: no repo names, paths, costs or numbers in fleet's files, docs or commits.

## Working in the repos

- The repos are listed in `REPOS.md`, generated from `fleet.json`; read it before working across repos. A repo lives at `<root>/<dir>/<name>`: the repo name is its folder name, and `root` comes from `fleet.local.json`, this host's settings (without that file: the folder holding fleet). With `"flat": true` there, `dir` is ignored and every repo lives at `<root>/<name>`. Each worktree branch lives next to its repo, at `<name>-<branch>`.
- Work on each repo in place, at its path.
- Before touching a repo, read its read-first file.
- If a repo or worktree is missing, run `FLEET_CLONE=yes scripts/setup.sh`. A repo limited by `os` to another system is not cloned here; work on it on a host it allows.
- fleet only clones. Setting a repo up (dependencies, database, `.env`, worktree setup) follows that repo's own docs.
- To add or change a repo, edit `fleet.json` in the data repo, run `node scripts/write-repo-list.ts` (Node 22.18+) to regenerate `REPOS.md`, then commit and push the data repo; never edit `REPOS.md` by hand. Other hosts get the change with their next collector run. Every config file, field, environment variable and command: `README.md`, section Configuration. Keep that section in step when one of them changes.
- In Delta or an Amp orb, add the repos to the thread or project instead of following the paths; in an orb they are checked out under `../repos/`.

## Repos

`REPOS.md` (ignored by Git; Claude Code loads it through `CLAUDE.md`). Missing? Run `scripts/setup.sh` or `node scripts/write-repo-list.ts`.

## Commits

Write commit messages as Conventional Commits 1.0.0 (https://www.conventionalcommits.org/en/v1.0.0/): `<type>[optional scope]: <description>`, for example `fix(sync): retry on rate limit`. This is the default here and in every repo in `fleet.json`; a repo whose own AGENTS.md or CLAUDE.md sets a different rule keeps its rule.
