import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const SERVER_PORT = process.env.OMP_DECK_PORT ?? "8787";
const SERVER_HOST = process.env.OMP_DECK_HOST ?? "127.0.0.1";
const WEB_PORT = Number(process.env.OMP_DECK_WEB_PORT ?? "5173");

const SERVER_HTTP = `http://${SERVER_HOST}:${SERVER_PORT}`;
const SERVER_WS = `ws://${SERVER_HOST}:${SERVER_PORT}`;

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		host: SERVER_HOST,
		port: WEB_PORT,
		proxy: {
			"/api": { target: SERVER_HTTP, changeOrigin: true },
			"/ws": { target: SERVER_WS, ws: true, changeOrigin: true },
		},
	},
	build: {
		outDir: "dist",
		sourcemap: true,
	},
});
