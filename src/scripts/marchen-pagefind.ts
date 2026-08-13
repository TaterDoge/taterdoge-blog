import type { PagefindApi } from "@/types/pagefind";

// Pagefind 懒加载：只在首次搜索时动态 import 生产构建生成的索引。
// 由 BaseLayout 引用；dev 环境下 BlogArchive / 搜索面板降级为内存搜索。
function loadMarchenPagefind(): Promise<PagefindApi> {
	if (window.__marchenPagefind)
		return Promise.resolve(window.__marchenPagefind);
	if (window.__marchenPagefindPromise) return window.__marchenPagefindPromise;

	const scriptUrl = `${import.meta.env.BASE_URL}pagefind/pagefind.js`.replace(
		/\/+/g,
		"/",
	);
	window.__marchenPagefindFailed = false;
	window.__marchenPagefindPromise = (async () => {
		try {
			const pagefind = await import(/* @vite-ignore */ scriptUrl);
			await pagefind.options?.({ excerptLength: 20 });
			window.__marchenPagefind = pagefind;
			window.dispatchEvent(new CustomEvent("marchen:pagefindready"));
			return pagefind;
		} catch (error) {
			window.__marchenPagefind = null;
			window.__marchenPagefindPromise = null;
			window.__marchenPagefindFailed = true;
			window.dispatchEvent(new CustomEvent("marchen:pagefindloaderror"));
			throw error;
		}
	})();
	return window.__marchenPagefindPromise;
}
window.__marchenPagefindEnabled = import.meta.env.PROD;
window.__marchenLoadPagefind = loadMarchenPagefind;
