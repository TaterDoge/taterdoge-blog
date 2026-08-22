import { createStore, produce } from "solid-js/store";
import { createSignal, createMemo, For, Show, createEffect } from "solid-js";
import { useDragSort } from "./useDragSort";
import { lucideIconClass } from "@/lib/icons";
import type { ProjectItem } from "@/data/projects";

type TabKind = "projects" | "tools" | "favorites";
type StatusState = "idle" | "loading" | "ok" | "error";

interface FavoriteItem {
	title: string;
	description: string;
	url: string;
	category: string;
	icon: string;
	featured: boolean;
	[key: string]: unknown;
}

interface ToolItem {
	id: string;
	name: string;
	description: string;
	category: string;
	href: string;
	icon: string;
	featured?: boolean;
	internal?: boolean;
	status?: string;
	[key: string]: unknown;
}

interface ManageAppProps {
	initialProjects: ProjectItem[];
	initialTools: ToolItem[];
	initialFavorites: FavoriteItem[];
	initialTab: TabKind;
}

/* ---- utilities ---- */

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

let manageKeySeed = 0;
function assignManageKey<T extends Record<string, unknown>>(
	item: T,
	prefix: string,
): T {
	if (!item || typeof item !== "object") return item;
	if (Object.hasOwn(item, "__manageKey")) return item;
	Object.defineProperty(item, "__manageKey", {
		value: `${prefix}-${manageKeySeed++}`,
		enumerable: false,
		writable: true,
	});
	return item;
}

function shouldShowHomeBadge(
	kind: TabKind,
	item: Record<string, unknown>,
	index: number,
): boolean {
	if (kind === "projects") return index < 3;
	if (kind === "tools") return index < 3;
	if (kind === "favorites") return index < 4;
	return Boolean(item?.featured);
}

function getKey(item: Record<string, unknown>): string {
	return (item as any).__manageKey ?? "";
}

/* ---- shared class strings ---- */

const TAB_BASE =
	"inline-flex items-center justify-center gap-[7px] px-3 py-[7px] rounded-md border font-black cursor-pointer";
const PLAIN_ACTION =
	"inline-flex items-center justify-center gap-[7px] min-h-[36px] px-2.5 py-1.5 rounded-md border border-tag-border bg-tag-bg text-tag-text font-black cursor-pointer";
const PLAIN_ACTION_SMALL =
	"inline-flex items-center justify-center gap-[7px] min-h-[30px] px-2 py-1 rounded-md border border-tag-border bg-tag-bg text-xs text-tag-text font-black cursor-pointer hover:border-blue hover:text-blue";
const SAVE_BTN =
	"button min-h-[38px] border-blue bg-blue px-3.5 py-[7px] text-on-accent shadow-[0_10px_20px_color-mix(in_srgb,var(--blue)_18%,transparent)] hover:bg-[color-mix(in_srgb,var(--blue)_88%,var(--ink))] hover:-translate-y-px disabled:opacity-60 disabled:cursor-wait";
const SORTABLE_ROW_BASE =
	"sortable-row relative grid overflow-hidden grid-cols-[34px_minmax(0,1fr)_auto] gap-3 items-center min-h-[72px] rounded-lg border border-border bg-surface px-3 py-[11px] shadow-soft-card transition-[background,border-color,box-shadow,opacity,transform] duration-[180ms] animate-[manage-row-in_220ms_cubic-bezier(0.2,0.8,0.2,1)_both] hover:border-line-blue hover:bg-[color-mix(in_srgb,var(--blue-soft)_42%,var(--surface))] hover:-translate-y-px max-md:grid-cols-[28px_minmax(0,1fr)]";
const DRAGGING_EXTRA = "opacity-50 rotate-[-0.6deg] scale-[0.985]";
const ITEM_TITLE =
	"block overflow-hidden text-ellipsis whitespace-nowrap text-ink text-[0.98rem] leading-[1.35]";
const ITEM_DESC =
	"block mt-1 text-muted text-[0.84rem] not-italic leading-[1.55] [-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden";
const DROPTARGET_EXTRA =
	"border-blue bg-[color-mix(in_srgb,var(--blue-soft)_68%,var(--surface))] shadow-pop-card -translate-y-1";
const FAV_GROUP_BASE =
	"grid gap-2.5 rounded-lg border border-border bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] p-3 transition-[border-color,background,box-shadow] duration-[180ms] animate-[manage-row-in_240ms_cubic-bezier(0.2,0.8,0.2,1)_both]";
const FAV_GROUP_DROP =
	"border-blue bg-[color-mix(in_srgb,var(--blue-soft)_52%,var(--surface))] shadow-[inset_0_0_0_1px_var(--focus-ring)]";
const CAT_INPUT_BASE =
	"w-[min(360px,100%)] min-h-[34px] rounded-md border border-transparent bg-transparent px-2 py-1 text-ink text-base font-black outline-none";
const CAT_INPUT_EDIT =
	"border-blue bg-surface shadow-[0_0_0_3px_var(--focus-ring)]";
const DIALOG_INPUT =
	"w-full min-w-0 rounded-md border border-border bg-surface px-[11px] py-2.5 text-ink outline-none focus:border-blue focus:shadow-[0_0_0_3px_var(--focus-ring)]";
const VIEW_HEADER =
	"flex items-end justify-between gap-4 border-b-2 border-ink py-1.5 pb-3 max-md:flex-col max-md:items-start";

function viewClass(tab: TabKind, current: TabKind): string {
	return tab === current
		? "grid gap-4 animate-[manage-view-in_240ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
		: "hidden";
}

function statusColor(state: StatusState): string {
	if (state === "ok") return "text-blue";
	if (state === "error") return "text-status-error";
	return "text-muted";
}

/* ---- badge ---- */

function Badge(props: { text: string; home?: boolean }) {
	return (
		<span
			classList={{
				"inline-flex items-center rounded-full border px-[7px] py-0.5 text-2xs font-black whitespace-nowrap": true,
				"border-tag-border bg-blue-soft text-blue": !props.home,
				"border-blue bg-blue text-on-accent": !!props.home,
			}}
		>
			{props.text}
		</span>
	);
}

/* ---- main component ---- */

export default function ManageApp(props: ManageAppProps) {
	const [state, setState] = createStore({
		projects: clone(props.initialProjects).map(
			(item: ProjectItem) =>
				assignManageKey(item as Record<string, unknown>, "project") as ProjectItem,
		),
		tools: clone(props.initialTools).map(
			(item: ToolItem) =>
				assignManageKey(item as Record<string, unknown>, "tool") as ToolItem,
		),
		favorites: clone(props.initialFavorites).map(
			(item: FavoriteItem) =>
				assignManageKey(
					item as Record<string, unknown>,
					"favorite",
				) as FavoriteItem,
		),
		favoriteCategories: Array.from(
			new Set(props.initialFavorites.map((f) => f.category)),
		) as string[],
	});

	const [activeTab, setActiveTab] = createSignal<TabKind>(props.initialTab);
	const [status, setStatus] = createSignal<{
		message: string;
		state: StatusState;
	}>({
		message: "拖动完成后点保存",
		state: "idle",
	});
	const [saving, setSaving] = createSignal("");
	const [dialogTitle, setDialogTitle] = createSignal("添加收藏");
	const [pendingEditCategory, setPendingEditCategory] = createSignal("");

	let appRef: HTMLElement | undefined;
	let dialogRef: HTMLDialogElement | undefined;
	let formRef: HTMLFormElement | undefined;

	/* ---- state helpers ---- */

	const updateStatus = (message: string, st: StatusState = "idle") =>
		setStatus({ message, state: st });

	const setTab = (tab: TabKind) => {
		setActiveTab(tab);
		history.replaceState(null, "", `/admin/manage?tab=${tab}`);
	};

	const ensureFavoriteCategory = (category: string): string => {
		const next = String(category || "").trim();
		if (next && !state.favoriteCategories.includes(next)) {
			setState("favoriteCategories", (prev) => [...prev, next]);
		}
		return next;
	};

	const favoriteInsertIndex = (category: string): number => {
		const items = state.favorites;
		let lastIndex = -1;
		for (let i = 0; i < items.length; i++) {
			if (items[i].category === category) lastIndex = i;
		}
		if (lastIndex >= 0) return lastIndex + 1;
		const categoryPosition = state.favoriteCategories.indexOf(category);
		for (const nextCat of state.favoriteCategories.slice(categoryPosition + 1)) {
			const firstIndex = items.findIndex((item) => item.category === nextCat);
			if (firstIndex >= 0) return firstIndex;
		}
		return items.length;
	};

	const moveItemToIndex = (
		kind: "projects" | "tools",
		from: number,
		rawTarget: number,
	): boolean => {
		const len = (state as any)[kind].length as number;
		if (from < 0 || from >= len) return false;
		const target = Math.max(0, Math.min(rawTarget, len));
		let adjusted = from < target ? target - 1 : target;
		if (from === adjusted) return false;
		setState(
			kind as any,
			produce((items: any[]) => {
				const [item] = items.splice(from, 1);
				adjusted = Math.max(0, Math.min(adjusted, items.length));
				items.splice(adjusted, 0, item);
			}),
		);
		return true;
	};

	const moveFavoriteTo = (
		from: number,
		rawTarget: number,
		category: string,
	): boolean => {
		const len = state.favorites.length;
		if (from < 0 || from >= len) return false;
		const target = Math.max(0, Math.min(rawTarget, len));
		const nextCategory = ensureFavoriteCategory(category);
		const oldCategory = state.favorites[from].category;
		let adjusted = from < target ? target - 1 : target;
		adjusted = Math.max(0, Math.min(adjusted, len - 1));
		if (from === adjusted && oldCategory === nextCategory) return false;
		setState(
			"favorites",
			produce((items: any[]) => {
				const [item] = items.splice(from, 1);
				item.category = nextCategory;
				items.splice(Math.max(0, adjusted), 0, item);
			}),
		);
		return true;
	};

	/* ---- drag hook ---- */

	const drag = useDragSort({
		appRef: () => appRef,
		onMoveItem: (kind, from, to) => moveItemToIndex(kind, from, to),
		onMoveFavorite: (from, to, category) => moveFavoriteTo(from, to, category),
		onChanged: () => updateStatus("顺序已调整，记得保存。"),
	});

	/* ---- dialog ---- */

	const openFavoriteDialog = (index: number = -1) => {
		if (!dialogRef || !formRef) return;
		formRef.reset();
		setDialogTitle(index >= 0 ? "编辑收藏" : "添加收藏");
		const elements = formRef.elements;
		(elements.namedItem("index") as HTMLInputElement).value = String(index);
		if (index >= 0) {
			const item = state.favorites[index];
			(elements.namedItem("title") as HTMLInputElement).value = item.title ?? "";
			(elements.namedItem("description") as HTMLInputElement).value =
				item.description ?? "";
			(elements.namedItem("url") as HTMLInputElement).value = item.url ?? "";
			(elements.namedItem("category") as HTMLInputElement).value =
				item.category ?? "";
			(elements.namedItem("icon") as HTMLInputElement).value = item.icon ?? "";
			(elements.namedItem("featured") as HTMLInputElement).checked = Boolean(
				item.featured,
			);
		}
		dialogRef.showModal();
	};

	const submitFavorite = (e: SubmitEvent) => {
		const submitter = e.submitter as HTMLButtonElement | null;
		if (submitter?.value === "cancel") return;
		e.preventDefault();
		if (!formRef) return;
		const data = new FormData(formRef);
		const index = parseInt(String(data.get("index") || "-1"), 10);
		const item: FavoriteItem = {
			title: String(data.get("title") || "").trim(),
			description: String(data.get("description") || "").trim(),
			url: String(data.get("url") || "").trim(),
			category: ensureFavoriteCategory(String(data.get("category") || "").trim()),
			icon: String(data.get("icon") || "Bookmark").trim() || "Bookmark",
			featured: data.get("featured") === "on",
		};
		if (!item.title || !item.description || !item.url || !item.category) return;

		if (index >= 0 && state.favorites[index]) {
			const existingKey = getKey(state.favorites[index] as any);
			Object.defineProperty(item, "__manageKey", {
				value: existingKey,
				enumerable: false,
				writable: true,
			});
			setState(
				"favorites",
				produce((items: any[]) => {
					Object.assign(items[index], item);
				}),
			);
		} else {
			assignManageKey(item as Record<string, unknown>, "favorite");
			const insertIdx = favoriteInsertIndex(item.category);
			setState(
				"favorites",
				produce((items: any[]) => {
					items.splice(insertIdx, 0, item);
				}),
			);
		}
		dialogRef?.close();
		updateStatus("收藏已更新，记得保存。");
	};

	/* ---- category actions ---- */

	const addCategory = () => {
		const base = "新分类";
		let category = base;
		let count = 2;
		while (state.favoriteCategories.includes(category)) {
			category = `${base} ${count}`;
			count += 1;
		}
		ensureFavoriteCategory(category);
		setPendingEditCategory(category);
		updateStatus("分类已新增，直接输入名称后把收藏拖进去或添加收藏。");
	};

	/* ---- save ---- */

	const save = async (kind: TabKind) => {
		setSaving(kind);
		updateStatus("正在提交到 GitHub...", "loading");
		try {
			const items = JSON.parse(JSON.stringify((state as any)[kind]));
			const response = await fetch("/api/admin/manage", {
				method: "POST",
				headers: { "content-type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({ kind, items }),
			});
			const result = await response.json();
			if (!response.ok || !result?.ok)
				throw new Error(result?.error || "保存失败");
			updateStatus(
				result.local ? `已保存到本地：${result.path}` : `已提交：${result.path}`,
				"ok",
			);
		} catch (error) {
			updateStatus(error instanceof Error ? error.message : "保存失败", "error");
		} finally {
			setSaving("");
		}
	};

	/* ---- render ---- */

	const renderTab = (tab: TabKind, icon: string, label: string) => (
		<button
			class={TAB_BASE}
			classList={{
				"border-blue bg-blue text-on-accent": activeTab() === tab,
				"border-tag-border bg-tag-bg text-tag-text": activeTab() !== tab,
			}}
			type="button"
			onClick={() => setTab(tab)}
		>
			<span class={`${lucideIconClass(icon)} size-[17px]`} />
			{label}
		</button>
	);

	const renderSaveButton = (kind: TabKind, label: string) => (
		<button
			class={SAVE_BTN}
			type="button"
			disabled={saving() === kind}
			onClick={() => save(kind)}
		>
			<span class="icon-[lucide--save] size-[17px]" />
			{label}
		</button>
	);

	const renderSortableRow = (item: Record<string, unknown>, kind: TabKind) => {
		const key = getKey(item);
		const idx = createMemo(() =>
			(state as any)[kind].findIndex((p: any) => getKey(p) === key),
		);
		const isDragging = () => drag.draggingKey() === key;
		const isDropTarget = () => drag.dropTargetKey() === key;
		return (
			<div
				class={SORTABLE_ROW_BASE}
				classList={{
					"is-dragging": isDragging(),
					"is-drop-target": isDropTarget(),
					"cursor-grab": !isDragging(),
					"cursor-grabbing": isDragging(),
					[DRAGGING_EXTRA]: isDragging(),
					[DROPTARGET_EXTRA]: isDropTarget(),
				}}
				draggable={true}
				aria-label="拖动调整顺序"
				onDragStart={(e) => drag.startDrag(kind, idx(), key, "", e)}
				onDragEnd={() => drag.endDrag()}
				onDragOver={(e) => {
					e.preventDefault();
					if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
					drag.overRow(kind, key, idx(), e);
				}}
				onDrop={(e) => {
					e.preventDefault();
					e.stopPropagation();
					drag.commitDrop();
				}}
			>
				<span class="drag-handle" aria-hidden="true" />
				<span class="block min-w-0">
					<strong class={ITEM_TITLE}>{item.name as string}</strong>
					<em class={ITEM_DESC}>{item.description as string}</em>
				</span>
				<span class="inline-flex items-center justify-end gap-1.5 max-md:col-start-2 max-md:justify-start">
					<Badge text={(item.category as string) ?? "未分类"} />
					<Show when={item.status}>
						<Badge text={item.status as string} />
					</Show>
					<Show when={shouldShowHomeBadge(kind, item, idx())}>
						<Badge text="首页" home />
					</Show>
				</span>
			</div>
		);
	};

	const renderSortView = (
		kind: "projects" | "tools",
		title: string,
		desc: string,
		saveLabel: string,
	) => (
		<article class={viewClass(kind, activeTab())}>
			<div class={VIEW_HEADER}>
				<div>
					<h2 class="m-0 text-lg">{title}</h2>
					<p class="mt-1 mb-0 text-sm text-muted">{desc}</p>
				</div>
				{renderSaveButton(kind, saveLabel)}
			</div>
			<div
				class="grid gap-2.5"
				onDragOver={(e) => drag.overListEnd(kind, (state as any)[kind].length, e)}
				onDrop={(e) => {
					e.preventDefault();
					drag.commitDrop();
				}}
			>
				<For each={(state as any)[kind]}>
					{(item: Record<string, unknown>) => renderSortableRow(item, kind)}
				</For>
			</div>
		</article>
	);

	const renderFavoriteRow = (item: FavoriteItem, category: string) => {
		const key = getKey(item as any);
		const globalIndex = createMemo(() =>
			state.favorites.findIndex((p) => getKey(p as any) === key),
		);
		const isDragging = () => drag.draggingKey() === key;
		const isDropTarget = () => drag.dropTargetKey() === key;
		return (
			<div
				class={SORTABLE_ROW_BASE}
				classList={{
					"is-dragging": isDragging(),
					"is-drop-target": isDropTarget(),
					"cursor-grab": !isDragging(),
					"cursor-grabbing": isDragging(),
					[DRAGGING_EXTRA]: isDragging(),
					[DROPTARGET_EXTRA]: isDropTarget(),
				}}
				draggable={true}
				aria-label="拖动调整顺序"
				data-category={category}
				onDragStart={(e) =>
					drag.startDrag("favorites", globalIndex(), key, category, e)
				}
				onDragEnd={() => drag.endDrag()}
				onDragOver={(e) => {
					e.preventDefault();
					if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
					drag.overRow("favorites", key, globalIndex(), e);
				}}
				onDrop={(e) => {
					e.preventDefault();
					e.stopPropagation();
					drag.commitDrop();
				}}
			>
				<span class="drag-handle" aria-hidden="true" />
				<span class="block min-w-0">
					<strong class={ITEM_TITLE}>{item.title}</strong>
					<em class={ITEM_DESC}>{item.description}</em>
				</span>
				<span class="inline-flex items-center justify-end gap-1.5 max-md:col-start-2 max-md:justify-start">
					<Show when={shouldShowHomeBadge("favorites", item as any, globalIndex())}>
						<Badge text="首页" home />
					</Show>
					<button
						class={PLAIN_ACTION_SMALL}
						type="button"
						onClick={() => openFavoriteDialog(globalIndex())}
					>
						编辑
					</button>
				</span>
			</div>
		);
	};

	const renderFavoriteGroup = (category: string) => {
		let catInputRef: HTMLInputElement | undefined;
		let listRef: HTMLDivElement | undefined;
		const [isEditing, setIsEditing] = createSignal(false);
		const [draft, setDraft] = createSignal(category);

		createEffect(() => {
			if (pendingEditCategory() === category && catInputRef) {
				setIsEditing(true);
				setPendingEditCategory("");
				catInputRef.focus();
				catInputRef.select();
			}
		});

		const applyRename = () => {
			const next = draft().trim();
			setDraft(next || category);
			setIsEditing(false);
			if (!next || next === category) return;
			setState(
				"favorites",
				produce((items: any[]) => {
					items.forEach((item) => {
						if (item.category === category) item.category = next;
					});
				}),
			);
			setState("favoriteCategories", (prev: string[]) =>
				prev.map((c) => (c === category ? next : c)),
			);
			updateStatus("分类已修改，记得保存。");
		};

		const cancelRename = () => {
			setDraft(category);
			setIsEditing(false);
		};

		const groupFavorites = createMemo(() =>
			state.favorites.filter((item) => item.category === category),
		);

		return (
			<section
				class={FAV_GROUP_BASE}
				classList={{
					[FAV_GROUP_DROP]: drag.dropTargetCategory() === category,
				}}
				onDragEnter={() => drag.enterGroup(category)}
				onDragLeave={() => drag.leaveGroup()}
				onDragOver={(e) => {
					if (listRef)
						drag.overGroupEnd(category, listRef, favoriteInsertIndex(category), e);
				}}
				onDrop={(e) => {
					e.preventDefault();
					drag.commitDrop();
				}}
			>
				<div class="flex items-center justify-between gap-3 max-md:flex-col max-md:items-start">
					<label class="block min-w-0">
						<input
							ref={catInputRef}
							class={CAT_INPUT_BASE}
							classList={{ [CAT_INPUT_EDIT]: isEditing() }}
							value={isEditing() ? draft() : category}
							readOnly={!isEditing()}
							aria-label="收藏分类名称"
							onInput={(e) => setDraft(e.currentTarget.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									applyRename();
								}
								if (e.key === "Escape") cancelRename();
							}}
							onBlur={applyRename}
						/>
					</label>
					<button
						class={PLAIN_ACTION_SMALL}
						type="button"
						onClick={() => {
							setDraft(category);
							setIsEditing(true);
							queueMicrotask(() => {
								catInputRef?.focus();
								catInputRef?.select();
							});
						}}
					>
						编辑
					</button>
				</div>
				<div ref={listRef} class="favorite-group-list grid gap-2.5">
					<For
						each={groupFavorites()}
						fallback={
							<p class="m-0 border border-dashed border-border rounded-lg bg-surface-soft p-3.5 text-muted text-sm">
								把收藏拖到这里，或新增收藏时选择这个分类。
							</p>
						}
					>
						{(item: FavoriteItem) => renderFavoriteRow(item, category)}
					</For>
				</div>
			</section>
		);
	};

	return (
		<>
			<section
				ref={appRef}
				class="manage-panel relative mx-auto grid w-full max-w-[980px] gap-4 rounded-lg border border-border bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] p-5 shadow-soft-card"
			>
				<div
					class="inline-flex justify-self-center gap-2 border-b border-border-soft px-2 pb-2.5"
					role="tablist"
					aria-label="管理类型"
				>
					{renderTab("projects", "rocket", "项目")}
					{renderTab("tools", "wrench", "工具")}
					{renderTab("favorites", "bookmark", "收藏")}
				</div>

				{renderSortView(
					"projects",
					"项目顺序",
					"首页会按这里的项目顺序展示前几个项目。",
					"保存项目",
				)}
				{renderSortView(
					"tools",
					"工具顺序",
					"工具箱和首页常用工具都会沿用这份数据顺序。",
					"保存工具",
				)}

				<article class={viewClass("favorites", activeTab())}>
					<div class={VIEW_HEADER}>
						<div>
							<h2 class="m-0 text-lg">收藏顺序</h2>
							<p class="mt-1 mb-0 text-sm text-muted">
								收藏可以拖到不同分类里，也可以在弹窗中新增或编辑分类。
							</p>
						</div>
						<div class="flex flex-wrap justify-end gap-2.5">
							<button class={PLAIN_ACTION} type="button" onClick={addCategory}>
								<span class="icon-[lucide--folder-plus] size-[17px]" />
								新增分类
							</button>
							<button
								class={PLAIN_ACTION}
								type="button"
								onClick={() => openFavoriteDialog()}
							>
								<span class="icon-[lucide--plus] size-[17px]" />
								添加收藏
							</button>
							{renderSaveButton("favorites", "保存收藏")}
						</div>
					</div>
					<div class="grid gap-2.5">
						<For each={state.favoriteCategories}>
							{(category: string) => renderFavoriteGroup(category)}
						</For>
					</div>
				</article>

				<output
					class={`min-h-6 text-sm font-extrabold ${statusColor(status().state)}`}
				>
					{status().message}
				</output>
			</section>

			<dialog
				ref={dialogRef}
				class="favorite-dialog w-[min(620px,calc(100vw-28px))] rounded-lg border border-border-strong bg-surface text-ink p-0 shadow-pop-card"
			>
				<form
					ref={formRef}
					class="grid gap-3.5 p-4"
					method="dialog"
					onSubmit={submitFavorite}
				>
					<div class="flex items-center justify-between gap-3.5 border-b border-border-soft pb-2.5">
						<h2 class="m-0 text-lg">{dialogTitle()}</h2>
						<button
							class="inline-flex items-center justify-center size-9 p-0 rounded-md border border-tag-border bg-tag-bg text-tag-text font-black cursor-pointer"
							value="cancel"
							type="submit"
							aria-label="关闭"
						>
							<span class="icon-[lucide--x] size-[18px]" />
						</button>
					</div>

					<input name="index" type="hidden" />
					<label class="grid min-w-0 gap-2 font-black">
						<span class="text-sm">标题</span>
						<input name="title" required class={DIALOG_INPUT} />
					</label>
					<label class="grid min-w-0 gap-2 font-black">
						<span class="text-sm">描述</span>
						<input name="description" required class={DIALOG_INPUT} />
					</label>
					<label class="grid min-w-0 gap-2 font-black">
						<span class="text-sm">链接</span>
						<input name="url" required type="url" class={DIALOG_INPUT} />
					</label>
					<div class="grid gap-3.5 max-md:grid-cols-1 min-md:grid-cols-2">
						<label class="grid min-w-0 gap-2 font-black">
							<span class="text-sm">分类</span>
							<input
								name="category"
								list="favorite-categories"
								required
								class={DIALOG_INPUT}
							/>
							<datalist id="favorite-categories">
								<For each={state.favoriteCategories}>
									{(category: string) => <option value={category} />}
								</For>
							</datalist>
						</label>
						<label class="grid min-w-0 gap-2 font-black">
							<span class="text-sm">图标</span>
							<input
								name="icon"
								placeholder="Rocket / BookOpen / Github"
								class={DIALOG_INPUT}
							/>
						</label>
					</div>
					<label class="inline-flex w-fit items-center gap-2 font-black">
						<input class="w-auto" name="featured" type="checkbox" />
						<span class="text-sm">首页展示</span>
					</label>

					<div class="flex justify-end gap-2.5 border-t border-border-soft pt-3">
						<button class={PLAIN_ACTION} value="cancel" type="submit">
							取消
						</button>
						<button class="button" value="default" type="submit">
							保存
						</button>
					</div>
				</form>
			</dialog>

			<style>{`
        .sortable-row::before {
          position: absolute;
          inset: 10px auto 10px 0;
          width: 3px;
          border-radius: 0 999px 999px 0;
          background: var(--blue);
          content: "";
          opacity: 0;
          transform: scaleY(0.35);
          transition: opacity 180ms ease-out, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .sortable-row:hover::before,
        .sortable-row.is-drop-target::before {
          opacity: 1;
          transform: scaleY(1);
        }
        .drag-handle {
          position: relative;
          display: grid;
          width: 34px;
          height: 42px;
          place-items: center;
          border: 1px solid var(--tag-border);
          border-radius: 6px;
          background: var(--blue-soft);
          color: var(--blue);
        }
        .drag-handle::before {
          width: 14px;
          height: 12px;
          background:
            linear-gradient(currentColor 0 0) 0 0 / 14px 2px no-repeat,
            linear-gradient(currentColor 0 0) 0 5px / 14px 2px no-repeat,
            linear-gradient(currentColor 0 0) 0 10px / 14px 2px no-repeat;
          content: "";
        }
        .drop-marker {
          pointer-events: none;
          position: absolute;
          z-index: 20;
          height: 0;
          border-radius: 999px;
          transform: translateY(-50%);
          transition: top 90ms linear, left 90ms linear, width 90ms linear;
        }
        .drop-marker::before {
          position: absolute;
          left: 42px;
          right: 12px;
          top: 50%;
          height: 3px;
          border-radius: 999px;
          background: var(--blue);
          box-shadow: 0 0 0 4px var(--focus-ring);
          content: "";
          transform: translateY(-50%);
        }
        .drop-marker::after {
          position: absolute;
          left: 32px;
          top: 50%;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--blue);
          content: "";
          transform: translateY(-50%);
        }
        .favorite-dialog::backdrop {
          background: rgba(23, 35, 59, 0.28);
        }
        @keyframes manage-view-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes manage-row-in {
          from { opacity: 0; transform: translateY(7px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
		</>
	);
}
