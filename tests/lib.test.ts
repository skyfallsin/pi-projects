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
