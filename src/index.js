import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import compress from "@fastify/compress";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import localtunnel from "localtunnel";
import showdown from "showdown";
import cache from "./lib/cache.js";
import config from "./lib/config.js";
import * as debrid from "./lib/debrid.js";
import * as icon from "./lib/icon.js";
import { getIndexers } from "./lib/jackett.js";
import * as jackettio from "./lib/jackettio.js";
import * as meta from "./lib/meta.js";
import { cleanTorrentFolder, createTorrentFolder } from "./lib/torrentInfos.js";

const converter = new showdown.Converter();
const welcomeMessageHtml = config.welcomeMessage
	? `${converter.makeHtml(config.welcomeMessage)}<div class="my-4 border-top border-secondary-subtle"></div>`
	: "";
const addon = JSON.parse(readFileSync("./package.json"));

function respond(reply, data) {
	return reply
		.header("Access-Control-Allow-Origin", "*")
		.header("Access-Control-Allow-Headers", "*")
		.type("application/json")
		.send(data);
}

function streamRateLimitError(context) {
	const error = new Error(`Rate limit exceeded, retry in ${context.after}`);
	error.statusCode = context.statusCode;
	error.streams = [
		{
			name: config.addonName,
			title: `🛑 Too many requests, please try in ${Math.ceil(context.ttl / 1000 / 60)} minute(s).`,
			url: "#",
		},
	];
	return error;
}

export async function buildApp() {
	const app = Fastify({
		trustProxy: config.trustProxy,
		routerOptions: {
			// Stremio serializes user settings into this route parameter.
			maxParamLength: 4096,
		},
	});

	await app.register(fastifyStatic, {
		root: path.join(import.meta.dirname, "static"),
		maxAge: 86400e3,
	});
	await app.register(compress);
	await app.register(rateLimit, {
		global: false,
		enableDraftSpec: true,
		errorResponseBuilder: (_request, context) => streamRateLimitError(context),
	});

	app.addHook("onRequest", async (request) => {
		request.clientIp = config.trustCfIpHeader
			? request.headers["cf-connecting-ip"] || request.ip
			: request.ip;
	});

	app.addHook("onRequest", async (request) => {
		console.log(
			`${request.method} ${request.url.replace(/\/eyJ[\w=]+/g, "/*******************")}`,
		);
	});

	app.get("/", async (_request, reply) => reply.redirect("/configure"));

	app.get("/icon", async (_request, reply) => {
		const filePath = await icon.getLocation();
		return reply
			.type(path.basename(filePath))
			.header("Cache-Control", "public, max-age=3600")
			.send(createReadStream(filePath));
	});

	const configure = async (request, reply) => {
		const indexers = (await getIndexers().catch(() => [])).map((indexer) => ({
			value: indexer.id,
			label: indexer.title,
			types: ["movie", "series"].filter(
				(type) => indexer.searching[type].available,
			),
		}));
		const templateConfig = {
			debrids: await debrid.list(),
			addon: {
				version: addon.version,
				name: config.addonName,
			},
			userConfig: request.params.userConfig || "",
			defaultUserConfig: config.defaultUserConfig,
			qualities: config.qualities,
			languages: config.languages
				.map((language) => ({ value: language.value, label: language.label }))
				.filter((value) => value.value !== "multi"),
			metaLanguages: await meta.getLanguages(),
			sorts: config.sorts,
			indexers,
			passkey: { enabled: false },
			immulatableUserConfigKeys: config.immulatableUserConfigKeys,
		};
		if (config.replacePasskey) {
			templateConfig.passkey = {
				enabled: true,
				infoUrl: config.replacePasskeyInfoUrl,
				pattern: config.replacePasskeyPattern,
			};
		}
		const template = readFileSync("./src/template/configure.html")
			.toString()
			.replace(
				"/** import-config */",
				`const config = ${JSON.stringify(templateConfig, null, 2)}`,
			)
			.replace("<!-- welcome-message -->", welcomeMessageHtml);
		return reply.type("text/html; charset=utf-8").send(template);
	};
	app.get("/configure", configure);
	app.get("/:userConfig/configure", configure);

	const manifest = async (request, reply) => {
		const manifestData = {
			id: config.addonId,
			version: addon.version,
			name: config.addonName,
			description: config.addonDescription,
			icon: `${request.hostname === "localhost" ? "http" : "https"}://${request.hostname}/icon`,
			resources: ["stream"],
			types: ["movie", "series"],
			idPrefixes: ["tt"],
			catalogs: [],
			behaviorHints: { configurable: true },
		};
		if (request.params.userConfig) {
			const userConfig = JSON.parse(atob(request.params.userConfig));
			const debridService = (await debrid.list()).find(
				(service) => service.id === userConfig.debridId,
			);
			if (debridService) manifestData.name += ` ${debridService.shortName}`;
		}
		return respond(reply, manifestData);
	};
	app.get("/manifest.json", manifest);
	app.get("/:userConfig/manifest.json", manifest);

	app.get(
		"/:userConfig/stream/:type/:id.json",
		{
			config: {
				rateLimit: {
					timeWindow: config.rateLimitWindow * 1000,
					max: config.rateLimitRequest,
					keyGenerator: (request) => request.clientIp || request.ip,
				},
			},
		},
		async (request, reply) => {
			try {
				const streams = await jackettio.getStreams(
					Object.assign(JSON.parse(atob(request.params.userConfig)), {
						ip: request.clientIp,
					}),
					request.params.type,
					request.params.id,
					`${request.hostname === "localhost" ? "http" : "https"}://${request.hostname}`,
				);
				return respond(reply, { streams });
			} catch (error) {
				console.log(request.params.id, error);
				return respond(reply, { streams: [] });
			}
		},
	);

	app.get("/stream/:type/:id.json", async (_request, reply) =>
		respond(reply, {
			streams: [
				{
					name: config.addonName,
					title: "ℹ Kindly configure this addon to access streams.",
					url: "#",
				},
			],
		}),
	);

	const download = async (request, reply) => {
		try {
			const url = await jackettio.getDownload(
				Object.assign(JSON.parse(atob(request.params.userConfig)), {
					ip: request.clientIp,
				}),
				request.params.type,
				request.params.id,
				request.params.torrentId,
			);

			const parsed = new URL(url);
			const cut = (value) =>
				value ? `${value.substring(0, 5)}******${value.substring(-5)}` : "";
			console.log(
				`${request.params.id} : Redirect: ${parsed.protocol}//${parsed.host}${cut(parsed.pathname)}${cut(parsed.search)}`,
			);

			return reply.code(302).header("location", url).send("");
		} catch (error) {
			console.log(request.params.id, error);

			const errorVideos = {
				[debrid.ERROR.NOT_READY]: "/videos/not_ready.mp4",
				[debrid.ERROR.EXPIRED_API_KEY]: "/videos/expired_api_key.mp4",
				[debrid.ERROR.NOT_PREMIUM]: "/videos/not_premium.mp4",
				[debrid.ERROR.ACCESS_DENIED]: "/videos/access_denied.mp4",
				[debrid.ERROR.TWO_FACTOR_AUTH]: "/videos/two_factor_auth.mp4",
			};
			return reply
				.code(302)
				.header("location", errorVideos[error.message] || "/videos/error.mp4")
				.send("");
		}
	};
	app.get("/:userConfig/download/:type/:id/:torrentId", download);
	app.get("/:userConfig/download/:type/:id/:torrentId/:name", download);

	app.setNotFoundHandler((request, reply) => {
		if (request.headers["x-requested-with"] === "XMLHttpRequest") {
			return reply.code(404).send({ error: "Page not found!" });
		}
		return reply.code(404).send("Page not found!");
	});

	app.setErrorHandler((error, request, reply) => {
		console.error(error.stack);
		if (error.streams) {
			return reply.code(error.statusCode).send({ streams: error.streams });
		}
		if (request.headers["x-requested-with"] === "XMLHttpRequest") {
			return reply.code(500).send({ error: "Something broke!" });
		}
		return reply.code(500).send("Something broke!");
	});

	return app;
}

export async function start() {
	const app = await buildApp();
	await app.listen({ port: config.port, host: "0.0.0.0" });
	console.log("───────────────────────────────────────");
	console.log(`Started addon ${addon.name} v${addon.version}`);
	console.log(`Server listen at: http://localhost:${config.port}`);
	console.log("───────────────────────────────────────");

	let tunnel;
	if (config.localtunnel) {
		const subdomain = await cache.get("localtunnel:subdomain");
		tunnel = await localtunnel({ port: config.port, subdomain });
		await cache.set("localtunnel:subdomain", tunnel.clientId, 86400e3 * 365);
		console.log(
			`Your addon is available on the following address: ${tunnel.url}/configure`,
		);
		tunnel.on("close", () => console.log("tunnels are closed"));
	}

	icon
		.download()
		.catch((error) => console.log(`Failed to download icon: ${error}`));

	const intervals = [];
	createTorrentFolder();
	intervals.push(setInterval(cleanTorrentFolder, 3600e3));

	async function closeGracefully(signal) {
		console.log(`Received signal to terminate: ${signal}`);
		if (tunnel) tunnel.close();
		intervals.forEach((interval) => {
			clearInterval(interval);
		});
		await app.close();
		console.log("Server closed");
	}
	process.once("SIGINT", () => closeGracefully("SIGINT"));
	process.once("SIGTERM", () => closeGracefully("SIGTERM"));
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	start().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
