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
  const date = new Date(props.pubDate);
  const dateLabel = date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return (
    <a
      class="post-item h-44 is-visible flex items-stretch gap-4 border-b border-border-soft px-1 py-3.5 text-inherit transition-[background,color,transform] duration-fast ease-out first:border-t first:border-t-border-soft hover:translate-x-0.5 hover:text-blue max-sm:grid-cols-[minmax(0,1fr)_92px] max-sm:gap-3"
      href={props.href}
      data-astro-prefetch="hover"
      aria-label={`阅读：${props.title}`}
    >
      <div class="flex flex-col flex-1 min-w-0 content-center text-ink">
        {/* Title */}
        <div class="flex items-center gap-2">
          <div class="w-1 h-4 bg-blue rounded-full" />
          <h3
            class={`leading-snug tracking-normal text-ink max-sm:text-base ${props.featured ? "text-xl" : "text-base"}`}
          >
            {props.title}
          </h3>
        </div>

        {/* Tags */}
        <div class="mt-2 flex flex-wrap items-center gap-2 max-sm:hidden">
          {props.tags.slice(0, 3).map((tag) => (
            <span class="tag">#{tag}</span>
          ))}
        </div>

        <p class="m-0 line-clamp-2 mt-1 text-sm leading-relaxed text-muted">
          {props.description}
        </p>

        <div class="flex mt-auto flex-wrap items-center gap-2 text-xs font-extrabold text-muted">
          <time datetime={date.toISOString()}>{dateLabel}</time>
          <span class="inline-flex items-center gap-2">
            <span class="icon-[lucide--clock-3] size-[14px]" />
            {props.readingMinutes} 分钟
          </span>
        </div>
      </div>

      {props.cover ? (
        <span class="group w-[200px] relative flex min-w-0 overflow-hidden rounded-md [&_.media-shell]:w-full [&_.media-shell]:rounded-md">
          <div class="pointer-events-none absolute inset-0 z-10 bg-black/30 opacity-0 transition group-hover:opacity-100" />
          <div class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <span class="icon-[lucide--chevron-right] font-bold size-10 text-white opacity-0 transition scale-50 group-hover:scale-100 group-hover:opacity-100" />
          </div>
          <img
            class="h-full w-full rounded-md border border-border object-cover bg-paper-soft"
            src="/images/image-placeholder.svg"
            data-media-src={props.cover}
            alt=""
            loading="lazy"
          />
        </span>
      ) : (
        <span
          class="flex w-10 min-w-0 items-center justify-center rounded-md bg-blue-soft transition-colors duration-fast hover:bg-blue/15"
          aria-hidden="true"
        >
          <span class="icon-[lucide--chevron-right] size-6 text-blue" />
        </span>
      )}
    </a>
  );
}
