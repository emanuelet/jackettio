import { KeyvSqlite } from "@keyv/sqlite";
import { createCache } from "cache-manager";
import { Keyv } from "keyv";
import config from "./config.js";

const cache = createCache({
	stores: [
		new Keyv({
			store: new KeyvSqlite(`sqlite://${config.dataFolder}/cache-v7.db`),
			ttl: 86400e3,
		}),
	],
});

export default cache;
