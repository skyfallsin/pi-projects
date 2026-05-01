/**
 * pi-projects — Self-contained project directories for the pi coding agent.
 *
 * Each project gets its own folder with ABOUT.md, MEMORY.md, AGENTS.md, CRON.md.
 * No central index file — project_list scans directories and builds a summary in real-time.
 *
 * Tools:
 *   project_create  — scaffold a new project directory
 *   project_list    — list all projects (reads each ABOUT.md live)
 *   project_read    — read a specific file from a project
 *   project_update  — update a file in a project directory
 *
 * Context injection:
 *   - Compact project summary injected into system prompt via before_agent_start
 *
 * Config:
 *   - PI_PROJECTS_DIR env var (default: {PI_MEMORY_DIR}/projects/)
 *   - PI_MEMORY_DIR env var (default: ~/.pi/agent/memory/)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

import {
	buildConfig,
	buildProjectsSummary,
	createProject,
	linkProject,
	listProjects,
	readProjectFile,
	updateProjectFile,
} from "./lib.ts";

const config = buildConfig();

export default function (pi: ExtensionAPI) {
	// --- Commands (user-facing, proxy to the same logic as tools) ---

	pi.registerCommand("project-list", {
		description: "List all projects with status, description, and files",
		handler: async (_args, ctx) => {
			const projects = listProjects(config);
			if (projects.length === 0) {
				ctx.ui.notify(`No projects in ${config.projectsDir}/`, "info");
				return;
			}
			const lines = projects.map((p) => {
				const status = p.status !== "active" ? ` (${p.status})` : "";
				const desc = p.description ? ` — ${p.description}` : "";
				const loc = p.isLinked ? p.linkedTo : `${config.projectsDir}/${p.slug}`;
				return `**${p.name}**${status}${desc}\n  \`${loc}/\``;
			});
			ctx.ui.notify(lines.join("\n\n"), "info");
		},
	});

	pi.registerCommand("project-create", {
		description: "Create a new project: /project-create Name — optional description",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				if (!ctx.hasUI) return;
				const input = await ctx.ui.input("Project name:");
				if (!input) return;
				args = input;
			}
			const [name, ...descParts] = args.split(" — ");
			const description = descParts.join(" — ").trim() || undefined;
			try {
				const result = createProject(config, name.trim(), description);
				ctx.ui.notify(`Created "${name.trim()}" at ${result.projectDir}/\nFiles: ${result.created.join(", ")}`, "info");
			} catch (e: any) {
				ctx.ui.notify(e.message, "error");
			}
		},
	});

	pi.registerCommand("project-link", {
		description: "Link an existing directory: /project-link Name /path/to/dir",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify("Usage: /project-link Name /absolute/path/to/dir", "error");
				return;
			}
			// Parse: everything before the last path-like token is the name
			const match = args.match(/^(.+?)\s+(\/\S+)$/);
			if (!match) {
				ctx.ui.notify("Usage: /project-link Name /absolute/path/to/dir", "error");
				return;
			}
			const [, name, targetPath] = match;
			try {
				const result = linkProject(config, name.trim(), targetPath.trim());
				const parts = [`Linked "${name.trim()}" → ${result.linkedTo}/`];
				if (result.created.length > 0) parts.push(`Created: ${result.created.join(", ")}`);
				if (result.skipped.length > 0) parts.push(`Skipped: ${result.skipped.join(", ")}`);
				ctx.ui.notify(parts.join("\n"), "info");
			} catch (e: any) {
				ctx.ui.notify(e.message, "error");
			}
		},
	});

	pi.registerCommand("project-read", {
		description: "Read a project file: /project-read slug [file]",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify("Usage: /project-read slug [file]", "error");
				return;
			}
			const [project, file] = args.trim().split(/\s+/);
			const result = readProjectFile(config, project, file);
			if (!result) {
				ctx.ui.notify(`Not found: ${project}/${file || "ABOUT.md"}`, "error");
				return;
			}
			ctx.ui.notify(`**${result.relativePath}**\n\n${result.content}`, "info");
		},
	});

	// --- Context injection: compact projects summary in every prompt ---

	pi.on("before_agent_start", async (event) => {
		const summary = buildProjectsSummary(config);
		if (!summary) return;

		return {
			systemPrompt: event.systemPrompt + `\n\n## Projects\n${summary}`,
		};
	});

	// --- Tools ---

	pi.registerTool({
		name: "project_list",
		label: "List Projects",
		description: [
			"List all projects with their status, description, and files.",
			"Scans each project directory and reads ABOUT.md in real-time.",
			"Returns full details — use this when you need project context beyond the summary in the system prompt.",
		].join("\n"),
		promptSnippet: "List all projects with status, description, and files",
		parameters: Type.Object({}),
		async execute() {
			const projects = listProjects(config);

			if (projects.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No projects found in ${config.projectsDir}/\nUse project_create to start one.`,
						},
					],
					details: { count: 0 },
				};
			}

			const sections = projects.map((p) => {
				const statusLine = p.status !== "active" ? `**Status:** ${p.status}\n` : "";
				const descLine = p.description ? `${p.description}\n` : "";
				const filesLine = p.files.length > 0 ? `**Files:** ${p.files.join(", ")}\n` : "";
				const pathLine = p.isLinked
					? `**Path:** ${p.linkedTo}/`
					: `**Path:** ${config.projectsDir}/${p.slug}/`;
				return `## ${p.name}\n${statusLine}${descLine}${filesLine}${pathLine}`;
			});

			return {
				content: [{ type: "text", text: sections.join("\n\n") }],
				details: {
					count: projects.length,
					projects: projects.map((p) => ({ slug: p.slug, name: p.name, status: p.status })),
				},
			};
		},
	});

	pi.registerTool({
		name: "project_link",
		label: "Link Project",
		description: [
			"Link an existing directory as a project. Creates a symlink in the projects directory.",
			"Scaffolds ABOUT.md, MEMORY.md, AGENTS.md, CRON.md inside the target — but only files that don't already exist.",
			"Use this for existing repos and codebases. The original directory is not moved or copied.",
		].join("\n"),
		promptSnippet: "Link an existing directory as a project (scaffolds missing ABOUT.md, etc.)",
		parameters: Type.Object({
			name: Type.String({ description: "Project name (e.g. 'Jo Bot', 'LLM Proxy')" }),
			path: Type.String({ description: "Absolute path to the existing directory" }),
			description: Type.Optional(
				Type.String({ description: "One-line project description" }),
			),
		}),
		async execute(_toolCallId, params) {
			const targetPath = params.path.replace(/^@/, ""); // strip leading @ from model quirks
			const result = linkProject(config, params.name, targetPath, params.description);
			const parts = [`Linked "${params.name}" → ${result.linkedTo}/`];
			if (result.created.length > 0) parts.push(`Created: ${result.created.join(", ")}`);
			if (result.skipped.length > 0) parts.push(`Skipped (already exist): ${result.skipped.join(", ")}`);
			return {
				content: [{ type: "text", text: parts.join("\n") }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "project_create",
		label: "Create Project",
		description: [
			"Create a new self-contained project directory with scaffolded files.",
			"Creates: ABOUT.md (identity/context), MEMORY.md (project memory), AGENTS.md (project rules), CRON.md (scheduled tasks).",
			"Each project folder is self-contained — extractable and immediately usable by any LLM.",
		].join("\n"),
		promptSnippet: "Create a new self-contained project with ABOUT.md, MEMORY.md, AGENTS.md, CRON.md",
		promptGuidelines: [
			"When a user starts a new project or mentions wanting to organize work around a topic, use project_create to scaffold it.",
			"To register an existing repo/directory, use project_link instead — it won't clobber existing files.",
			"Use project_update to maintain ABOUT.md as the project evolves — keep Key Files and Context sections current.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Project name (e.g. 'My Website', 'Data Pipeline')" }),
			description: Type.Optional(
				Type.String({ description: "One-line project description" }),
			),
		}),
		async execute(_toolCallId, params) {
			const result = createProject(config, params.name, params.description);
			return {
				content: [
					{
						type: "text",
						text: `Created project "${params.name}" at ${result.projectDir}/\nFiles: ${result.created.join(", ")}`,
					},
				],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "project_read",
		label: "Read Project File",
		description: [
			"Read a file from a project directory. Defaults to ABOUT.md.",
			"Use this to get full project context, memory, rules, or scheduled tasks.",
		].join("\n"),
		promptSnippet: "Read a project file (ABOUT.md, MEMORY.md, AGENTS.md, CRON.md, etc.)",
		parameters: Type.Object({
			project: Type.String({ description: "Project slug (directory name)" }),
			file: Type.Optional(
				Type.String({ description: "File to read (default: ABOUT.md). e.g. MEMORY.md, AGENTS.md" }),
			),
		}),
		async execute(_toolCallId, params) {
			const result = readProjectFile(config, params.project, params.file);
			if (!result) {
				throw new Error(`Not found: ${params.project}/${params.file || "ABOUT.md"}`);
			}
			return {
				content: [{ type: "text", text: result.content }],
				details: { filePath: result.filePath, relativePath: result.relativePath },
			};
		},
	});

	pi.registerTool({
		name: "project_update",
		label: "Update Project File",
		description: [
			"Update a file in a project directory. Defaults to ABOUT.md.",
			"Use 'overwrite' to replace the entire file, 'append' to add to the end.",
			"Keep ABOUT.md current as the project evolves — it's the entry point for any LLM picking up this project.",
		].join("\n"),
		promptSnippet: "Update a project file (ABOUT.md, MEMORY.md, AGENTS.md, etc.)",
		parameters: Type.Object({
			project: Type.String({ description: "Project slug (directory name)" }),
			content: Type.String({ description: "Content to write" }),
			file: Type.Optional(
				Type.String({ description: "File to update (default: ABOUT.md)" }),
			),
			mode: Type.Optional(
				StringEnum(["overwrite", "append"] as const, {
					description: "Write mode (default: overwrite)",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const result = updateProjectFile(
				config,
				params.project,
				params.content,
				params.file,
				params.mode,
			);
			return {
				content: [{ type: "text", text: `Updated ${result.relativePath}` }],
				details: { filePath: result.filePath, mode: params.mode || "overwrite" },
			};
		},
	});
}
