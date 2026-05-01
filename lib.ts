/**
 * Pure logic for pi-projects. No pi API dependencies — just file I/O and string manipulation.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// --- Config ---

export interface ProjectsConfig {
	projectsDir: string;
}

export function buildConfig(env: Record<string, string | undefined> = process.env): ProjectsConfig {
	const memoryDir = env.PI_MEMORY_DIR ?? path.join(env.HOME ?? "~", ".pi", "agent", "memory");
	const projectsDir = env.PI_PROJECTS_DIR ?? path.join(memoryDir, "projects");
	return { projectsDir };
}

// --- Helpers ---

export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function readFileSafe(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}

/** Resolve a path within a project dir with traversal protection. */
function safeResolve(baseDir: string, ...segments: string[]): string | null {
	const resolved = path.resolve(path.join(baseDir, ...segments));
	if (!resolved.startsWith(path.resolve(baseDir) + path.sep) && resolved !== path.resolve(baseDir)) {
		return null;
	}
	return resolved;
}

// --- Project info ---

export interface ProjectInfo {
	slug: string;
	name: string;
	status: string;
	description: string;
	aboutPath: string;
	files: string[];
	aboutRaw: string | null;
}

/**
 * Parse ABOUT.md for structured fields.
 * Returns name, status, description extracted from the markdown.
 */
export function parseAbout(content: string, fallbackName: string): { name: string; status: string; description: string } {
	let name = fallbackName;
	let status = "active";
	let description = "";

	const nameMatch = content.match(/^#\s+(.+)$/m);
	if (nameMatch) name = nameMatch[1].trim();

	const statusMatch = content.match(/^##\s+Status\s*\n+([^\n#]+)/m);
	if (statusMatch) status = statusMatch[1].trim().toLowerCase();

	const descMatch = content.match(/^##\s+Description\s*\n+([\s\S]*?)(?=\n##|$)/m);
	if (descMatch) {
		const firstLine = descMatch[1].trim().split("\n")[0];
		if (firstLine && !firstLine.startsWith("_")) description = firstLine;
	}

	return { name, status, description };
}

// --- Core operations ---

/**
 * Scan all project directories, read each ABOUT.md, return structured info.
 */
export function listProjects(config: ProjectsConfig): ProjectInfo[] {
	const { projectsDir } = config;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(projectsDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const projects: ProjectInfo[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

		const projectDir = path.join(projectsDir, entry.name);
		const aboutPath = path.join(projectDir, "ABOUT.md");
		const aboutRaw = readFileSafe(aboutPath);

		const { name, status, description } = aboutRaw
			? parseAbout(aboutRaw, entry.name)
			: { name: entry.name, status: "active", description: "" };

		let files: string[] = [];
		try {
			files = fs.readdirSync(projectDir).filter((f) => !f.startsWith(".")).sort();
		} catch {}

		projects.push({ slug: entry.name, name, status, description, aboutPath, files, aboutRaw });
	}

	return projects.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Create a new project directory with scaffolded files.
 */
export function createProject(
	config: ProjectsConfig,
	name: string,
	description?: string,
): { slug: string; projectDir: string; created: string[] } {
	const slug = slugify(name);
	if (!slug) throw new Error("Invalid project name — couldn't generate a slug");

	const projectDir = path.join(config.projectsDir, slug);

	if (fs.existsSync(projectDir)) {
		throw new Error(`Project already exists: ${slug}/`);
	}

	fs.mkdirSync(projectDir, { recursive: true });

	const created: string[] = [];

	// ABOUT.md — the identity file
	const about = [
		`# ${name}`,
		"",
		"## Status",
		"active",
		"",
		"## Description",
		description || "_Add a description_",
		"",
		"## Key Files",
		"_Add important file paths here_",
		"",
		"## Context",
		"_Add any context another LLM would need to work on this project_",
		"",
	].join("\n");
	fs.writeFileSync(path.join(projectDir, "ABOUT.md"), about, "utf-8");
	created.push("ABOUT.md");

	// MEMORY.md — project-specific memory
	const memory = [
		`# ${name} — Memory`,
		"",
		"Project-specific decisions, facts, and preferences.",
		"",
	].join("\n");
	fs.writeFileSync(path.join(projectDir, "MEMORY.md"), memory, "utf-8");
	created.push("MEMORY.md");

	// AGENTS.md — project-specific rules
	const agents = [
		`# ${name} — Agent Rules`,
		"",
		"Project-specific behavioral rules and conventions.",
		"",
	].join("\n");
	fs.writeFileSync(path.join(projectDir, "AGENTS.md"), agents, "utf-8");
	created.push("AGENTS.md");

	// CRON.md — scheduled tasks
	const cron = [`# ${name} — Scheduled Tasks`, "", "_No scheduled tasks yet._", ""].join("\n");
	fs.writeFileSync(path.join(projectDir, "CRON.md"), cron, "utf-8");
	created.push("CRON.md");

	return { slug, projectDir, created };
}

/**
 * Build a compact projects summary for system prompt injection.
 * One line per project — name, status, description, slug.
 */
export function buildProjectsSummary(config: ProjectsConfig): string {
	const projects = listProjects(config);
	if (projects.length === 0) return "";

	const lines: string[] = [];
	for (const p of projects) {
		const statusTag = p.status !== "active" ? ` (${p.status})` : "";
		const desc = p.description ? ` — ${p.description}` : "";
		lines.push(`- **${p.name}**${statusTag}${desc} \`${p.slug}/\``);
	}

	return [
		`${projects.length} project(s). Use \`project_list\` for full details, \`project_create\` to start a new one.`,
		"",
		...lines,
	].join("\n");
}

/**
 * Read a file from a project directory.
 */
export function readProjectFile(
	config: ProjectsConfig,
	project: string,
	file?: string,
): { content: string; filePath: string; relativePath: string } | null {
	const projectDir = path.join(config.projectsDir, project);
	const fileName = file || "ABOUT.md";
	const filePath = safeResolve(config.projectsDir, project, fileName);

	if (!filePath) return null;

	const content = readFileSafe(filePath);
	if (content === null) return null;

	return { content, filePath, relativePath: `${project}/${fileName}` };
}

/**
 * Write or append to a file in a project directory.
 */
export function updateProjectFile(
	config: ProjectsConfig,
	project: string,
	content: string,
	file?: string,
	mode?: "overwrite" | "append",
): { filePath: string; relativePath: string } {
	const projectDir = path.join(config.projectsDir, project);
	const fileName = file || "ABOUT.md";
	const filePath = safeResolve(config.projectsDir, project, fileName);

	if (!filePath) throw new Error("Invalid path — traversal detected");
	if (!fs.existsSync(projectDir)) throw new Error(`Project not found: ${project}`);

	const writeMode = mode || "overwrite";

	if (writeMode === "append") {
		const existing = readFileSafe(filePath) ?? "";
		const separator = existing.trim() ? "\n\n" : "";
		fs.writeFileSync(filePath, existing + separator + content, "utf-8");
	} else {
		fs.writeFileSync(filePath, content, "utf-8");
	}

	return { filePath, relativePath: `${project}/${fileName}` };
}
