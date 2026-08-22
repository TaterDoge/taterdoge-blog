import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { lucideIconClass } from "@/lib/icons";
import JsonTool from "./JsonTool";
import TimestampTool from "./TimestampTool";
import Base64Tool from "./Base64Tool";
import UrlTool from "./UrlTool";
import UuidTool from "./UuidTool";
import HashTool from "./HashTool";
import TextStatsTool from "./TextStatsTool";
import RegexTool from "./RegexTool";
import ColorsTool from "./ColorsTool";
import JwtTool from "./JwtTool";
import CodeFormatterTool from "./CodeFormatterTool";
import QrCodeTool from "./QrCodeTool";
import CronParserTool from "./CronParserTool";
import ImageConvertTool from "./ImageConvertTool";
import Base64ImageTool from "./Base64ImageTool";
import ColorConverterTool from "./ColorConverterTool";
import DiffTool from "./DiffTool";

interface ToolMeta {
	id: string;
	name: string;
	description: string;
	category: string;
	icon: string;
	status?: string;
}

interface ToolsWorkbenchProps {
	tools: ToolMeta[];
	categories: string[];
	readyCount: number;
	siteName: string;
}

/** 工具 id → 面板组件；未注册的 id 显示"开发中"占位 */
const TOOL_PANELS: Record<string, (siteName: string) => JSX.Element> = {
	json: (siteName) => (
		<JsonTool
			defaultValue={JSON.stringify({
				name: siteName,
				tools: ["format", "diff", "qr"],
			})}
		/>
	),
	timestamp: () => <TimestampTool />,
	base64: (siteName) => <Base64Tool defaultValue={siteName} />,
	url: () => (
		<UrlTool defaultValue="https://marchen.dev/search?q=个人站&tag=工具" />
	),
	uuid: () => <UuidTool />,
	hash: (siteName) => <HashTool defaultValue={siteName} />,
	"text-stats": () => (
		<TextStatsTool defaultValue="把一段文字贴进来，看看它大概需要读多久" />
	),
	regex: (siteName) => (
		<RegexTool
			defaultValue={`${siteName} writes code and notes.`}
			siteName={siteName}
		/>
	),
	colors: () => <ColorsTool />,
	"jwt-decoder": () => <JwtTool />,
	"code-formatter": () => <CodeFormatterTool />,
	"qrcode-generator": () => <QrCodeTool />,
	"cron-parser": () => <CronParserTool />,
	"image-convert": () => <ImageConvertTool />,
	"base64-image": () => <Base64ImageTool />,
	"color-converter": () => <ColorConverterTool />,
	"diff-tool": () => <DiffTool />,
};

function toolHead(icon: string, title: string, desc: string) {
	return (
		<div class="tool-panel-head">
			<span class={`tool-panel-icon ${lucideIconClass(icon)}`} />
			<div>
				<h2>{title}</h2>
				<p>{desc}</p>
			</div>
		</div>
	);
}

export default function ToolsWorkbench(props: ToolsWorkbenchProps) {
	const [activeTool, setActiveTool] = createSignal("");
	const [searchQuery, setSearchQuery] = createSignal("");
	const [activeFilter, setActiveFilter] = createSignal("all");

	const filteredTools = createMemo(() => {
		const keyword = searchQuery().trim().toLowerCase();
		return props.tools.filter((tool) => {
			const matchCategory =
				activeFilter() === "all" || tool.category === activeFilter();
			const matchSearch =
				!keyword ||
				`${tool.name} ${tool.description} ${tool.category}`
					.toLowerCase()
					.includes(keyword);
			return matchCategory && matchSearch;
		});
	});

	const openTool = (id: string, shouldPushHash = true) => {
		const exists = props.tools.some((t) => t.id === id);
		const targetId = exists ? id : "json";
		setActiveTool(targetId);
		if (shouldPushHash) history.replaceState(null, "", `#${targetId}`);
	};

	const onCardClick = (event: MouseEvent, id: string) => {
		event.preventDefault();
		openTool(id);
		requestAnimationFrame(() => {
			const title = document.querySelector(".sidebar-head h2");
			const header = document.querySelector("[data-site-header]");
			if (!(title instanceof HTMLElement)) return;
			const headerHeight = header instanceof HTMLElement ? header.offsetHeight : 0;
			const targetTop =
				title.getBoundingClientRect().top + window.scrollY - headerHeight - 10;
			window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
		});
	};

	onMount(() => {
		const hashId = decodeURIComponent(location.hash.replace("#", ""));
		if (hashId && props.tools.some((t) => t.id === hashId))
			openTool(hashId, false);
		else openTool(props.tools[0]?.id ?? "json", false);
	});

	const renderPanel = (tool: ToolMeta) => {
		const isActive = () => activeTool() === tool.id;
		return (
			<article
				id={tool.id}
				class="tool-panel"
				classList={{ "is-active": isActive() }}
				aria-hidden={!isActive()}
				inert={!isActive()}
			>
				<Show when={isActive()}>
					{toolHead(tool.icon, tool.name, tool.description)}
					<Show
						when={TOOL_PANELS[tool.id]}
						fallback={
							<div class="grid place-items-center py-20 text-muted">
								<p>{tool.name} 功能开发中</p>
							</div>
						}
					>
						{TOOL_PANELS[tool.id]?.(props.siteName)}
					</Show>
				</Show>
			</article>
		);
	};

	return (
		<div class="tools-workbench">
			{/* sidebar */}
			<section id="tool-index" class="tool-sidebar">
				<div class="sidebar-head">
					<div>
						<h2 class="m-0 text-lg">工具清单</h2>
						<p class="mt-0.5 mb-0 text-xs font-black uppercase text-muted">
							{props.tools.length} items
						</p>
					</div>
					<label class="tool-search">
						<span class="icon-[lucide--search] size-4 text-muted" />
						<input
							type="search"
							placeholder="搜索工具"
							aria-label="搜索工具"
							value={searchQuery()}
							onInput={(e) => setSearchQuery(e.currentTarget.value)}
						/>
					</label>
				</div>

				<div
					class="filter-row flex flex-wrap items-center gap-2"
					aria-label="工具分类筛选"
				>
					<button
						class="filter-button"
						classList={{ "is-active": activeFilter() === "all" }}
						type="button"
						onClick={() => setActiveFilter("all")}
					>
						全部
					</button>
					<For each={props.categories}>
						{(category) => (
							<button
								class="filter-button"
								classList={{ "is-active": activeFilter() === category }}
								type="button"
								onClick={() => setActiveFilter(category)}
							>
								{category}
							</button>
						)}
					</For>
				</div>

				<div class="tool-list">
					<For each={filteredTools()}>
						{(tool) => (
							<a
								class="tool-card"
								classList={{
									"is-active": activeTool() === tool.id,
									"is-draft": tool.status === "draft",
								}}
								href={`#${tool.id}`}
								aria-current={activeTool() === tool.id ? "true" : "false"}
								onClick={(e) => onCardClick(e, tool.id)}
							>
								<span class="tool-icon">
									<span class={`${lucideIconClass(tool.icon)} size-[19px]`} />
								</span>
								<span class="tool-copy">
									<span class="tool-title">
										<strong>{tool.name}</strong>
										<small>{tool.status === "draft" ? "草稿" : tool.category}</small>
									</span>
									<em>{tool.description}</em>
								</span>
							</a>
						)}
					</For>
				</div>

				<Show when={filteredTools().length === 0}>
					<p class="empty-state m-0 text-sm text-muted">没有匹配的工具</p>
				</Show>
			</section>

			{/* tool stage */}
			<section class="tool-stage" aria-live="polite">
				<For each={props.tools}>{(tool) => renderPanel(tool)}</For>
			</section>
		</div>
	);
}
