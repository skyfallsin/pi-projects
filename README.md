# pi-projects

Self-contained project directories for the [pi](https://pi.dev/) coding agent.

Each project gets its own folder with `ABOUT.md`, `MEMORY.md`, `AGENTS.md`, `CRON.md` — extractable and immediately usable by any LLM.

No central index file. `project_list` scans directories and reads each `ABOUT.md` in real-time.

## Layout

Projects live under `~/.pi/agent/memory/projects/` by default (override with `PI_PROJECTS_DIR`):

```
projects/
├── my-website/
│   ├── ABOUT.md       # Identity, status, description, key files, context
│   ├── MEMORY.md      # Project-specific decisions and facts
│   ├── AGENTS.md      # Project-specific behavioral rules
│   └── CRON.md        # Scheduled tasks
├── data-pipeline/
│   ├── ABOUT.md
│   ├── MEMORY.md
│   ├── AGENTS.md
│   └── CRON.md
└── ...
```

Each project folder is **self-contained** — copy it to another machine, hand it to a different LLM, or archive it. Everything that LLM needs to understand and work on the project is inside.

## Tools

| Tool | Description |
|------|-------------|
| `project_create` | Scaffold a new project directory with all four files |
| `project_list` | List all projects — scans dirs and reads each ABOUT.md live |
| `project_read` | Read a specific file from a project (ABOUT.md, MEMORY.md, etc.) |
| `project_update` | Update a file in a project directory (overwrite or append) |

## Context Injection

A compact one-liner-per-project summary is injected into the system prompt before every agent turn:

```
## Projects
2 project(s). Use `project_list` for full details, `project_create` to start a new one.

- **My Website** — Personal portfolio site `my-website/`
- **Data Pipeline** (paused) — ETL pipeline for analytics `data-pipeline/`
```

Full project details are available on-demand via `project_list` and `project_read`.

## ABOUT.md Format

```markdown
# Project Name

## Status
active

## Description
One-line summary of what this project is.

## Key Files
- path/to/main/file
- path/to/config

## Context
Anything another LLM would need to pick up this project and work on it.
```

The `Status`, `Description`, and heading are parsed automatically for the summary. Everything else is free-form.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `PI_PROJECTS_DIR` | `{PI_MEMORY_DIR}/projects/` | Root directory for project folders |
| `PI_MEMORY_DIR` | `~/.pi/agent/memory/` | Used to derive projects dir if `PI_PROJECTS_DIR` is not set |

## Installation

```bash
pi install git:github.com/jo-inc/pi-projects
```

## Related

- **[pi-mem](https://github.com/jo-inc/pi-mem)** — Memory system (MEMORY.md, daily logs, scratchpad)
- **[pi-reflect](https://github.com/jo-inc/pi-reflect)** — Self-improving reflection on behavioral files

## License

MIT
