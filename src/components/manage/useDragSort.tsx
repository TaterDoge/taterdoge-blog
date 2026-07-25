import { createSignal } from "solid-js";

export type DragKind = "projects" | "tools" | "favorites";

interface DragStateValue {
	kind: DragKind;
	index: number;
	category: string;
}

interface DropTargetValue {
	kind: DragKind;
	index: number;
	category: string;
}

export interface UseDragSortOptions {
	appRef: () => HTMLElement | undefined;
	onMoveItem: (kind: "projects" | "tools", from: number, to: number) => boolean;
	onMoveFavorite: (from: number, to: number, category: string) => boolean;
	onChanged: () => void;
}

export function useDragSort(opts: UseDragSortOptions) {
	let dragState: DragStateValue | null = null;
	let dropTarget: DropTargetValue | null = null;
	let dropMarker: HTMLDivElement | undefined;

	const [draggingKey, setDraggingKey] = createSignal("");
	const [dropTargetKey, setDropTargetKey] = createSignal("");
	const [dropTargetCategory, setDropTargetCategory] = createSignal("");

	const ensureMarker = (): HTMLDivElement => {
		if (!dropMarker) {
			dropMarker = document.createElement("div");
			dropMarker.className = "drop-marker";
		}
		return dropMarker;
	};

	const clearDropState = () => {
		const marker = ensureMarker();
		marker.remove();
		dropTarget = null;
		setDropTargetKey("");
		setDropTargetCategory("");
	};

	const positionDropMarker = (container: HTMLElement, viewportY: number) => {
		const app = opts.appRef();
		if (!app) return;
		const marker = ensureMarker();
		const appRect = app.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		if (!marker.parentElement) app.append(marker);
		marker.style.left = `${containerRect.left - appRect.left}px`;
		marker.style.top = `${viewportY - appRect.top}px`;
		marker.style.width = `${containerRect.width}px`;
	};

	const startDrag = (
		kind: DragKind,
		index: number,
		key: string,
		category: string,
		event: DragEvent,
	) => {
		dragState = { kind, index, category };
		setDraggingKey(key);
		event.dataTransfer?.setData("text/plain", `${kind}:${index}`);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
	};

	const endDrag = () => {
		dragState = null;
		setDraggingKey("");
		clearDropState();
	};

	const overRow = (
		kind: DragKind,
		key: string,
		index: number,
		event: DragEvent,
	) => {
		if (!dragState || dragState.kind !== kind) return;
		if (index < 0) return;
		const row = event.currentTarget as HTMLElement;
		const rect = row.getBoundingClientRect();
		const after = event.clientY > rect.top + rect.height / 2;
		const parent = row.parentElement;
		if (!(parent instanceof HTMLElement)) return;
		const targetIndex = index + (after ? 1 : 0);
		positionDropMarker(parent, after ? rect.bottom : rect.top);
		dropTarget = {
			kind,
			index: targetIndex,
			category: row.dataset.category ?? "",
		};
		setDropTargetKey(key);
		setDropTargetCategory("");
	};

	const overListEnd = (
		kind: "projects" | "tools",
		count: number,
		event: DragEvent,
	) => {
		event.preventDefault();
		if (!dragState || dragState.kind !== kind) return;
		if (
			event.target instanceof Element &&
			event.target.closest(".sortable-row")
		)
			return;
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
		const list = event.currentTarget as HTMLElement;
		positionDropMarker(list, list.getBoundingClientRect().bottom);
		dropTarget = { kind, index: count, category: "" };
		setDropTargetKey("");
		setDropTargetCategory("");
	};

	const overGroupEnd = (
		category: string,
		list: HTMLElement,
		insertIndex: number,
		event: DragEvent,
	) => {
		event.preventDefault();
		if (!dragState || dragState.kind !== "favorites") return;
		if (
			event.target instanceof Element &&
			event.target.closest(".sortable-row")
		)
			return;
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
		positionDropMarker(list, list.getBoundingClientRect().bottom);
		dropTarget = { kind: "favorites", index: insertIndex, category };
		setDropTargetKey("");
		setDropTargetCategory(category);
	};

	const commitDrop = () => {
		if (!dragState || !dropTarget || dragState.kind !== dropTarget.kind) {
			clearDropState();
			return;
		}
		let changed = false;
		if (dragState.kind === "projects" || dragState.kind === "tools") {
			changed = opts.onMoveItem(
				dragState.kind,
				dragState.index,
				dropTarget.index,
			);
		} else if (dragState.kind === "favorites") {
			changed = opts.onMoveFavorite(
				dragState.index,
				dropTarget.index,
				dropTarget.category,
			);
		}
		if (changed) opts.onChanged();
		clearDropState();
	};

	const enterGroup = (category: string) => {
		if (dragState?.kind === "favorites") setDropTargetCategory(category);
	};

	const leaveGroup = () => {
		setDropTargetCategory("");
	};

	return {
		draggingKey,
		dropTargetKey,
		dropTargetCategory,
		startDrag,
		endDrag,
		overRow,
		overListEnd,
		overGroupEnd,
		commitDrop,
		enterGroup,
		leaveGroup,
	};
}
