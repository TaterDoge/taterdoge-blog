// 图片懒加载 / reveal / media-shell 逻辑。
// 由 BaseLayout 引用；Solid 岛水合和筛选重建 img 后通过 MutationObserver 兜底。
const marchenPlaceholderSrc = "/images/image-placeholder.svg";

function normalizeMarchenImageUrl(source: string): string {
	if (!source) return "";
	try {
		return new URL(source, window.location.href).href;
	} catch {
		return source;
	}
}

function isMarchenImageSource(
	image: HTMLImageElement,
	source: string,
): boolean {
	const expected = normalizeMarchenImageUrl(source);
	return [image.currentSrc, image.src].some(
		(item) => normalizeMarchenImageUrl(item) === expected,
	);
}

function requestMarchenImageSource(image: HTMLImageElement): void {
	const source = image.dataset.mediaSrc;
	if (!source || image.dataset.noMediaShell === "true") return;

	// Solid 水合/重渲染可能把 src 重置回 placeholder，但 mediaRequested 仍在。
	// 若尚未真正展示 source，允许重新请求。
	if (
		image.dataset.mediaRequested === "true" ||
		image.dataset.mediaRequested === "pending"
	) {
		if (isMarchenImageSource(image, source)) return;
		delete image.dataset.mediaRequested;
	}

	image.dataset.mediaRequested = "pending";
	const delay = Number.parseInt(image.dataset.mediaLoadDelay ?? "90", 10);
	window.setTimeout(
		() => {
			if (
				image.dataset.mediaRequested === "true" &&
				isMarchenImageSource(image, source)
			)
				return;
			image.dataset.mediaRequested = "true";
			image.src = source;
		},
		Math.max(0, Number.isFinite(delay) ? delay : 90),
	);
}

function revealMarchenImage(image: HTMLImageElement): void {
	if (!(image instanceof HTMLImageElement)) return;
	if (image.naturalWidth <= 0) {
		image.dataset.mediaState = "error";
		return;
	}

	const source = image.dataset.mediaSrc || image.currentSrc || image.src;
	if (image.dataset.mediaSrc && !isMarchenImageSource(image, source)) return;
	if (
		!image.dataset.mediaSrc &&
		isMarchenImageSource(image, marchenPlaceholderSrc)
	)
		return;
	if (
		image.dataset.mediaLoadedSrc === source &&
		image.dataset.mediaState === "loaded"
	)
		return;
	if (
		image.dataset.mediaPendingSrc === source ||
		image.dataset.mediaRevealingSrc === source
	)
		return;

	const reveal = () => {
		if (!isMarchenImageSource(image, source)) return;
		delete image.dataset.mediaPendingSrc;
		image.dataset.mediaRevealingSrc = source;
		image.dataset.mediaLoadedSrc = source;

		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			image.dataset.mediaState = "loaded";
			return;
		}

		image.dataset.mediaState = "revealing";
		requestAnimationFrame(() => {
			window.setTimeout(() => {
				if (isMarchenImageSource(image, source)) {
					image.dataset.mediaState = "loaded";
				}
			}, 80);
		});
	};

	const minPlaceholder = Number.parseInt(
		image.dataset.mediaMinPlaceholder ?? (image.dataset.mediaSrc ? "140" : "0"),
		10,
	);
	const startedAt = Number.parseFloat(image.dataset.mediaStartedAt ?? "");
	const elapsed = Number.isFinite(startedAt)
		? performance.now() - startedAt
		: minPlaceholder;
	const delay = Math.max(0, minPlaceholder - elapsed);

	if (delay > 0) {
		image.dataset.mediaPendingSrc = source;
		window.setTimeout(reveal, delay);
	} else {
		reveal();
	}
}

function ensureMarchenImageShell(image: HTMLImageElement): void {
	if (
		!(image instanceof HTMLImageElement) ||
		image.dataset.noMediaShell === "true" ||
		image.closest(".pswp")
	)
		return;
	const parent = image.parentElement;
	if (parent?.classList.contains("media-shell")) return;

	const shell = document.createElement("span");
	shell.className = "media-shell";
	parent?.insertBefore(shell, image);
	shell.append(image);
}

function initMarchenImages(root: ParentNode = document): void {
	root.querySelectorAll("img").forEach((image) => {
		if (!(image instanceof HTMLImageElement) || image.closest(".pswp")) return;
		if (!image.hasAttribute("loading")) image.loading = "lazy";
		image.decoding = "async";
		if (!image.dataset.mediaState) image.dataset.mediaState = "loading";
		if (!image.dataset.mediaStartedAt)
			image.dataset.mediaStartedAt = String(performance.now());
		ensureMarchenImageShell(image);

		const markLoaded = () => {
			if (
				image.dataset.mediaSrc &&
				!isMarchenImageSource(image, image.dataset.mediaSrc)
			)
				return;
			revealMarchenImage(image);
		};

		if (image.dataset.marchenImageReady !== "true") {
			image.dataset.marchenImageReady = "true";
			image.addEventListener("load", markLoaded);
			image.addEventListener("error", () => {
				image.dataset.mediaState = "error";
			});
		}

		if (image.dataset.mediaSrc) {
			requestMarchenImageSource(image);
		} else if (image.complete) {
			markLoaded();
		}
	});
}

window.__marchenRevealImage = revealMarchenImage;
window.__marchenInitImages = initMarchenImages;

// Solid 岛水合/筛选会重建 img；用 observer 只处理 addedNodes 内的图片，
// 避免每次全文档 querySelectorAll 扫描。
let scheduled = false;
const scheduleInit = () => {
	if (scheduled || window.__marchenImageSwapping) return;
	scheduled = true;
	queueMicrotask(() => {
		scheduled = false;
		if (!window.__marchenImageSwapping) initMarchenImages();
	});
};
const observer = new MutationObserver((mutations) => {
	for (const mutation of mutations) {
		for (const node of mutation.addedNodes) {
			if (!(node instanceof Element)) continue;
			if (node instanceof HTMLImageElement || node.querySelector("img")) {
				scheduleInit();
				return;
			}
		}
	}
});
observer.observe(document.documentElement, { childList: true, subtree: true });
window.__marchenImageObserver = observer;

initMarchenImages();

document.addEventListener("astro:before-swap", () => {
	window.__marchenImageSwapping = true;
});
document.addEventListener("astro:after-swap", () => {
	queueMicrotask(() => {
		initMarchenImages();
		queueMicrotask(() => {
			window.__marchenImageSwapping = false;
		});
	});
});
