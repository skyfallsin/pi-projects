import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { isClosedProjectStatus, notifyProjectClosed } from "../index.ts";

describe("project close hook", () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = process.env.PI_PROJECT_CLOSE_HOOK_URL;

	beforeEach(() => {
		process.env.PI_PROJECT_CLOSE_HOOK_URL = "http://sdk.test/projects/archive-sourced-items";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalEnv === undefined) delete process.env.PI_PROJECT_CLOSE_HOOK_URL;
		else process.env.PI_PROJECT_CLOSE_HOOK_URL = originalEnv;
	});

	it("recognizes closed project statuses", () => {
		assert.equal(isClosedProjectStatus("closed"), true);
		assert.equal(isClosedProjectStatus("archived"), true);
		assert.equal(isClosedProjectStatus("active"), false);
	});

	it("notifies sdk wrapper when ABOUT status transitions to closed", async () => {
		let request: { url: string; init: RequestInit } | null = null;
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			request = { url: String(url), init: init || {} };
			return new Response(JSON.stringify({ success: true, list_items_archived: 2 }), { status: 200 });
		}) as typeof fetch;

		const result = await notifyProjectClosed(
			"san-diego-disneyland-trip-jul-4-10",
			"# San Diego & Disneyland Trip\n\n## Status\nclosed\n",
			"# San Diego & Disneyland Trip\n\n## Status\nactive\n",
		);

		assert.deepEqual(result, { success: true, list_items_archived: 2 });
		assert.equal(request?.url, "http://sdk.test/projects/archive-sourced-items");
		assert.equal(request?.init.method, "POST");
		assert.deepEqual(JSON.parse(String(request?.init.body)), {
			project_slug: "san-diego-disneyland-trip-jul-4-10",
			aliases: ["San Diego & Disneyland Trip", "san-diego-disneyland-trip-jul-4-10"],
			archived_by: "project_close:pi-projects",
		});
	});

	it("skips hook when project was already closed", async () => {
		globalThis.fetch = (async () => {
			throw new Error("should not fetch");
		}) as typeof fetch;

		const result = await notifyProjectClosed(
			"trip",
			"# Trip\n\n## Status\nclosed\n",
			"# Trip\n\n## Status\narchived\n",
		);

		assert.equal(result, null);
	});
});
