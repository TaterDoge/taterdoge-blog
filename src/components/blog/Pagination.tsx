import { For, Show, createMemo } from "solid-js";

interface PaginationProps {
	currentPage: number;
	totalPages: number;
	onChange: (page: number) => void;
}

const HIDDEN = -1;

// 省略号窗口：1 … l..r … last，最多展示 5 个页码
const pageWindow = (cur: number, last: number): number[] => {
	const ADJ_DIST = 2;
	const VISIBLE = ADJ_DIST * 2 + 1;
	let count = 1;
	let l = cur;
	let r = cur;
	while (0 < l - 1 && r + 1 <= last && count + 2 <= VISIBLE) {
		count += 2;
		l--;
		r++;
	}
	while (0 < l - 1 && count < VISIBLE) {
		count++;
		l--;
	}
	while (r + 1 <= last && count < VISIBLE) {
		count++;
		r++;
	}
	const pages: number[] = [];
	if (l > 1) pages.push(1);
	if (l === 3) pages.push(2);
	if (l > 3) pages.push(HIDDEN);
	for (let i = l; i <= r; i++) pages.push(i);
	if (r < last - 2) pages.push(HIDDEN);
	if (r === last - 2) pages.push(last - 1);
	if (r < last) pages.push(last);
	return pages;
};

export default function Pagination(props: PaginationProps) {
	const pages = createMemo(() =>
		pageWindow(props.currentPage, props.totalPages),
	);

	return (
		<Show when={props.totalPages > 1}>
			<nav class="pager mt-7" aria-label="分页">
				<button
					type="button"
					class="tag"
					aria-label="上一页"
					disabled={props.currentPage === 1}
					onClick={() => props.onChange(Math.max(1, props.currentPage - 1))}
				>
					<span class="icon-[lucide--chevron-left] size-4" />
				</button>
				<For each={pages()}>
					{(p) =>
						p === HIDDEN ? (
							<span class="pager-dots" aria-hidden="true">
								…
							</span>
						) : (
							<button
								type="button"
								class="tag"
								classList={{ active: p === props.currentPage }}
								aria-current={p === props.currentPage ? "page" : undefined}
								aria-label={`第 ${p} 页`}
								onClick={() => props.onChange(p)}
							>
								{p}
							</button>
						)
					}
				</For>
				<button
					type="button"
					class="tag"
					aria-label="下一页"
					disabled={props.currentPage === props.totalPages}
					onClick={() =>
						props.onChange(Math.min(props.totalPages, props.currentPage + 1))
					}
				>
					<span class="icon-[lucide--chevron-right] size-4" />
				</button>
			</nav>
		</Show>
	);
}
