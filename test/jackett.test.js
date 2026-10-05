import assert from "node:assert/strict";
import { test } from "node:test";
import cache from "../src/lib/cache.js";
import { searchMovieTorrents } from "../src/lib/jackett.js";

function item(name) {
	return {
		title: name,
		guid: name,
		jackettindexer: { id: "test" },
		"torznab:attr": [{ name: "seeders", value: "10" }],
		size: "100",
		link: "magnet:?xt=urn:btih:test",
	};
}

test("raw searches coalesce, isolate results, and cached searches skip HTTP", async (t) => {
	const stored = new Map();
	t.mock.method(cache, "get", async (key) => stored.get(key));
	t.mock.method(cache, "set", async (key, value) => stored.set(key, value));
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => {
		calls++;
		return Response.json({ rss: { channel: { item: [item("movie 1080p")] } } });
	});
	let starts = 0;
	const query = {
		name: "same movie",
		year: 2026,
		timeoutMs: 1000,
		onRequestStart: () => {
			starts++;
		},
	};
	const [first, second] = await Promise.all([
		searchMovieTorrents(query),
		searchMovieTorrents(query),
	]);
	assert.equal(calls, 1);
	first[0].name = "changed by one user";
	assert.equal(second[0].name, "movie 1080p");
	await searchMovieTorrents(query);
	assert.equal(calls, 1);
	assert.equal(starts, 1);
});

test("outbound Jackett searches share a five-request cap", async (t) => {
	t.mock.method(cache, "get", async () => undefined);
	t.mock.method(cache, "set", async () => undefined);
	let active = 0;
	let peak = 0;
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	t.mock.method(globalThis, "fetch", async () => {
		active++;
		peak = Math.max(peak, active);
		await gate;
		active--;
		return Response.json({ rss: { channel: { item: [] } } });
	});
	const work = Array.from({ length: 12 }, (_, index) =>
		searchMovieTorrents({ name: `movie ${index}`, timeoutMs: 1000 }),
	);
	await new Promise((resolve) => setImmediate(resolve));
	const initialActive = active;
	release();
	await Promise.all(work);
	assert.equal(initialActive, 5);
	assert.equal(peak, 5);
});

test("search deadline reaches fetch and failed flights can retry", async (t) => {
	t.mock.method(cache, "get", async () => undefined);
	t.mock.method(cache, "set", async () => undefined);
	let signal;
	t.mock.method(globalThis, "fetch", (_url, options) => {
		signal = options.signal;
		return new Promise((_resolve, reject) => {
			signal.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
		});
	});
	const query = { name: "timeout", timeoutMs: 10 };
	await assert.rejects(searchMovieTorrents(query), /Max execution time/);
	assert.equal(signal.aborted, true);
	t.mock.method(globalThis, "fetch", async () =>
		Response.json({ rss: { channel: { item: [] } } }),
	);
	assert.deepEqual(await searchMovieTorrents(query), []);
});
