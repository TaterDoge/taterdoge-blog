import { onMount, onCleanup } from "solid-js";

const POSITION_KEY = "marchen_music_player_bottom_v3";
const STATE_KEY = "marchen_music_player_collapsed_v1";
const DEFAULT_BOTTOM = 96;
const PLAYLIST_LIST_HEIGHT = 168;

interface DragState {
	pointerId: number;
	startY: number;
	startBottom: number;
	moved: boolean;
}

/**
 * 无 UI 的纯逻辑组件：通过 querySelector 接管 data-music-player 容器，
 * 承载拖拽、折叠、iframe postMessage 通信。
 * 用 client:only="solid-js" 挂载，避免与 transition:persist 的 SSR hydration 冲突。
 */
export default function MusicPlayerControls() {
	let controller: AbortController | undefined;
	let dragState: DragState | null = null;

	const clamp = (value: number, min: number, max: number) =>
		Math.min(Math.max(value, min), max);

	onMount(() => {
		const player = document.querySelector<HTMLElement>("[data-music-player]");
		if (!player) return;

		// 清理上一次的监听（view transition persist 场景下可能已存在实例）
		(window as any).__marchenMusicAbort?.abort();
		controller = new AbortController();
		(window as any).__marchenMusicAbort = controller;
		const opts = { signal: controller.signal };

		const toggle = player.querySelector<HTMLElement>("[data-music-toggle]");
		const dragHandle = player.querySelector<HTMLElement>(
			"[data-music-drag-handle]",
		);
		const frame = player.querySelector<HTMLIFrameElement>("[data-music-frame]");
		const loadFrame = () => {
			if (!(frame instanceof HTMLIFrameElement) || frame.hasAttribute("src"))
				return;
			const src = frame.dataset.src;
			if (src) frame.src = src;
		};
		const getFrameWindow = () =>
			frame instanceof HTMLIFrameElement ? frame.contentWindow : null;

		const getBaseFrameHeight = () =>
			window.matchMedia("(max-width: 760px)").matches ? 76 : 84;

		const syncMusicHeight = () => {
			const nextFrameHeight =
				getBaseFrameHeight() +
				(player.dataset.playlistExpanded === "true" ? PLAYLIST_LIST_HEIGHT : 0);
			player.style.setProperty("--music-frame-height", `${nextFrameHeight}px`);
			player.style.setProperty(
				"--music-shell-height",
				`${nextFrameHeight + 24}px`,
			);
			player.style.setProperty(
				"--music-expanded-height",
				`${nextFrameHeight + 26}px`,
			);
		};

		const getStableHeight = () => {
			syncMusicHeight();
			const expandedHeight =
				Number.parseFloat(
					player.style.getPropertyValue("--music-expanded-height"),
				) || 132;
			return Math.min(
				player.classList.contains("is-collapsed") ? 46 : expandedHeight,
				window.innerHeight - 16,
			);
		};

		const getMaxBottom = () =>
			Math.max(8, window.innerHeight - getStableHeight() - 8);

		const readStoredBottom = () => {
			const stored = Number.parseFloat(
				localStorage.getItem(POSITION_KEY) || "",
			);
			return Number.isFinite(stored) ? stored : DEFAULT_BOTTOM;
		};

		const applyMusicPosition = (bottom = readStoredBottom()) => {
			const next = clamp(bottom, 8, getMaxBottom());
			player.style.setProperty("--music-y", `${next}px`);
			return next;
		};

		const persistMusicPosition = (bottom = readStoredBottom()) => {
			localStorage.setItem(POSITION_KEY, String(applyMusicPosition(bottom)));
		};

		const getCurrentBottom = () => {
			const rect = player.getBoundingClientRect();
			return clamp(window.innerHeight - rect.bottom, 8, getMaxBottom());
		};

		const setCollapsed = (collapsed: boolean) => {
			if (!collapsed) loadFrame();
			player.classList.toggle("is-collapsed", collapsed);
			localStorage.setItem(STATE_KEY, collapsed ? "true" : "false");
			toggle?.setAttribute("aria-expanded", collapsed ? "false" : "true");
			applyMusicPosition();
		};

		// ---- 初始化 ----
		const storedCollapsed = localStorage.getItem(STATE_KEY);
		player.dataset.playlistExpanded = "false";
		syncMusicHeight();
		setCollapsed(storedCollapsed === null ? true : storedCollapsed === "true");
		persistMusicPosition();

		// ---- 折叠/展开 ----
		toggle?.addEventListener(
			"click",
			() => {
				if (player.dataset.dragging === "true") return;
				setCollapsed(!player.classList.contains("is-collapsed"));
				persistMusicPosition();
			},
			opts,
		);

		// ---- 拖拽 ----
		const startDrag = (event: PointerEvent) => {
			if (!(event.currentTarget instanceof HTMLElement)) return;
			dragState = {
				pointerId: event.pointerId,
				startY: event.clientY,
				startBottom: getCurrentBottom(),
				moved: false,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
			player.dataset.dragging = "false";
		};

		const moveDrag = (event: PointerEvent) => {
			if (!dragState || dragState.pointerId !== event.pointerId) return;
			const delta = dragState.startY - event.clientY;
			if (Math.abs(delta) > 3) dragState.moved = true;
			if (!dragState.moved) return;

			player.dataset.dragging = "true";
			applyMusicPosition(dragState.startBottom + delta);
		};

		const finishDrag = (event: PointerEvent) => {
			if (!dragState || dragState.pointerId !== event.pointerId) return;
			if (dragState.moved) {
				persistMusicPosition(getCurrentBottom());
				window.setTimeout(() => {
					player.dataset.dragging = "false";
				}, 0);
			} else {
				player.dataset.dragging = "false";
			}
			dragState = null;
		};

		[toggle, dragHandle].forEach((handle) => {
			if (!handle) return;
			handle.addEventListener("pointerdown", startDrag, opts);
			handle.addEventListener("pointermove", moveDrag, opts);
			handle.addEventListener("pointerup", finishDrag, opts);
			handle.addEventListener("pointercancel", finishDrag, opts);
		});

		// ---- iframe postMessage ----
		window.addEventListener(
			"message",
			(event: MessageEvent) => {
				if (
					event.origin !== window.location.origin ||
					event.source !== getFrameWindow()
				)
					return;
				const data = event.data;
				if (
					!data ||
					typeof data !== "object" ||
					data.type !== "marchen-music-playlist"
				)
					return;

				player.dataset.playlistExpanded = data.expanded ? "true" : "false";
				syncMusicHeight();
				applyMusicPosition();
			},
			opts,
		);

		// ---- resize + view transitions ----
		window.addEventListener(
			"resize",
			() => {
				syncMusicHeight();
				persistMusicPosition();
			},
			opts,
		);
		document.addEventListener(
			"astro:before-swap",
			() => applyMusicPosition(),
			opts,
		);
		document.addEventListener(
			"astro:after-swap",
			() => applyMusicPosition(),
			opts,
		);
	});

	onCleanup(() => {
		controller?.abort();
		controller = undefined;
		(window as any).__marchenMusicAbort = undefined;
	});

	return null;
}
