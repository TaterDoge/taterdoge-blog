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
		build: {
			// Astro 用 assetsInlineLimit 判定打包脚本是否内联进 HTML；
			// 设为 0 让 marchen-*.ts 等小脚本成为可独立缓存的外部文件，而不是每页重复传输。
			assetsInlineLimit: 0,
		},
	},
});
