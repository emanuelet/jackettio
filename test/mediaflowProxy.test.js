import assert from "node:assert/strict";
import { test } from "node:test";
import { updateUserConfigWithMediaFlowIp } from "../src/lib/mediaflowProxy.js";

test("does not resolve a MediaFlow IP for P2P streams", async () => {
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = async () => {
		fetchCalls++;
		return new Response(JSON.stringify({ ip: "203.0.113.1" }), { status: 200 });
	};

	try {
		const userConfig = {
			debridId: "p2p",
			enableMediaFlow: true,
			mediaflowProxyUrl: "https://mediaflow.example.test",
			mediaflowApiPassword: "test-password",
		};

		assert.equal(await updateUserConfigWithMediaFlowIp(userConfig), userConfig);
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
