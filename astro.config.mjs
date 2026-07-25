import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import solid from "@astrojs/solid-js";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	site: "https://marchen.dev",
	adapter: vercel(),
	integrations: [mdx(), sitemap(), solid()],
	vite: {
		plugins: [tailwindcss()],
	},
});
