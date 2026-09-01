import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/index.js";

const app = await buildApp();

after(async () => {
	await app.close();
});

test("redirects the root path to configuration", async () => {
	const response = await app.inject({ method: "GET", url: "/" });

	assert.equal(response.statusCode, 302);
	assert.equal(response.headers.location, "/configure");
});

test("returns configuration guidance for unconfigured stream requests", async () => {
	const response = await app.inject({
		method: "GET",
		url: "/stream/movie/tt123.json",
	});

	assert.equal(response.statusCode, 200);
	assert.equal(response.headers["access-control-allow-origin"], "*");
	assert.deepEqual(response.json(), {
		streams: [
			{
				name: "Jackettio",
				title: "ℹ Kindly configure this addon to access streams.",
				url: "#",
			},
		],
	});
});

test("returns a manifest for saved configurations without a debrid selection", async () => {
	const userConfig = Buffer.from(
		JSON.stringify({ qualities: [1080] }),
	).toString("base64");
	const response = await app.inject(`/${userConfig}/manifest.json`);

	assert.equal(response.statusCode, 200);
	assert.equal(response.json().name, "Jackettio");
});

test("returns a manifest for long encoded configurations", async () => {
	const userConfig = Buffer.from(
		JSON.stringify({ debridId: "p2p", padding: "x".repeat(500) }),
	).toString("base64");
	const response = await app.inject(`/${userConfig}/manifest.json`);

	assert.equal(userConfig.length, 708);
	assert.equal(response.statusCode, 200);
	assert.equal(response.json().name, "Jackettio P2P");
});

test("returns the existing XHR 404 response shape", async () => {
	const response = await app.inject({
		method: "GET",
		url: "/missing",
		headers: { "x-requested-with": "XMLHttpRequest" },
	});

	assert.equal(response.statusCode, 404);
	assert.deepEqual(response.json(), { error: "Page not found!" });
});
