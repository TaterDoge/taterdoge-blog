// 发布内容的 Markdown/TS 序列化纯函数（/admin/publish 与 /admin/manage 使用）。
// 目录名/文件名合法性规则集中在 ./content-rules（check-content.ts 同源引用）；
// 内容 schema 真相源为 src/content.config.ts，字段变更需与两边对齐。
import { cleanDirName } from "./content-rules";

export { cleanDirName };

export type PublishType = "blog" | "note" | "project";

export type PublishPayload = {
	type?: PublishType;
	slug?: string;
	title?: string;
	description?: string;
	category?: string;
	mood?: string;
	techStack?: string[] | string;
	tags?: string[] | string;
	visibility?: "public" | "private";
	draft?: boolean;
	cover?: string;
	syncToKb?: boolean;
	images?: string[] | string;
	github?: string;
	demo?: string;
	status?: string;
	featured?: boolean;
	body?: string;
	pubDate?: string;
};

export function toList(value: string[] | string | undefined) {
	if (Array.isArray(value))
		return value.map((item) => item.trim()).filter(Boolean);
	if (!value) return [];
	return value
		.split(/[\n,，]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function timestampSlug() {
	return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function yamlString(value: string) {
	return JSON.stringify(value);
}

function yamlArray(values: string[]) {
	return `[${values.map((value) => yamlString(value)).join(", ")}]`;
}

export function frontmatter(
	lines: Array<[string, string | boolean | string[] | undefined]>,
) {
	const content = lines
		.filter(([, value]) => value !== undefined && value !== "")
		.map(([key, value]) => {
			if (Array.isArray(value)) return `${key}: ${yamlArray(value)}`;
			if (typeof value === "boolean") return `${key}: ${value}`;
			return `${key}: ${yamlString(String(value))}`;
		})
		.join("\n");

	return `---\n${content}\n---`;
}

function tsString(value: string) {
	return JSON.stringify(value);
}

function tsArray(values: string[]) {
	return `[${values.map((value) => tsString(value)).join(", ")}]`;
}

export function projectObject(payload: PublishPayload) {
	const name = payload.title?.trim();
	const description = payload.description?.trim();
	const category = payload.category?.trim();
	const github = payload.github?.trim();
	const demo = payload.demo?.trim() || "#";
	const cover = payload.cover?.trim() || "/images/project-default.svg";
	const techStack = toList(payload.techStack);
	const tags = toList(payload.tags);
	const status = payload.status?.trim() || "维护中";

	if (!name) throw new Error("Project name is required.");
	if (!description) throw new Error("Project description is required.");
	if (!category) throw new Error("Project category is required.");
	if (!github) throw new Error("Project GitHub URL is required.");

	const lines = [
		"  {",
		`    name: ${tsString(name)},`,
		`    description: ${tsString(description)},`,
		`    techStack: ${tsArray(techStack.length ? techStack : tags)},`,
		`    tags: ${tsArray(tags.length ? tags : techStack)},`,
		`    category: ${tsString(category)},`,
		`    cover: ${tsString(cover)},`,
		`    github: ${tsString(github)},`,
		`    demo: ${tsString(demo)},`,
		`    status: ${tsString(status)},`,
		`    featured: ${Boolean(payload.featured)},`,
		"  },",
	];

	return lines.join("\n");
}

export function buildMarkdown(payload: PublishPayload) {
	const type = payload.type;
	const title = payload.title?.trim();
	const body = payload.body?.trim();
	const visibility = payload.visibility === "private" ? "private" : "public";
	const pubDate = payload.pubDate?.trim() || new Date().toISOString();
	const tags = toList(payload.tags);

	if (type !== "blog" && type !== "note")
		throw new Error("Invalid publish type.");
	if (!title) throw new Error("Title is required.");
	if (!body) throw new Error("Body is required.");

	// 与 content.config.ts 的 z.coerce.date() 对齐：非法日期会在部署时挂掉构建
	if (Number.isNaN(new Date(pubDate).getTime())) {
		throw new Error(`Invalid pubDate: ${pubDate}`);
	}

	if (type === "blog") {
		const description = payload.description?.trim();
		const category = payload.category?.trim();
		if (!description) throw new Error("Description is required for blog posts.");
		if (!category) throw new Error("Category is required for blog posts.");

		// cover 走 content schema 的 image()，只接受本地相对路径（如 ./cover.png）
		const cover = payload.cover?.trim();
		if (cover && /^https?:\/\//i.test(cover)) {
			throw new Error(
				"Cover must be a local image path relative to the post directory (e.g. ./cover.png).",
			);
		}
		const categoryDir = cleanDirName(category, "未分类");
		const slug = cleanDirName(payload.slug || title, `文章-${timestampSlug()}`);
		const filePath = `src/content/blog/${categoryDir}/${slug}/index.md`;
		const header = frontmatter([
			["title", title],
			["description", description],
			["pubDate", pubDate],
			["tags", tags],
			["category", category],
			["draft", Boolean(payload.draft)],
			["cover", payload.cover?.trim()],
			["syncToKb", Boolean(payload.syncToKb)],
			["visibility", visibility],
		]);

		return {
			filePath,
			content: `${header}\n\n${body}\n`,
			message: `content(blog): publish ${categoryDir}/${slug}`,
		};
	}

	const slug = cleanDirName(payload.slug || title, `碎念-${timestampSlug()}`);
	const filePath = `src/content/notes/${slug}.md`;
	const header = frontmatter([
		["title", title],
		["pubDate", pubDate],
		["mood", payload.mood?.trim()],
		["tags", tags],
		["visibility", visibility],
		["images", toList(payload.images)],
	]);

	return {
		filePath,
		content: `${header}\n\n${body}\n`,
		message: `content(notes): publish ${slug}`,
	};
}
