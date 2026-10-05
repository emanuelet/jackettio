import assert from "node:assert/strict";
import { test } from "node:test";
import cache from "../src/lib/cache.js";
import { get } from "../src/lib/torrentInfos.js";

test("torrent fetches share a global cap and coalesce identical IDs", async (t) => {
	t.mock.method(cache, "get", async () => undefined);
	let active = 0;
	let peak = 0;
	let calls = 0;
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	t.mock.method(globalThis, "fetch", async () => {
		calls++;
		active++;
		peak = Math.max(peak, active);
		await gate;
		active--;
		return new Response("failed", {
			status: 500,
			headers: { "content-type": "application/x-bittorrent" },
		});
	});
	const work = Array.from({ length: 12 }, (_, index) =>
		get({ id: `torrent-${index}`, link: "https://example.test/torrent" }, 1000),
	);
	work.push(
		get({ id: "torrent-0", link: "https://example.test/torrent" }, 1000),
	);
	const completed = Promise.allSettled(work);
	await new Promise((resolve) => setImmediate(resolve));
	const initialActive = active;
	release();
	const results = await completed;
	assert.equal(initialActive, 5);
	assert.equal(peak, 5);
	assert.equal(calls, 12);
	assert.ok(results.every((result) => result.status === "rejected"));
});

test("torrent fetch deadlines abort HTTP and cache results remain isolated", async (t) => {
	t.mock.method(cache, "get", async () => undefined);
	let signal;
	t.mock.method(globalThis, "fetch", (_url, options) => {
		signal = options.signal;
		return new Promise((_resolve, reject) => {
			signal.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
		});
	});
	const torrent = { id: "cancelled", link: "https://example.test/torrent" };
	await assert.rejects(get(torrent, 10), /Max execution time/);
	assert.equal(signal.aborted, true);
	const cached = { infoHash: "hash", files: [{ name: "original" }] };
	t.mock.method(cache, "get", async () => cached);
	const [first, second] = await Promise.all([
		get(torrent, 10),
		get(torrent, 10),
	]);
	first.files[0].name = "mutated";
	assert.equal(second.files[0].name, "original");
	assert.equal(cached.files[0].name, "original");
});
