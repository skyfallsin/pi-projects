/**
 * Pure logic for pi-projects. No pi API dependencies — just file I/O and string manipulation.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// --- Config ---

export interface ProjectsConfig {
	projectsDir: string;
	/** When "cycles", scaffold cycles/ directory instead of CRON.md. Default: "cron.md". */
	cronMode: "cron.md" | "cycles";
}

export function buildConfig(env: Record<string, string | undefined> = process.env): ProjectsConfig {
	const memoryDir = env.PI_MEMORY_DIR ?? path.join(env.HOME ?? "~", ".pi", "agent", "memory");
	const projectsDir = env.PI_PROJECTS_DIR ?? path.join(memoryDir, "projects");
	const cronMode = env.PI_PROJECTS_CRON_MODE === "cycles" ? "cycles" as const : "cron.md" as const;
	return { projectsDir, cronMode };
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

/**
 * Resolve a file path within a project, following symlinks safely.
 * The project slug must be a direct child of projectsDir (no slashes or ..).
 * The file must stay within the resolved project directory.
 */
function resolveProjectFile(projectsDir: string, project: string, fileName: string): string | null {
	if (project.includes("/") || project.includes("\\") || project === ".." || project === ".") {
		return null;
	}

	const projectEntry = path.join(projectsDir, project);

	let resolvedProjectDir: string;
	try {
		resolvedProjectDir = fs.realpathSync(projectEntry);
	} catch {
		return null;
	}

	const filePath = path.resolve(resolvedProjectDir, fileName);

	if (!filePath.startsWith(resolvedProjectDir + path.sep) && filePath !== resolvedProjectDir) {
		return null;
	}

	return filePath;
}

// --- Scaffold templates ---

export function scaffoldAbout(name: string, description?: string): string {
	return [
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
}

function scaffoldMemory(name: string): string {
	return `# ${name} — Memory\n\nProject-specific decisions, facts, and preferences.\n`;
}

function scaffoldAgents(name: string): string {
	return `# ${name} — Agent Rules\n\nProject-specific behavioral rules and conventions.\n`;
}

function scaffoldCron(name: string): string {
	return `# ${name} — Scheduled Tasks\n\n_No scheduled tasks yet._\n`;
}

const SCAFFOLD_FILES: { name: string; template: (name: string, desc?: string) => string }[] = [
	{ name: "ABOUT.md", template: scaffoldAbout },
	{ name: "MEMORY.md", template: scaffoldMemory },
	{ name: "AGENTS.md", template: scaffoldAgents },
	{ name: "CRON.md", template: scaffoldCron },
];

const SCAFFOLD_FILES_CYCLES: { name: string; template: (name: string, desc?: string) => string }[] = [
	{ name: "ABOUT.md", template: scaffoldAbout },
	{ name: "MEMORY.md", template: scaffoldMemory },
	{ name: "AGENTS.md", template: scaffoldAgents },
];

// --- Project info ---

export interface ProjectInfo {
	slug: string;
	name: string;
	status: string;
	description: string;
	aboutPath: string;
	files: string[];
	aboutRaw: string | null;
	isLinked: boolean;
	linkedTo?: string;
}

/**
 * Parse ABOUT.md for structured fields.
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
 * Scan all project directories (including symlinks), read each ABOUT.md, return structured info.
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
		if (entry.name.startsWith(".")) continue;

		const entryPath = path.join(projectsDir, entry.name);
		let isDir = entry.isDirectory();
		let isLinked = false;
		let linkedTo: string | undefined;

		if (!isDir && entry.isSymbolicLink()) {
			try {
				const realPath = fs.realpathSync(entryPath);
				const stat = fs.statSync(realPath);
				isDir = stat.isDirectory();
				if (isDir) {
					isLinked = true;
					linkedTo = realPath;
				}
			} catch {
				continue; // broken symlink
			}
		}

		if (!isDir) continue;

		const resolvedDir = isLinked ? linkedTo! : entryPath;
		const aboutPath = path.join(resolvedDir, "ABOUT.md");
		const aboutRaw = readFileSafe(aboutPath);

		const { name, status, description } = aboutRaw
			? parseAbout(aboutRaw, entry.name)
			: { name: entry.name, status: "active", description: "" };

		let files: string[] = [];
		try {
			files = fs.readdirSync(resolvedDir).filter((f) => !f.startsWith(".")).sort();
		} catch {}

		projects.push({ slug: entry.name, name, status, description, aboutPath, files, aboutRaw, isLinked, linkedTo });
	}

	return projects.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Create a new project directory with all scaffolded files.
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

	const files = config.cronMode === "cycles" ? SCAFFOLD_FILES_CYCLES : SCAFFOLD_FILES;
	const created: string[] = [];
	for (const sf of files) {
		fs.writeFileSync(path.join(projectDir, sf.name), sf.template(name, description), "utf-8");
		created.push(sf.name);
	}

	// In cycles mode, create the cycles/ directory
	if (config.cronMode === "cycles") {
		fs.mkdirSync(path.join(projectDir, "cycles"), { recursive: true });
		created.push("cycles/");
	}

	return { slug, projectDir, created };
}

/**
 * Link an existing directory as a project.
 * Creates a symlink in projectsDir and scaffolds missing files in the target directory.
 */
export function linkProject(
	config: ProjectsConfig,
	name: string,
	targetPath: string,
	description?: string,
): { slug: string; linkedTo: string; created: string[]; skipped: string[] } {
	const slug = slugify(name);
	if (!slug) throw new Error("Invalid project name — couldn't generate a slug");

	const resolvedTarget = path.resolve(targetPath);

	if (!fs.existsSync(resolvedTarget)) {
		throw new Error(`Path does not exist: ${targetPath}`);
	}
	if (!fs.statSync(resolvedTarget).isDirectory()) {
		throw new Error(`Not a directory: ${targetPath}`);
	}

	const linkPath = path.join(config.projectsDir, slug);
	if (fs.existsSync(linkPath)) {
		throw new Error(`Project already exists: ${slug}/`);
	}

	fs.mkdirSync(config.projectsDir, { recursive: true });
	fs.symlinkSync(resolvedTarget, linkPath);

	const files = config.cronMode === "cycles" ? SCAFFOLD_FILES_CYCLES : SCAFFOLD_FILES;
	const created: string[] = [];
	const skipped: string[] = [];

	for (const sf of files) {
		const filePath = path.join(resolvedTarget, sf.name);
		if (fs.existsSync(filePath)) {
			skipped.push(sf.name);
		} else {
			fs.writeFileSync(filePath, sf.template(name, description), "utf-8");
			created.push(sf.name);
		}
	}

	// In cycles mode, ensure cycles/ directory exists
	if (config.cronMode === "cycles") {
		const cyclesDir = path.join(resolvedTarget, "cycles");
		if (fs.existsSync(cyclesDir)) {
			skipped.push("cycles/");
		} else {
			fs.mkdirSync(cyclesDir, { recursive: true });
			created.push("cycles/");
		}
	}

	return { slug, linkedTo: resolvedTarget, created, skipped };
}

/**
 * Build a compact projects summary for system prompt injection.
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
 * Read a file from a project directory (follows symlinks).
 */
export function readProjectFile(
	config: ProjectsConfig,
	project: string,
	file?: string,
): { content: string; filePath: string; relativePath: string } | null {
	const fileName = file || "ABOUT.md";
	const filePath = resolveProjectFile(config.projectsDir, project, fileName);

	if (!filePath) return null;

	const content = readFileSafe(filePath);
	if (content === null) return null;

	return { content, filePath, relativePath: `${project}/${fileName}` };
}

/**
 * Write or append to a file in a project directory (follows symlinks).
 */
export function updateProjectFile(
	config: ProjectsConfig,
	project: string,
	content: string,
	file?: string,
	mode?: "overwrite" | "append",
): { filePath: string; relativePath: string } {
	const fileName = file || "ABOUT.md";

	// Check the project dir exists first (resolve symlink)
	const projectEntry = path.join(config.projectsDir, project);
	try {
		const realDir = fs.realpathSync(projectEntry);
		if (!fs.statSync(realDir).isDirectory()) throw new Error();
	} catch {
		throw new Error(`Project not found: ${project}`);
	}

	const filePath = resolveProjectFile(config.projectsDir, project, fileName);
	if (!filePath) throw new Error("Invalid path — traversal detected");

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
