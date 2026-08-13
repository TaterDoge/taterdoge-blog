// 站点头部交互：私有导航同步、主题切换、搜索面板、移动导航。
// 由 Header.astro 引用；模块只执行一次，导航/状态同步通过 document 级事件监听完成。

const PRIVATE_NAV_CACHE_MS = 5 * 60 * 1000;
let privateNavCache: { at: number; value: boolean } | null = null;

async function syncPrivateNav(): Promise<void> {
	let hasPrivateAccess = false;
	const now = Date.now();
	if (privateNavCache && now - privateNavCache.at < PRIVATE_NAV_CACHE_MS) {
		hasPrivateAccess = privateNavCache.value;
	} else {
		try {
			const response = await fetch("/api/private/check", {
				cache: "no-store",
				credentials: "same-origin",
			});
			if (response.ok) {
				const data = await response.json();
				hasPrivateAccess = Boolean(data?.enabled);
			}
		} catch {
			hasPrivateAccess = false;
		}
		privateNavCache = { at: now, value: hasPrivateAccess };
	}

	document.querySelectorAll("[data-private-link='true']").forEach((link) => {
		link.classList.toggle("is-visible", hasPrivateAccess);
	});
	document.querySelectorAll("[data-private-action]").forEach((action) => {
		if (action instanceof HTMLElement) action.hidden = !hasPrivateAccess;
	});
}

window.__marchenSyncPrivateNav = syncPrivateNav;
syncPrivateNav();
document.addEventListener("astro:after-swap", () =>
	window.__marchenSyncPrivateNav?.(),
);

function syncThemeToggle(): void {
	const theme =
		document.documentElement.dataset.theme === "dark" ? "dark" : "light";
	document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
		button.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
		button.setAttribute(
			"title",
			theme === "dark" ? "切换浅色模式" : "切换夜间模式",
		);
	});
}

function toggleTheme(): void {
	const nextTheme =
		document.documentElement.dataset.theme === "dark" ? "light" : "dark";
	document.documentElement.dataset.theme = nextTheme;
	localStorage.setItem("marchen_theme", nextTheme);
	syncThemeToggle();
}

window.__marchenSyncThemeToggle = syncThemeToggle;
syncThemeToggle();
document.addEventListener("click", (event) => {
	if (
		event.target instanceof Element &&
		event.target.closest("[data-theme-toggle]")
	) {
		toggleTheme();
	}
});
document.addEventListener("astro:page-load", () =>
	window.__marchenSyncThemeToggle?.(),
);
document.addEventListener("astro:after-swap", () =>
	window.__marchenSyncThemeToggle?.(),
);

function setSearch(open: boolean): void {
	const panel = document.querySelector("[data-search-panel]");
	const input = document.querySelector("[data-search-input]");
	const toggle = document.querySelector("[data-search-toggle]");
	if (!(panel instanceof HTMLDialogElement)) return;

	const restoreFocus =
		!open && panel.open && panel.contains(document.activeElement);
	if (open) {
		setMobileNav(false);
		if (!panel.open) {
			panel.removeAttribute("inert");
			panel.setAttribute("aria-hidden", "false");
			panel.showModal();
		}
		document.documentElement.classList.add("search-open");
		document.querySelectorAll("[data-search-toggle]").forEach((button) => {
			button.setAttribute("aria-expanded", "true");
			button.setAttribute("aria-label", "关闭搜索");
		});
		if (input instanceof HTMLInputElement)
			requestAnimationFrame(() => input.focus());
		if (window.__marchenPagefindEnabled && !window.__marchenPagefind) {
			void window.__marchenLoadPagefind?.().catch(() => {});
		}
		return;
	}

	document.documentElement.classList.remove("search-open");
	if (panel.open) panel.close();
	panel.setAttribute("aria-hidden", "true");
	panel.setAttribute("inert", "");
	document.querySelectorAll("[data-search-toggle]").forEach((button) => {
		button.setAttribute("aria-expanded", "false");
		button.setAttribute("aria-label", "打开搜索");
	});
	if (restoreFocus && toggle instanceof HTMLElement) toggle.focus();
}

async function runSearch(query: string): Promise<void> {
	const status = document.querySelector("[data-search-status]");
	const results = document.querySelector("[data-search-results]");
	if (!(status instanceof HTMLElement) || !(results instanceof HTMLElement))
		return;

	const requestId = String(Number(results.dataset.requestId ?? "0") + 1);
	results.dataset.requestId = requestId;
	const keyword = query.trim();
	if (!keyword) {
		status.textContent = "输入关键词搜索全部文章";
		results.replaceChildren();
		return;
	}

	if (!window.__marchenPagefind) {
		const panel = document.querySelector("[data-search-panel]");
		if (panel?.getAttribute("data-search-production") === "true") {
			status.textContent = window.__marchenPagefindFailed
				? "搜索索引加载失败，请稍后重试"
				: "搜索索引正在加载...";
			void window.__marchenLoadPagefind?.().catch(() => {});
		} else {
			status.textContent = "开发环境没有搜索索引，请运行 bun run build 后预览";
		}
		return;
	}
	status.textContent = "正在搜索...";

	try {
		const response = await window.__marchenPagefind.search(keyword);
		const items = await Promise.all(
			response.results.slice(0, 12).map((item) => item.data()),
		);
		if (results.dataset.requestId !== requestId) return;

		results.replaceChildren(
			...items.map((item) => {
				const row = document.createElement("li");
				row.className = "search-result-item";
				const link = document.createElement("a");
				link.className = "search-result";
				link.href = item.url;

				const title = document.createElement("strong");
				title.textContent = item.meta.title;
				const excerpt = document.createElement("span");
				excerpt.append(sanitizeMarchenExcerpt(item.excerpt));
				link.append(title, excerpt);
				row.append(link);
				return row;
			}),
		);
		status.textContent =
			items.length > 0
				? `找到 ${response.results.length} 条结果${response.results.length > items.length ? `，显示前 ${items.length} 条` : ""}`
				: "没有匹配结果，换个关键词试试";
	} catch {
		if (results.dataset.requestId === requestId) {
			results.replaceChildren();
			status.textContent = "搜索暂时不可用，请稍后重试";
		}
	}
}

window.__marchenRefreshSearch = () => {
	const input = document.querySelector("[data-search-input]");
	if (input instanceof HTMLInputElement && input.value.trim())
		runSearch(input.value);
};

// Pagefind 的 excerpt 是索引生成的片段，含高亮 <mark>；剥离其余标签防 XSS。
function sanitizeMarchenExcerpt(html: string): HTMLElement {
	const doc = new DOMParser().parseFromString(html, "text/html");
	doc.body.querySelectorAll("*:not(mark)").forEach((el) => {
		el.replaceWith(...el.childNodes);
	});
	return doc.body;
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener("click", (event) => {
	if (!(event.target instanceof Element)) return;
	const panel = document.querySelector("[data-search-panel]");
	if (
		panel instanceof HTMLDialogElement &&
		panel.open &&
		event.target === panel
	) {
		setSearch(false);
		return;
	}
	if (event.target.closest("[data-search-toggle]")) {
		setSearch(!document.documentElement.classList.contains("search-open"));
		return;
	}
	if (event.target.closest(".search-result")) setSearch(false);
});
document.addEventListener("input", (event) => {
	const input = event.target;
	if (
		!(input instanceof HTMLInputElement) ||
		!input.matches("[data-search-input]")
	)
		return;
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => runSearch(input.value), 180);
});
window.addEventListener("marchen:pagefindready", () =>
	window.__marchenRefreshSearch?.(),
);
window.addEventListener("marchen:pagefindloaderror", () => {
	window.__marchenPagefindFailed = true;
	const input = document.querySelector("[data-search-input]");
	const status = document.querySelector("[data-search-status]");
	if (
		input instanceof HTMLInputElement &&
		input.value.trim() &&
		status instanceof HTMLElement
	) {
		status.textContent = "搜索索引加载失败，请稍后重试";
	}
});
document.addEventListener(
	"cancel",
	(event) => {
		if (
			event.target instanceof HTMLDialogElement &&
			event.target.matches("[data-search-panel]")
		) {
			event.preventDefault();
			setSearch(false);
		}
	},
	true,
);
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") setSearch(false);
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		setSearch(true);
	}
});
document.addEventListener("astro:before-swap", () => {
	clearTimeout(searchTimer);
	const results = document.querySelector("[data-search-results]");
	if (results instanceof HTMLElement) {
		results.dataset.requestId = String(
			Number(results.dataset.requestId ?? "0") + 1,
		);
	}
	setSearch(false);
});
document.addEventListener("astro:after-swap", () => setSearch(false));

let mobileNavScrollY = 0;

function setMobileNav(open: boolean): void {
	if (open) {
		setSearch(false);
		mobileNavScrollY = window.scrollY;
		document.body.style.position = "fixed";
		document.body.style.top = `-${mobileNavScrollY}px`;
		document.body.style.width = "100%";
	} else if (document.body.style.position === "fixed") {
		document.body.style.position = "";
		document.body.style.top = "";
		document.body.style.width = "";
		window.scrollTo(0, mobileNavScrollY);
	}

	document.documentElement.classList.toggle("nav-open", open);
	document.querySelectorAll("[data-nav-toggle]").forEach((button) => {
		button.setAttribute("aria-expanded", open ? "true" : "false");
		button.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
	});
}

document.addEventListener("click", (event) => {
	if (!(event.target instanceof Element)) return;
	if (event.target.closest("[data-nav-toggle]")) {
		setMobileNav(!document.documentElement.classList.contains("nav-open"));
		return;
	}
	if (
		event.target.closest("[data-nav-backdrop]") ||
		event.target.closest(".nav-links a")
	) {
		setMobileNav(false);
	}
});
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") setMobileNav(false);
});
document.addEventListener("astro:after-swap", () => setMobileNav(false));
