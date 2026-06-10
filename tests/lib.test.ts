import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
	type ProjectsConfig,
	buildConfig,
	slugify,
	parseAbout,
	listProjects,
	createProject,
	linkProject,
	buildProjectsSummary,
	readProjectFile,
	updateProjectFile,
} from "../lib.ts";

function tmpConfig(): { config: ProjectsConfig; cleanup: () => void } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-projects-test-"));
	const projectsDir = path.join(dir, "projects");
	fs.mkdirSync(projectsDir, { recursive: true });
	return {
		config: { projectsDir },
		cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
	};
}

describe("slugify", () => {
	it("lowercases and replaces spaces", () => {
		assert.equal(slugify("My Website"), "my-website");
	});

	it("handles special characters", () => {
		assert.equal(slugify("Data Pipeline (v2)"), "data-pipeline-v2");
	});

	it("trims leading/trailing hyphens", () => {
		assert.equal(slugify("--hello--"), "hello");
	});

	it("handles unicode", () => {
		assert.equal(slugify("café project"), "caf-project");
	});

	it("returns empty for empty input", () => {
		assert.equal(slugify(""), "");
	});

	it("collapses multiple hyphens", () => {
		assert.equal(slugify("a   b   c"), "a-b-c");
	});
});

describe("parseAbout", () => {
	it("extracts all fields", () => {
		const content = [
			"# My Project",
			"",
			"## Status",
			"paused",
			"",
			"## Description",
			"A cool thing",
			"",
			"## Key Files",
			"- main.py",
		].join("\n");
		const result = parseAbout(content, "fallback");
		assert.equal(result.name, "My Project");
		assert.equal(result.status, "paused");
		assert.equal(result.description, "A cool thing");
	});

	it("uses fallback name when no heading", () => {
		const result = parseAbout("no heading here", "fallback-name");
		assert.equal(result.name, "fallback-name");
		assert.equal(result.status, "active");
		assert.equal(result.description, "");
	});

	it("ignores placeholder descriptions", () => {
		const content = "# X\n\n## Description\n_Add a description_\n";
		const result = parseAbout(content, "x");
		assert.equal(result.description, "");
	});
});

describe("buildConfig", () => {
	it("uses PI_PROJECTS_DIR when set", () => {
		const config = buildConfig({ HOME: "/home/test", PI_PROJECTS_DIR: "/custom/projects" });
		assert.equal(config.projectsDir, "/custom/projects");
	});

	it("derives from PI_MEMORY_DIR", () => {
		const config = buildConfig({ HOME: "/home/test", PI_MEMORY_DIR: "/mem" });
		assert.equal(config.projectsDir, "/mem/projects");
	});

	it("falls back to HOME-based default", () => {
		const config = buildConfig({ HOME: "/home/test" });
		assert.equal(config.projectsDir, "/home/test/.pi/agent/memory/projects");
	});
});

describe("createProject", () => {
	let config: ProjectsConfig;
	let cleanup: () => void;

	beforeEach(() => {
		const tmp = tmpConfig();
		config = tmp.config;
		cleanup = tmp.cleanup;
	});

	afterEach(() => cleanup());

	it("creates project directory with all scaffolded files", () => {
		const result = createProject(config, "My Website", "Personal portfolio");
		assert.equal(result.slug, "my-website");
		assert.ok(fs.existsSync(result.projectDir));
		assert.deepEqual(result.created, ["ABOUT.md", "MEMORY.md", "AGENTS.md", "CRON.md"]);

		const about = fs.readFileSync(path.join(result.projectDir, "ABOUT.md"), "utf-8");
		assert.ok(about.includes("# My Website"));
		assert.ok(about.includes("Personal portfolio"));

		const memory = fs.readFileSync(path.join(result.projectDir, "MEMORY.md"), "utf-8");
		assert.ok(memory.includes("My Website — Memory"));

		const agents = fs.readFileSync(path.join(result.projectDir, "AGENTS.md"), "utf-8");
		assert.ok(agents.includes("My Website — Agent Rules"));

		const cron = fs.readFileSync(path.join(result.projectDir, "CRON.md"), "utf-8");
		assert.ok(cron.includes("My Website — Scheduled Tasks"));
	});

	it("throws on duplicate project", () => {
		createProject(config, "My Website");
		assert.throws(
			() => createProject(config, "My Website"),
			/already exists/,
		);
	});

	it("throws on empty name", () => {
		assert.throws(
			() => createProject(config, ""),
			/Invalid project name/,
		);
	});

	it("creates parent directories if needed", () => {
		const deepConfig: ProjectsConfig = {
			projectsDir: path.join(config.projectsDir, "deep", "nested"),
		};
		const result = createProject(deepConfig, "Test");
		assert.ok(fs.existsSync(result.projectDir));
	});
});

describe("listProjects", () => {
	let config: ProjectsConfig;
	let cleanup: () => void;

	beforeEach(() => {
		const tmp = tmpConfig();
		config = tmp.config;
		cleanup = tmp.cleanup;
	});

	afterEach(() => cleanup());

	it("returns empty for empty directory", () => {
		assert.deepEqual(listProjects(config), []);
	});

	it("returns empty for nonexistent directory", () => {
		const cfg: ProjectsConfig = { projectsDir: "/nonexistent/path" };
		assert.deepEqual(listProjects(cfg), []);
	});

	it("lists projects with ABOUT.md", () => {
		createProject(config, "Alpha", "First project");
		createProject(config, "Beta", "Second project");

		const projects = listProjects(config);
		assert.equal(projects.length, 2);
		assert.equal(projects[0].slug, "alpha");
		assert.equal(projects[0].name, "Alpha");
		assert.equal(projects[0].description, "First project");
		assert.equal(projects[1].slug, "beta");
	});

	it("lists projects without ABOUT.md", () => {
		fs.mkdirSync(path.join(config.projectsDir, "bare-project"));

		const projects = listProjects(config);
		assert.equal(projects.length, 1);
		assert.equal(projects[0].slug, "bare-project");
		assert.equal(projects[0].name, "bare-project"); // falls back to dir name
		assert.equal(projects[0].aboutRaw, null);
	});

	it("skips hidden directories", () => {
		fs.mkdirSync(path.join(config.projectsDir, ".hidden"));
		createProject(config, "Visible");

		const projects = listProjects(config);
		assert.equal(projects.length, 1);
		assert.equal(projects[0].slug, "visible");
	});

	it("skips files (non-directories)", () => {
		fs.writeFileSync(path.join(config.projectsDir, "not-a-project.md"), "hi");
		createProject(config, "Real Project");

		const projects = listProjects(config);
		assert.equal(projects.length, 1);
	});

	it("includes file listing per project", () => {
		createProject(config, "Test");
		// Add an extra file
		fs.writeFileSync(path.join(config.projectsDir, "test", "notes.txt"), "notes");

		const projects = listProjects(config);
		assert.ok(projects[0].files.includes("ABOUT.md"));
		assert.ok(projects[0].files.includes("MEMORY.md"));
		assert.ok(projects[0].files.includes("notes.txt"));
	});
});

describe("buildProjectsSummary", () => {
	let config: ProjectsConfig;
	let cleanup: () => void;

	beforeEach(() => {
		const tmp = tmpConfig();
		config = tmp.config;
		cleanup = tmp.cleanup;
	});

	afterEach(() => cleanup());

	it("returns empty string for no projects", () => {
		assert.equal(buildProjectsSummary(config), "");
	});

	it("builds compact summary", () => {
		createProject(config, "My Website", "Portfolio site");
		createProject(config, "CLI Tool");

		const summary = buildProjectsSummary(config);
		assert.ok(summary.includes("2 project(s)"));
		assert.ok(summary.includes("**CLI Tool**"));
		assert.ok(summary.includes("**My Website**"));
		assert.ok(summary.includes("Portfolio site"));
		assert.ok(summary.includes("`my-website/`"));
	});

	it("shows status for non-active projects", () => {
		createProject(config, "Old Thing");
		// Manually set status to paused
		const aboutPath = path.join(config.projectsDir, "old-thing", "ABOUT.md");
		const content = fs.readFileSync(aboutPath, "utf-8").replace("active", "paused");
		fs.writeFileSync(aboutPath, content);

		const summary = buildProjectsSummary(config);
		assert.ok(summary.includes("(paused)"));
	});
});

describe("readProjectFile", () => {
	let config: ProjectsConfig;
	let cleanup: () => void;

	beforeEach(() => {
		const tmp = tmpConfig();
		config = tmp.config;
		cleanup = tmp.cleanup;
	});

	afterEach(() => cleanup());

	it("reads ABOUT.md by default", () => {
		createProject(config, "Test", "A test project");
		const result = readProjectFile(config, "test");
		assert.ok(result);
		assert.ok(result.content.includes("# Test"));
		assert.equal(result.relativePath, "test/ABOUT.md");
	});

	it("reads a specific file", () => {
		createProject(config, "Test");
		const result = readProjectFile(config, "test", "MEMORY.md");
		assert.ok(result);
		assert.ok(result.content.includes("Memory"));
	});

	it("returns null for nonexistent project", () => {
		assert.equal(readProjectFile(config, "nonexistent"), null);
	});

	it("returns null for nonexistent file", () => {
		createProject(config, "Test");
		assert.equal(readProjectFile(config, "test", "nope.md"), null);
	});

	it("blocks path traversal", () => {
		createProject(config, "Test");
		assert.equal(readProjectFile(config, "test", "../../etc/passwd"), null);
		assert.equal(readProjectFile(config, "..", "ABOUT.md"), null);
	});
});

describe("updateProjectFile", () => {
	let config: ProjectsConfig;
	let cleanup: () => void;

	beforeEach(() => {
		const tmp = tmpConfig();
		config = tmp.config;
		cleanup = tmp.cleanup;
	});

	afterEach(() => cleanup());

	it("overwrites ABOUT.md by default", () => {
		createProject(config, "Test");
		updateProjectFile(config, "test", "# New Content\n");
		const content = fs.readFileSync(path.join(config.projectsDir, "test", "ABOUT.md"), "utf-8");
		assert.equal(content, "# New Content\n");
	});

	it("appends to a file", () => {
		createProject(config, "Test");
		updateProjectFile(config, "test", "## New Section\nStuff", "MEMORY.md", "append");
		const content = fs.readFileSync(path.join(config.projectsDir, "test", "MEMORY.md"), "utf-8");
		assert.ok(content.includes("Memory")); // original
		assert.ok(content.includes("## New Section")); // appended
	});

	it("creates new files", () => {
		createProject(config, "Test");
		updateProjectFile(config, "test", "custom notes", "NOTES.md");
		const content = fs.readFileSync(path.join(config.projectsDir, "test", "NOTES.md"), "utf-8");
		assert.equal(content, "custom notes");
	});

	it("throws on nonexistent project", () => {
		assert.throws(
			() => updateProjectFile(config, "nonexistent", "content"),
			/not found/,
		);
	});

	it("blocks path traversal", () => {
		createProject(config, "Test");
		assert.throws(
			() => updateProjectFile(config, "test", "evil", "../../etc/passwd"),
			/traversal/,
		);
	});
});

describe("linkProject", () => {
	let config: ProjectsConfig;
	let cleanup: () => void;
	let externalDir: string;

	beforeEach(() => {
		const tmp = tmpConfig();
		config = tmp.config;
		cleanup = tmp.cleanup;
		// Create an external directory to link to
		externalDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-projects-ext-")));
	});

	afterEach(() => {
		cleanup();
		fs.rmSync(externalDir, { recursive: true, force: true });
	});

	it("creates symlink and scaffolds all files", () => {
		const result = linkProject(config, "My Repo", externalDir, "A linked repo");
		assert.equal(result.slug, "my-repo");
		assert.equal(result.linkedTo, externalDir);
		assert.deepEqual(result.created, ["ABOUT.md", "MEMORY.md", "AGENTS.md", "CRON.md"]);
		assert.deepEqual(result.skipped, []);

		// Symlink exists
		const linkPath = path.join(config.projectsDir, "my-repo");
		assert.ok(fs.lstatSync(linkPath).isSymbolicLink());
		assert.equal(fs.readlinkSync(linkPath), externalDir);

		// Files created in external dir
		const about = fs.readFileSync(path.join(externalDir, "ABOUT.md"), "utf-8");
		assert.ok(about.includes("# My Repo"));
		assert.ok(about.includes("A linked repo"));
	});

	it("skips existing files", () => {
		// Pre-create AGENTS.md in external dir
		fs.writeFileSync(path.join(externalDir, "AGENTS.md"), "# Existing rules\n");
		fs.writeFileSync(path.join(externalDir, "MEMORY.md"), "# Existing memory\n");

		const result = linkProject(config, "With Existing", externalDir);
		assert.deepEqual(result.created, ["ABOUT.md", "CRON.md"]);
		assert.deepEqual(result.skipped, ["MEMORY.md", "AGENTS.md"]);

		// Existing files NOT clobbered
		const agents = fs.readFileSync(path.join(externalDir, "AGENTS.md"), "utf-8");
		assert.equal(agents, "# Existing rules\n");
	});

	it("throws on duplicate project", () => {
		linkProject(config, "My Repo", externalDir);
		const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-projects-ext2-"));
		try {
			assert.throws(
				() => linkProject(config, "My Repo", otherDir),
				/already exists/,
			);
		} finally {
			fs.rmSync(otherDir, { recursive: true, force: true });
		}
	});

	it("throws on nonexistent path", () => {
		assert.throws(
			() => linkProject(config, "Bad", "/nonexistent/path"),
			/does not exist/,
		);
	});

	it("throws on file (not directory)", () => {
		const filePath = path.join(externalDir, "file.txt");
		fs.writeFileSync(filePath, "hi");
		assert.throws(
			() => linkProject(config, "Bad", filePath),
			/Not a directory/,
		);
	});
});

describe("listProjects with symlinks", () => {
	let config: ProjectsConfig;
	let cleanup: () => void;
	let externalDir: string;

	beforeEach(() => {
		const tmp = tmpConfig();
		config = tmp.config;
		cleanup = tmp.cleanup;
		externalDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-projects-ext-")));
	});

	afterEach(() => {
		cleanup();
		fs.rmSync(externalDir, { recursive: true, force: true });
	});

	it("lists linked projects alongside regular ones", () => {
		createProject(config, "Regular");
		linkProject(config, "Linked", externalDir, "An external repo");

		const projects = listProjects(config);
		assert.equal(projects.length, 2);

		const linked = projects.find(p => p.slug === "linked")!;
		assert.ok(linked);
		assert.equal(linked.isLinked, true);
		assert.equal(linked.linkedTo, externalDir);
		assert.equal(linked.name, "Linked");
		assert.equal(linked.description, "An external repo");

		const regular = projects.find(p => p.slug === "regular")!;
		assert.ok(regular);
		assert.equal(regular.isLinked, false);
		assert.equal(regular.linkedTo, undefined);
	});

	it("handles broken symlinks gracefully", () => {
		createProject(config, "Good");
		// Create a broken symlink
		fs.symlinkSync("/nonexistent/broken", path.join(config.projectsDir, "broken"));

		const projects = listProjects(config);
		assert.equal(projects.length, 1); // only the good one
		assert.equal(projects[0].slug, "good");
	});

	it("reads files from linked projects", () => {
		linkProject(config, "Ext", externalDir, "External project");

		const result = readProjectFile(config, "ext");
		assert.ok(result);
		assert.ok(result.content.includes("# Ext"));
		assert.ok(result.filePath.startsWith(externalDir));
	});

	it("updates files in linked projects", () => {
		linkProject(config, "Ext", externalDir);

		updateProjectFile(config, "ext", "new memory content", "MEMORY.md");
		const content = fs.readFileSync(path.join(externalDir, "MEMORY.md"), "utf-8");
		assert.equal(content, "new memory content");
	});
});

describe("cycles mode", () => {
	let tmpDir: string;
	let cyclesConfig: ProjectsConfig;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-projects-cycles-"));
		cyclesConfig = { projectsDir: tmpDir, cronMode: "cycles" };
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("createProject scaffolds cycles/ instead of CRON.md", () => {
		const result = createProject(cyclesConfig, "Research Dogs", "Find hypoallergenic breeds");
		assert.ok(result.created.includes("ABOUT.md"));
		assert.ok(result.created.includes("MEMORY.md"));
		assert.ok(result.created.includes("AGENTS.md"));
		assert.ok(result.created.includes("cycles/"));
		assert.ok(result.created.includes("cycles/main/"));
		assert.ok(!result.created.includes("CRON.md"));

		assert.ok(fs.existsSync(path.join(result.projectDir, "cycles")));
		assert.ok(fs.statSync(path.join(result.projectDir, "cycles")).isDirectory());
		const cycleDir = path.join(result.projectDir, "cycles", "main");
		assert.ok(fs.existsSync(path.join(cycleDir, "cycle.md")));
		assert.ok(fs.existsSync(path.join(cycleDir, "cycle.json")));
		assert.ok(fs.existsSync(path.join(cycleDir, "state.json")));
		assert.ok(fs.existsSync(path.join(cycleDir, "notes.md")));
		assert.ok(fs.statSync(path.join(cycleDir, "history")).isDirectory());
		assert.equal(fs.statSync(path.join(cycleDir, "should-run.example.sh")).mode & 0o111, 0o111);
		const cycleConfig = JSON.parse(fs.readFileSync(path.join(cycleDir, "cycle.json"), "utf-8"));
		assert.equal(cycleConfig.agent, true);
		assert.equal(cycleConfig.produces_cards, true);
		assert.equal(cycleConfig.max_cards_per_run, 3);
		assert.equal(cycleConfig.should_run, undefined);
		assert.ok(!fs.existsSync(path.join(result.projectDir, "CRON.md")));
	});

	it("linkProject scaffolds cycles/ instead of CRON.md", () => {
		const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ext-"));
		try {
			const result = linkProject(cyclesConfig, "Linked", extDir, "A linked project");
			assert.ok(result.created.includes("cycles/"));
			assert.ok(result.created.includes("cycles/main/"));
			assert.ok(!result.created.includes("CRON.md"));
			assert.ok(fs.existsSync(path.join(extDir, "cycles", "main", "cycle.md")));
			assert.ok(!fs.existsSync(path.join(extDir, "CRON.md")));
		} finally {
			fs.rmSync(extDir, { recursive: true, force: true });
		}
	});

	it("linkProject creates main cycle when cycles/ already exists", () => {
		const extDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ext-"));
		fs.mkdirSync(path.join(extDir, "cycles"));
		try {
			const result = linkProject(cyclesConfig, "Linked2", extDir);
			assert.ok(!result.skipped.includes("cycles/"));
			assert.ok(!result.created.includes("cycles/"));
			assert.ok(result.created.includes("cycles/main/"));
			assert.ok(fs.existsSync(path.join(extDir, "cycles", "main", "cycle.md")));
		} finally {
			fs.rmSync(extDir, { recursive: true, force: true });
		}
	});

	it("default config uses cron.md mode", () => {
		const defaultConfig = buildConfig({ HOME: tmpDir });
		assert.equal(defaultConfig.cronMode, "cron.md");
	});

	it("PI_PROJECTS_CRON_MODE=cycles enables cycles mode", () => {
		const cfg = buildConfig({ HOME: tmpDir, PI_PROJECTS_CRON_MODE: "cycles" });
		assert.equal(cfg.cronMode, "cycles");
	});
});
