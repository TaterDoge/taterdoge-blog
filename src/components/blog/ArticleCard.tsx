interface ArticleCardProps {
	href: string;
	title: string;
	description: string;
	pubDate: string;
	tags: string[];
	cover?: string;
	readingMinutes: number;
	featured?: boolean;
}

export default function ArticleCard(props: ArticleCardProps) {
	const dateLabel = new Date(props.pubDate).toLocaleDateString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
	});

	return (
		<a
			class="post-item is-visible grid items-stretch gap-4 border-b border-border-soft px-1 py-3.5 text-inherit transition-[background,color,transform] duration-fast ease-out first:border-t first:border-t-border-soft hover:translate-x-0.5 hover:text-blue max-sm:grid-cols-[92px_minmax(0,1fr)] max-sm:gap-3"
			classList={{
				"grid-cols-[184px_minmax(0,1fr)]": !!props.featured,
				"grid-cols-[124px_minmax(0,1fr)]": !props.featured,
			}}
			href={props.href}
			data-astro-prefetch="hover"
			aria-label={`阅读：${props.title}`}
		>
			<span class="block min-w-0 [&_.media-shell]:w-full [&_.media-shell]:rounded-md">
				<span class="media-shell">
					<img
						class="w-full rounded-md border border-border object-cover bg-paper-soft max-sm:h-[78px]"
						classList={{
							"h-[132px]": !!props.featured,
							"h-[92px]": !props.featured,
						}}
						src="/images/image-placeholder.svg"
						data-media-src={props.cover}
						alt=""
						loading="lazy"
					/>
				</span>
			</span>
			<div class="grid min-w-0 content-center text-ink">
				<div class="flex flex-wrap items-center gap-2 text-xs font-extrabold text-muted">
					<time datetime={props.pubDate}>{dateLabel}</time>
					<span class="inline-flex items-center gap-2">
						<span class="icon--lucide--clock3 size-[14px]" />{" "}
						{props.readingMinutes} 分钟
					</span>
				</div>
				<h3
					class="mt-1 mb-1 leading-snug tracking-normal text-ink max-sm:text-base"
					classList={{
						"text-xl": !!props.featured,
						"text-base": !props.featured,
					}}
				>
					{props.title}
				</h3>
				<p class="m-0 line-clamp-2 text-sm leading-relaxed text-muted">
					{props.description}
				</p>
				<div class="bottom-line mt-2.5 flex flex-wrap items-center justify-between gap-3">
					<div class="flex flex-wrap items-center gap-2 max-sm:hidden">
						{props.tags.slice(0, 3).map((tag) => (
							<span class="tag">#{tag}</span>
						))}
					</div>
					<span class="inline-flex items-center gap-2 whitespace-nowrap text-sm font-black text-blue">
						阅读全文 <span class="icon--lucide--arrow-right size-[15px]" />
					</span>
				</div>
			</div>
		</a>
	);
}
