import assert from "node:assert/strict";
import { test } from "node:test";
import cache from "../src/lib/cache.js";

test("cache expires entries using millisecond TTLs", async () => {
	const key = `test:ttl:${crypto.randomUUID()}`;
	await cache.set(key, "value", 25);
	assert.equal(await cache.get(key), "value");

	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(await cache.get(key), undefined);
});
