// 背景装饰：短/中/长页面档位 + 鼠标 parallax（尊重 prefers-reduced-motion）。
// 由 BaseLayout 引用；只在 .site-decor 存在时生效。
function initMarchenDecor(): void {
	const decor = document.querySelector(".site-decor");
	const stage = document.querySelector(".site-main");
	if (!(decor instanceof HTMLElement) || !(stage instanceof HTMLElement))
		return;

	window.__marchenDecorAbort?.abort();
	const controller = new AbortController();
	window.__marchenDecorAbort = controller;

	const updateRange = () => {
		const height = Math.max(
			stage.scrollHeight,
			stage.getBoundingClientRect().height,
		);
		decor.dataset.decorRange =
			height < 1400 ? "short" : height < 2050 ? "medium" : "full";
	};

	updateRange();
	const observer = new ResizeObserver(updateRange);
	observer.observe(stage);
	controller.signal.addEventListener("abort", () => observer.disconnect(), {
		once: true,
	});

	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

	const items = Array.from(
		decor.querySelectorAll("[data-site-parallax]"),
	).filter((item) => item instanceof HTMLElement);
	let currentX = 0;
	let currentY = 0;
	let targetX = 0;
	let targetY = 0;
	const parallaxScale = 0.42;
	let raf = 0;

	const paint = () => {
		currentX += (targetX - currentX) * 0.1;
		currentY += (targetY - currentY) * 0.1;

		items.forEach((item) => {
			if (!(item instanceof HTMLElement)) return;
			const depth = Number.parseFloat(item.dataset.siteParallax ?? "6");
			item.style.setProperty(
				"--px",
				`${(currentX * depth * parallaxScale).toFixed(2)}px`,
			);
			item.style.setProperty(
				"--py",
				`${(currentY * depth * parallaxScale).toFixed(2)}px`,
			);
		});

		if (
			Math.abs(targetX - currentX) > 0.002 ||
			Math.abs(targetY - currentY) > 0.002
		) {
			raf = window.requestAnimationFrame(paint);
		} else {
			raf = 0;
		}
	};

	const schedule = () => {
		if (!raf) raf = window.requestAnimationFrame(paint);
	};

	stage.addEventListener(
		"pointermove",
		(event) => {
			targetX = (event.clientX / window.innerWidth - 0.5) * 2;
			targetY = (event.clientY / window.innerHeight - 0.5) * 2;
			schedule();
		},
		{ signal: controller.signal },
	);

	stage.addEventListener(
		"pointerleave",
		() => {
			targetX = 0;
			targetY = 0;
			schedule();
		},
		{ signal: controller.signal },
	);
}

initMarchenDecor();
document.addEventListener("astro:after-swap", initMarchenDecor);
