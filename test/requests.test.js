import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createRequestQueue, createSingleFlight } from "../src/lib/requests.js";

test("single-flight shares concurrent work and allows retry after rejection", async () => {
	const flight = createSingleFlight();
	let calls = 0;
	const task = async () => {
		calls++;
		throw new Error("upstream failed");
	};
	const first = flight("same", task);
	assert.equal(first, flight("same", task));
	await assert.rejects(first, /upstream failed/);
	assert.equal(calls, 1);
	assert.equal(await flight("same", async () => "recovered"), "recovered");
});

test("queued deadlines start on execution and slots wait for abort cleanup", async () => {
	const queue = createRequestQueue(1);
	const events = [];
	const first = queue(
		(signal) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener(
					"abort",
					() => {
						events.push("aborted");
						// Simulate asynchronous HTTP connection cleanup.
						setTimeout(() => {
							events.push("cleaned");
							reject(signal.reason);
						}, 20);
					},
					{ once: true },
				);
			}),
		10,
	);
	const rejection = assert.rejects(first, /Max execution time/);
	const second = queue(async (signal) => {
		events.push("next");
		assert.equal(signal.aborted, false);
		return "done";
	}, 10);
	await rejection;
	assert.equal(await second, "done");
	assert.deepEqual(events, ["aborted", "cleaned", "next"]);
});

test("deadline aborts an HTTP response body after headers arrive", async () => {
	let headersReceived = false;
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/plain" });
		response.write("unfinished body");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const queue = createRequestQueue(1);
		await assert.rejects(
			queue(async (signal) => {
				const response = await fetch(
					`http://127.0.0.1:${server.address().port}`,
					{ signal },
				);
				headersReceived = true;
				return response.text();
			}, 200),
		);
		assert.equal(headersReceived, true);
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});
