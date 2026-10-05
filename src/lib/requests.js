import pLimit from "p-limit";
import { promiseTimeout } from "./util.js";

export function createRequestQueue(concurrency = 5) {
	const limit = pLimit(concurrency);
	return (task, timeoutMs) => limit(() => promiseTimeout(task, timeoutMs));
}

export function createSingleFlight() {
	const pending = new Map();
	return (key, task) => {
		if (pending.has(key)) return pending.get(key);
		const promise = Promise.resolve()
			.then(task)
			.finally(() => pending.delete(key));
		pending.set(key, promise);
		return promise;
	};
}

export const jackettRequests = createRequestQueue();
export const torrentRequests = createRequestQueue();
