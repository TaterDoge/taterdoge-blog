import PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";
import "@/styles/photoswipe.css";

type ItemData = {
	src: string;
	msrc: string;
	w: number;
	h: number;
	alt: string;
};

// 预加载主模块，避免每次 open 再动态 import（对齐参考项目）
const pswpModule = import("photoswipe");

const CLOSE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#ffffff"><path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z"/></svg>';

const ZOOM_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#ffffff"><path d="M340-540h-40q-17 0-28.5-11.5T260-580q0-17 11.5-28.5T300-620h40v-40q0-17 11.5-28.5T380-700q17 0 28.5 11.5T420-660v40h40q17 0 28.5 11.5T500-580q0 17-11.5 28.5T460-540h-40v40q0 17-11.5 28.5T380-460q-17 0-28.5-11.5T340-500v-40Zm40 220q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l224 224q11 11 11 28t-11 28q-11 11-28 11t-28-11L532-372q-30 24-69 38t-83 14Zm0-80q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/></svg>';

const sizeCache = new WeakMap<HTMLImageElement, ItemData>();

function realSrc(image: HTMLImageElement) {
	return image.dataset.mediaSrc || image.currentSrc || image.src;
}

function settle(
	image: HTMLImageElement,
	src: string,
	w: number,
	h: number,
): ItemData {
	// msrc 必须用真实图，不能用 placeholder，否则打开动画会先按错误比例铺开再跳变
	const data: ItemData = {
		src,
		msrc: src,
		w: w || window.innerWidth,
		h: h || window.innerHeight,
		alt: image.alt,
	};
	sizeCache.set(image, data);
	return data;
}

/** marchen 懒加载下 img.src 可能是 placeholder，需 probe 真实图拿尺寸 */
function resolveLightboxImage(image: HTMLImageElement): Promise<ItemData> {
	const cached = sizeCache.get(image);
	if (cached) return Promise.resolve(cached);

	const src = realSrc(image);
	const showingReal =
		!image.dataset.mediaSrc || image.src === src || image.currentSrc === src;

	if (image.complete && image.naturalWidth > 0 && showingReal) {
		return Promise.resolve(
			settle(image, src, image.naturalWidth, image.naturalHeight),
		);
	}

	return new Promise((resolve) => {
		const probe = new Image();
		probe.onload = () =>
			resolve(settle(image, src, probe.naturalWidth, probe.naturalHeight));
		probe.onerror = () =>
			resolve(settle(image, src, image.naturalWidth, image.naturalHeight));
		probe.src = src;
	});
}

/**
 * 在 root 内绑定 children 图片的 PhotoSwipe 预览。
 * 配置对齐参考项目；返回 cleanup 供 Astro VT 生命周期使用。
 */
export function setupLightbox(root: HTMLElement, children: string): () => void {
	const images = Array.from(root.querySelectorAll(children)).filter(
		(el): el is HTMLImageElement => el instanceof HTMLImageElement,
	);
	if (images.length === 0) return () => {};

	const lightbox = new PhotoSwipeLightbox({
		gallery: root,
		children,
		pswpModule: () => pswpModule,
		closeSVG: CLOSE_SVG,
		zoomSVG: ZOOM_SVG,
		padding: { top: 20, bottom: 20, left: 20, right: 20 },
		wheelToZoom: true,
		arrowPrev: false,
		arrowNext: false,
		imageClickAction: "close",
		tapAction: "close",
		doubleTapAction: "zoom",
	});

	lightbox.addFilter("domItemData", (itemData, element) => {
		if (element instanceof HTMLImageElement) {
			const cached = sizeCache.get(element);
			const src = cached?.src || realSrc(element);
			itemData.src = src;
			itemData.msrc = src;
			itemData.w = Number(
				cached?.w || element.naturalWidth || window.innerWidth,
			);
			itemData.h = Number(
				cached?.h || element.naturalHeight || window.innerHeight,
			);
			itemData.alt = element.alt;
		}
		return itemData;
	});

	// resolveLightboxImage 已把真实图加载进浏览器缓存。直接显示主图，
	// 不再创建 PhotoSwipe 的第二张 placeholder，避免短暂重叠。
	lightbox.addFilter("useContentPlaceholder", () => false);

	lightbox.init();

	const controller = new AbortController();
	// 不传 initialPoint：让 PhotoSwipe 从缩略图 bounds 做开场动画（传 click 坐标会跳）
	const openAt = async (index: number) => {
		const image = images[index];
		if (!image) return;
		await resolveLightboxImage(image);
		lightbox.loadAndOpen(index);
	};

	images.forEach((image, index) => {
		image.tabIndex = 0;
		image.setAttribute("role", "button");
		image.setAttribute(
			"aria-label",
			image.alt ? `${image.alt}，点击查看大图` : "点击查看大图",
		);
		void resolveLightboxImage(image);
		image.addEventListener(
			"click",
			(event) => {
				event.preventDefault();
				event.stopPropagation();
				void openAt(index);
			},
			{ signal: controller.signal },
		);
		image.addEventListener(
			"keydown",
			(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					void openAt(index);
				}
			},
			{ signal: controller.signal },
		);
	});

	return () => {
		controller.abort();
		lightbox.destroy();
	};
}
