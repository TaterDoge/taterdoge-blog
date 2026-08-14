import {
	createSignal,
	createMemo,
	For,
	Show,
	createEffect,
	onCleanup,
} from "solid-js";
import ArticleCard from "./ArticleCard";
import Pagination from "./Pagination";
import type { PagefindSearchResult } from "@/types/pagefind";

interface PostData {
	id: string;
	title: string;
	description: string;
	pubDate: string;
	tags: string[];
	category: string;
	cover?: string;
	readingMinutes: number;
	search: string;
}

interface BlogArchiveProps {
	posts: PostData[];
	tags: string[];
	tagCounts: Record<string, number>;
	categories: string[];
	categoryCounts: Record<string, number>;
	totalCount: number;
	totalMinutes: number;
	initialPage?: number;
}

interface PagefindHit {
	url: string;
	title: string;
	excerpt: string;
}

const TAG_BASE = "tag";

const PER_PAGE = 10;

export default function BlogArchive(props: BlogArchiveProps) {
	const [query, setQuery] = createSignal("");
	const [activeTag, setActiveTag] = createSignal("all");
	const [activeCategory, setActiveCategory] = createSignal("all");
	const [page, setPage] = createSignal(props.initialPage ?? 1);

	// Pagefind 运行时（生产构建后由 BaseLayout 注入 window.__marchenPagefind）
	const [pagefindReady, setPagefindReady] = createSignal(
		typeof window !== "undefined" && !!window.__marchenPagefind,
	);
	const [pagefindHits, setPagefindHits] = createSignal<PagefindHit[] | null>(
		null,
	);

	if (typeof window !== "undefined") {
		const onReady = () => setPagefindReady(true);
		window.addEventListener("marchen:pagefindready", onReady);
		onCleanup(() =>
			window.removeEventListener("marchen:pagefindready", onReady),
		);
	}

	const normalizedQuery = createMemo(() => query().trim().toLocaleLowerCase());

	createEffect(() => {
		if (
			typeof window !== "undefined" &&
			normalizedQuery() &&
			window.__marchenPagefindEnabled
		) {
			void window.__marchenLoadPagefind?.().catch(() => {});
		}
	});

	// 有 Pagefind 且有关键词 → 走全文搜索；否则内存兜底（分类/标签过滤仍在客户端）
	createEffect(() => {
		const q = normalizedQuery();
		const pf = typeof window !== "undefined" ? window.__marchenPagefind : null;
		if (!pagefindReady() || !pf || !q) {
			setPagefindHits(null);
			return;
		}

		let cancelled = false;
		void (async () => {
			const response = await pf.search(q);
			if (cancelled || !response) return;
			const hits = await Promise.all(
				response.results.map(async (item) => {
					const data: PagefindSearchResult = await item.data();
					return {
						url: data.url,
						title: data.meta.title,
						excerpt: data.excerpt,
					};
				}),
			);
			if (!cancelled) setPagefindHits(hits);
		})();

		onCleanup(() => {
			cancelled = true;
		});
	});

	// Pagefind 命中的 URL 集合，用于把全文结果映射回本地 post 列表
	const pagefindUrls = createMemo(() => {
		const hits = pagefindHits();
		if (!hits) return null;
		return new Set(
			hits.map((hit) =>
				hit.url.replace(/\/index\.html$/, "/").replace(/\.html$/, ""),
			),
		);
	});

	const matchesQuery = (post: PostData) => {
		const q = normalizedQuery();
		if (!q) return true;
		const urls = pagefindUrls();
		if (urls) {
			// Pagefind URL 形如 /blog/xxx/；post 无扩展名，做前缀归一
			const path = `/blog/${post.id}`.replace(/\/$/, "");
			return Array.from(urls).some((url) => url.replace(/\/$/, "") === path);
		}
		return post.search.includes(q);
	};

	const baseFiltered = createMemo(() =>
		props.posts.filter((post) => {
			const matchCategory =
				activeCategory() === "all" || post.category === activeCategory();
			return matchesQuery(post) && matchCategory;
		}),
	);

	const availableTags = createMemo(() => {
		const counts = new Map<string, number>();
		baseFiltered().forEach((post) =>
			post.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)),
		);
		return counts;
	});

	const filteredPosts = createMemo(() => {
		const tag = activeTag();
		if (tag === "all") return baseFiltered();
		return baseFiltered().filter((post) => post.tags.includes(tag));
	});

	// 搜索/标签/分类变化时回到第一页（首次运行跳过，保留 URL 带来的 initialPage）
	createEffect((prev) => {
		const posts = filteredPosts();
		if (prev) setPage(1);
		return posts;
	}, undefined);

	// 分页同步到 URL：第 1 页为 /blog，其余为 /blog/{page}，刷新后仍停留在当前页
	createEffect(() => {
		const p = page();
		if (typeof window === "undefined") return;
		const url = p > 1 ? `/blog/${p}` : "/blog";
		if (window.location.pathname !== url) {
			history.replaceState(null, "", url);
		}
	});

	const totalPages = createMemo(() =>
		Math.max(1, Math.ceil(filteredPosts().length / PER_PAGE)),
	);

	const pagedPosts = createMemo(() => {
		const all = filteredPosts();
		const start = (page() - 1) * PER_PAGE;
		return all.slice(start, start + PER_PAGE);
	});

	// activeTag 不在可用标签中时自动重置
	const currentTag = createMemo(() => {
		const tag = activeTag();
		if (tag !== "all" && !availableTags().has(tag)) return "all";
		return tag;
	});

	// 筛选重建 img 时，BaseLayout 的 MutationObserver 会捕获 addedNodes 并重新初始化。

	return (
		<section class="archive-layout grid grid-cols-[minmax(0,1fr)_260px] items-start gap-7 max-lg:grid-cols-1">
			<main class="min-w-0">
				<section
					id="search"
					class="search-line grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 border-b border-border-soft py-2.5"
				>
					<span class="icon-[lucide--search] size-[19px] text-muted" />
					<input
						class="min-w-0 w-full border-0 bg-transparent text-ink outline-0"
						type="search"
						placeholder="搜索文章、关键字..."
						aria-label="搜索文章"
						onInput={(e) => setQuery(e.currentTarget.value)}
					/>
				</section>

				<div
					class="tag-row mb-3 mt-3.5 flex flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-2"
					aria-label="文章标签"
				>
					<button
						class={TAG_BASE}
						classList={{ active: currentTag() === "all" }}
						type="button"
						onClick={() => setActiveTag("all")}
					>
						全部 <span>{baseFiltered().length}</span>
					</button>
					<For each={props.tags}>
						{(tag) => (
							<Show when={(availableTags().get(tag) ?? 0) > 0}>
								<button
									class={TAG_BASE}
									classList={{ active: currentTag() === tag }}
									type="button"
									onClick={() => setActiveTag(tag)}
								>
									#{tag} <span>{availableTags().get(tag)}</span>
								</button>
							</Show>
						)}
					</For>
				</div>

				<section class="grid" aria-live="polite">
					<For
						each={pagedPosts()}
						fallback={
							<p class="empty-state mt-4 rounded-lg border border-dashed border-border-strong p-4 text-center text-sm text-muted">
								没有匹配到文章，换个关键词试试
							</p>
						}
					>
						{(post, index) => (
							<div
								class="post-item is-visible"
								style={{ "--filter-index": String(index()) }}
							>
								<ArticleCard
									href={`/blog/${post.id}`}
									title={post.title}
									description={post.description}
									pubDate={post.pubDate}
									tags={post.tags}
									cover={post.cover}
									readingMinutes={post.readingMinutes}
									featured={page() === 1 && index() === 0}
								/>
							</div>
						)}
					</For>
				</section>

				<Pagination
					currentPage={page()}
					totalPages={totalPages()}
					onChange={setPage}
				/>
			</main>

			<aside class="sticky top-[94px] grid gap-5 max-lg:static max-lg:order-first max-lg:grid-cols-2 max-xs:grid-cols-1">
				<section class="border-b border-border-soft py-4">
					<h2 class="aside-title">归档概览</h2>
					<dl class="m-0 grid gap-2">
						<div class="flex justify-between gap-2.5 text-sm text-muted">
							<dt class="m-0">文章</dt>
							<dd class="m-0 font-black text-blue">{props.totalCount}</dd>
						</div>
						<div class="flex justify-between gap-2.5 text-sm text-muted">
							<dt class="m-0">分类</dt>
							<dd class="m-0 font-black text-blue">
								{props.categories.length}
							</dd>
						</div>
						<div class="flex justify-between gap-2.5 text-sm text-muted">
							<dt class="m-0">阅读</dt>
							<dd class="m-0 font-black text-blue">
								{props.totalMinutes} 分钟
							</dd>
						</div>
					</dl>
				</section>

				<section class="border-b border-border-soft py-4">
					<h2 class="aside-title">分类</h2>
					<div class="category-list grid gap-2.5">
						<button
							type="button"
							classList={{ active: activeCategory() === "all" }}
							onClick={() => setActiveCategory("all")}
						>
							<b>全部文章</b>
							<em>{props.totalCount}</em>
						</button>
						<For each={props.categories}>
							{(category) => (
								<button
									type="button"
									classList={{ active: activeCategory() === category }}
									onClick={() => setActiveCategory(category)}
								>
									<b>{category}</b>
									<em>{props.categoryCounts[category] ?? 0}</em>
								</button>
							)}
						</For>
					</div>
				</section>
			</aside>
		</section>
	);
}
