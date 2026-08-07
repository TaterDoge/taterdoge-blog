import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import { getSecret } from "astro:env/server";
import { hasPrivateAccess } from "@/lib/private-access";

export const prerender = false;

type PublishType = "blog" | "note" | "project";

type PublishPayload = {
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

function readGithubSecret(key: string) {
	const value = getSecret(key);
	return value && value.length ? value : "";
}

const githubConfig = {
	token: readGithubSecret("GITHUB_TOKEN"),
	owner: readGithubSecret("GITHUB_OWNER"),
	repo: readGithubSecret("GITHUB_REPO"),
	branch: readGithubSecret("GITHUB_BRANCH") || "main",
};

function json(data: unknown, status = 200) {
	return Response.json(data, {
		status,
		headers: {
			"cache-control": "private, no-store",
		},
	});
}

function ensureGithubConfig() {
	const missing = Object.entries(githubConfig)
		.filter(([key, value]) => key !== "branch" && !value)
		.map(([key]) => `GITHUB_${key.toUpperCase()}`);

	if (missing.length) {
		throw new Error(`Missing environment variables: ${missing.join(", ")}`);
	}
}

function toList(value: string[] | string | undefined) {
	if (Array.isArray(value))
		return value.map((item) => item.trim()).filter(Boolean);
	if (!value) return [];
	return value
		.split(/[\n,，]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

/** 保留中文可读目录名；仅去掉文件系统非法字符 */
function cleanDirName(value: string | undefined, fallback: string) {
	const name = (value || fallback)
		.trim()
		.replace(/[/\\:*?"<>|]+/g, "")
		.replace(/\s+/g, " ")
		.slice(0, 80)
		.trim();

	return name || fallback;
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

function frontmatter(
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

function projectObject(payload: PublishPayload) {
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

function buildMarkdown(payload: PublishPayload) {
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

	if (type === "blog") {
		const description = payload.description?.trim();
		const category = payload.category?.trim();
		if (!description)
			throw new Error("Description is required for blog posts.");
		if (!category) throw new Error("Category is required for blog posts.");

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

function githubContentsUrl(filePath: string) {
	try {
		const url = new URL(
			`https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${filePath}`,
		);
		url.searchParams.set("ref", githubConfig.branch);
		return url;
	} catch {
		throw new Error(`Invalid GitHub contents path: ${filePath}`);
	}
}

async function getExistingSha(filePath: string) {
	const response = await fetch(githubContentsUrl(filePath), {
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${githubConfig.token}`,
			"x-github-api-version": "2022-11-28",
		},
	});

	if (response.status === 404) return undefined;
	if (!response.ok)
		throw new Error(
			`GitHub read failed: ${response.status} ${await response.text()}`,
		);

	const data = await response.json();
	return typeof data?.sha === "string" ? data.sha : undefined;
}

async function getExistingFile(filePath: string) {
	const response = await fetch(githubContentsUrl(filePath), {
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${githubConfig.token}`,
			"x-github-api-version": "2022-11-28",
		},
	});

	if (!response.ok)
		throw new Error(
			`GitHub read failed: ${response.status} ${await response.text()}`,
		);

	const data = await response.json();
	const encoded =
		typeof data?.content === "string" ? data.content.replace(/\s/g, "") : "";
	if (!encoded || typeof data?.sha !== "string")
		throw new Error(`GitHub file payload is invalid: ${filePath}`);

	return {
		sha: data.sha as string,
		content: Buffer.from(encoded, "base64").toString("utf8"),
	};
}

async function commitFile(filePath: string, content: string, message: string) {
	const sha = await getExistingSha(filePath);
	const response = await fetch(
		`https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${filePath}`,
		{
			method: "PUT",
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${githubConfig.token}`,
				"content-type": "application/json",
				"x-github-api-version": "2022-11-28",
			},
			body: JSON.stringify({
				message,
				content: Buffer.from(content, "utf8").toString("base64"),
				branch: githubConfig.branch,
				...(sha ? { sha } : {}),
			}),
		},
	);

	if (!response.ok)
		throw new Error(
			`GitHub commit failed: ${response.status} ${await response.text()}`,
		);
	return response.json();
}

async function publishProject(payload: PublishPayload) {
	const filePath = "src/data/projects.ts";
	const current = await getExistingFile(filePath);
	const nextProject = projectObject(payload);
	const nextContent = current.content.replace(
		/\r?\n\];\s*$/,
		`\n${nextProject}\n];\n`,
	);

	if (nextContent === current.content) {
		throw new Error(
			"Unable to locate projects array ending in src/data/projects.ts.",
		);
	}

	const response = await fetch(
		`https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${filePath}`,
		{
			method: "PUT",
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${githubConfig.token}`,
				"content-type": "application/json",
				"x-github-api-version": "2022-11-28",
			},
			body: JSON.stringify({
				message: `content(projects): add ${payload.title?.trim() || "project"}`,
				content: Buffer.from(nextContent, "utf8").toString("base64"),
				branch: githubConfig.branch,
				sha: current.sha,
			}),
		},
	);

	if (!response.ok)
		throw new Error(
			`GitHub commit failed: ${response.status} ${await response.text()}`,
		);
	return response.json();
}

export const POST: APIRoute = async ({ cookies, request }) => {
	if (!hasPrivateAccess(cookies)) {
		return json({ error: "Unauthorized." }, 401);
	}

	try {
		ensureGithubConfig();
		const payload = (await request.json()) as PublishPayload;
		if (payload.type === "project") {
			const result = await publishProject(payload);
			return json({
				ok: true,
				path: "src/data/projects.ts",
				commitUrl: result?.commit?.html_url,
				contentUrl: result?.content?.html_url,
			});
		}

		const file = buildMarkdown(payload);
		const result = await commitFile(file.filePath, file.content, file.message);

		return json({
			ok: true,
			path: file.filePath,
			commitUrl: result?.commit?.html_url,
			contentUrl: result?.content?.html_url,
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : "Publish failed." },
			400,
		);
	}
};
