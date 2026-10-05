import crypto from "node:crypto";
import { Parser } from "xml2js";
import cache from "./cache.js";
import config from "./config.js";
import { createSingleFlight, jackettRequests } from "./requests.js";
import { numberPad, parseWords } from "./util.js";

const searches = createSingleFlight();
const indexerRequests = createSingleFlight();

async function searchItems(
	cacheKey,
	indexer,
	query,
	timeoutMs,
	onRequestStart,
) {
	const items = await searches(`${cacheKey}:${timeoutMs}`, async () => {
		const cached = await cache.get(cacheKey);
		if (cached) return cached;
		const res = await jackettRequests((signal) => {
			onRequestStart?.();
			return jackettApi(
				`/api/v2.0/indexers/${indexer}/results/torznab/api`,
				query,
				signal,
			);
		}, timeoutMs);
		const items = res?.rss?.channel?.item || [];
		await cache.set(
			cacheKey,
			items,
			(items.length > 0 ? 3600 * 36 : 60) * 1000,
		);
		return items;
	});
	// Each caller mutates its torrent results during filtering and debrid checks.
	return normalizeItems(structuredClone(items));
}

export const CATEGORY = {
	MOVIE: 2000,
	SERIES: 5000,
};

export async function searchMovieTorrents({
	indexer,
	name,
	year,
	timeoutMs = config.defaultUserConfig.indexerTimeoutSec * 1000,
	onRequestStart,
}) {
	indexer = indexer || "all";
	const cacheKey = `jackettItems:2:movie:${indexer}:${name}:${year}`;
	return searchItems(
		cacheKey,
		indexer,
		{ t: "search", cat: CATEGORY.MOVIE, q: name },
		timeoutMs,
		onRequestStart,
	);
}

export async function searchSerieTorrents({
	indexer,
	name,
	year,
	timeoutMs = config.defaultUserConfig.indexerTimeoutSec * 1000,
	onRequestStart,
}) {
	indexer = indexer || "all";
	const cacheKey = `jackettItems:2:serie:${indexer}:${name}:${year}`;
	return searchItems(
		cacheKey,
		indexer,
		{ t: "search", cat: CATEGORY.SERIES, q: `${name}` },
		timeoutMs,
		onRequestStart,
	);
}

export async function searchSeasonTorrents({
	indexer,
	name,
	year,
	season,
	timeoutMs = config.defaultUserConfig.indexerTimeoutSec * 1000,
	onRequestStart,
}) {
	indexer = indexer || "all";
	const cacheKey = `jackettItems:2:season:${indexer}:${name}:${year}:${season}`;
	return searchItems(
		cacheKey,
		indexer,
		{ t: "search", cat: CATEGORY.SERIES, q: `${name} S${numberPad(season)}` },
		timeoutMs,
		onRequestStart,
	);
}

export async function searchEpisodeTorrents({
	indexer,
	name,
	year,
	season,
	episode,
	timeoutMs = config.defaultUserConfig.indexerTimeoutSec * 1000,
	onRequestStart,
}) {
	indexer = indexer || "all";
	const cacheKey = `jackettItems:2:episode:${indexer}:${name}:${year}:${season}:${episode}`;
	return searchItems(
		cacheKey,
		indexer,
		{
			t: "search",
			cat: CATEGORY.SERIES,
			q: `${name} S${numberPad(season)}E${numberPad(episode)}`,
		},
		timeoutMs,
		onRequestStart,
	);
}

export async function getIndexers(
	timeoutMs = config.defaultUserConfig.indexerTimeoutSec * 1000,
) {
	const res = await indexerRequests(`${timeoutMs}`, () =>
		jackettRequests(
			(signal) =>
				jackettApi(
					"/api/v2.0/indexers/all/results/torznab/api",
					{ t: "indexers", configured: "true" },
					signal,
				),
			timeoutMs,
		),
	);

	return normalizeIndexers(structuredClone(res?.indexers?.indexer || []));
}

async function jackettApi(path, query, signal) {
	const params = new URLSearchParams(query || {});
	params.set("apikey", config.jackettApiKey);

	const url = `${config.jackettUrl}${path}?${params.toString()}`;

	let data;
	const res = await fetch(url, { signal });
	const redactedUrl = url.replace(/apikey=[a-z0-9-]+/, "apikey=****");
	if (!res.ok) {
		await res.body?.cancel();
		throw new Error(`jackettApi: ${redactedUrl}: HTTP ${res.status}`);
	}
	if ((res.headers.get("content-type") || "").includes("application/json")) {
		data = await res.json();
	} else {
		const text = await res.text();
		const parser = new Parser({ explicitArray: false, ignoreAttrs: false });
		data = await parser.parseStringPromise(text);
	}

	if (data.error) {
		throw new Error(
			`jackettApi: ${redactedUrl} : ${data.error?.$?.description || data.error}`,
		);
	}

	return data;
}

function normalizeItems(items) {
	return forceArray(items).map((item) => {
		item = mergeDollarKeys(item);
		const attr = forceArray(item["torznab:attr"])
			.filter(Boolean)
			.reduce((obj, item) => {
				obj[item.name] = item.value;
				return obj;
			}, {});
		const quality = item.title.match(/(2160|1080|720|480|360)p/);
		const title = parseWords(item.title).join(" ");
		const year = item.title
			.replace(quality ? quality[1] : "", "")
			.match(/(19|20[\d]{2})/);
		return {
			name: item.title,
			guid: item.guid,
			indexerId: item.jackettindexer.id,
			id: crypto.createHash("sha1").update(item.guid).digest("hex"),
			size: parseInt(item.size, 10),
			link: item.link,
			seeders: parseInt(attr.seeders || 0, 10),
			peers: parseInt(attr.peers || 0, 10),
			infoHash: attr.infohash || "",
			magneturl: attr.magneturl || "",
			type: item.type,
			quality: quality ? parseInt(quality[1], 10) : 0,
			year: year ? parseInt(year.pop(), 10) : 0,
			languages: config.languages.filter((lang) => title.match(lang.pattern)),
		};
	});
}

function normalizeIndexers(items) {
	return forceArray(items).map((item) => {
		item = mergeDollarKeys(item);
		const searching = item.caps.searching;
		return {
			id: item.id,
			configured: item.configured === "true",
			title: item.title,
			language: item.language,
			type: item.type,
			categories: forceArray(item.caps.categories.category).map((category) =>
				parseInt(category.id, 10),
			),
			searching: {
				movie: {
					available: searching["movie-search"].available === "yes",
					supportedParams: searching["movie-search"].supportedParams.split(","),
				},
				series: {
					available: searching["tv-search"].available === "yes",
					supportedParams: searching["tv-search"].supportedParams.split(","),
				},
			},
		};
	});
}

function mergeDollarKeys(item) {
	if (item.$) {
		item = { ...item.$, ...item };
		delete item.$;
	}
	for (const key in item) {
		if (typeof item[key] === "object") {
			item[key] = mergeDollarKeys(item[key]);
		}
	}
	return item;
}

function forceArray(value) {
	return Array.isArray(value) ? value : [value];
}
