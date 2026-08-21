import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import { defineConfig } from "astro/config";
import expressiveCode from "astro-expressive-code";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import solid from "@astrojs/solid-js";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";
import { remarkCodeTabs } from "./src/lib/remark-code-tabs";
import { pluginCustomCopyButton } from "./src/plugins/expressive-code/custom-copy-button";
import { pluginLanguageBadge } from "./src/plugins/expressive-code/language-badge";

export default defineConfig({
	site: "https://marchen.dev",
	adapter: vercel(),
	integrations: [
		expressiveCode({
			// 代码块两种主题下都是深色底（--code-block-bg），light/dark 槽位都用深色主题
			themes: ["github-dark", "github-dark"],
			plugins: [
				pluginCollapsibleSections(),
				pluginLineNumbers(),
				pluginLanguageBadge(),
				pluginCustomCopyButton(),
			],
			defaultProps: {
				wrap: true,
			},
			styleOverrides: {
				codeBackground: "var(--code-block-bg)",
				borderRadius: "0.75rem",
				borderColor: "var(--code-block-border)",
				borderWidth: "1px",
				codeFontSize: "0.875rem",
				codeFontFamily:
					"ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
				codeLineHeight: "1.6",
				frames: {
					editorBackground: "var(--code-block-bg)",
					terminalBackground: "var(--code-block-bg)",
					terminalTitlebarBackground: "var(--code-block-border)",
					editorTabBarBackground: "var(--code-block-border)",
					editorActiveTabBackground: "var(--code-block-bg)",
					editorActiveTabIndicatorBottomColor: "var(--blue)",
					editorActiveTabIndicatorTopColor: "none",
					editorTabBarBorderBottomColor: "var(--code-block-border)",
					terminalTitlebarBorderBottomColor: "none",
				},
				textMarkers: {
					delHue: 0,
					insHue: 180,
					markHue: 250,
				},
			},
			frames: {
				// 自带复制按钮在无标题 frame 上不显示，改用自定义插件统一提供
				showCopyToClipboardButton: false,
			},
		}),
		mdx(),
		sitemap(),
		solid(),
	],
	markdown: {
		// Astro 6.4+：remark/rehype 插件应传给 unified()；
		// remarkCodeTabs 通过 unified 的 remarkPlugins 注册，expressive-code 由集成自动挂到 rehype。
		// （unified 插件替换了旧 markdown.remarkPlugins 写法，避免 deprecation 警告）
		processor: (await import("@astrojs/markdown-remark")).unified({
			remarkPlugins: [remarkCodeTabs],
		}),
	},
	vite: {
		plugins: [tailwindcss()],
		build: {
			// Astro 用 assetsInlineLimit 判定打包脚本是否内联进 HTML；
			// 设为 0 让 marchen-*.ts 等小脚本成为可独立缓存的外部文件，而不是每页重复传输。
			assetsInlineLimit: 0,
		},
	},
});
