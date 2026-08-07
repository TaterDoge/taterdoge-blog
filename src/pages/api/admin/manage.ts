import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getSecret } from "astro:env/server";
import { hasPrivateAccess } from "@/lib/private-access";

export const prerender = false;

type ManageKind = "projects" | "tools" | "favorites";

type ManagePayload = {
	kind?: ManageKind;
	items?: Record<string, unknown>[];
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

const targets = {
	projects: {
		path: "src/data/projects.ts",
		exportName: "projects",
		prefix: "export const projects = ",
		commitScope: "projects",
	},
	tools: {
		path: "src/data/tools.ts",
		exportName: "tools",
		prefix: `export type ToolItem = {
  id: string;
  name: string;
  description: string;
  category: "开发工具" | "编码转换" | "文本处理" | "设计辅助" | "AI";
  href: string;
  icon: string;
  featured?: boolean;
  internal?: boolean;
  status?: "ready" | "draft";
};

export const tools: ToolItem[] = `,
		commitScope: "tools",
	},
	favorites: {
		path: "src/data/favorites.ts",
		exportName: "favorites",
		prefix: "export const favorites = ",
		commitScope: "favorites",
	},
} satisfies Record<
	ManageKind,
	{ path: string; exportName: string; prefix: string; commitScope: string }
>;

function json(data: unknown, status = 200) {
	return Response.json(data, {
		status,
		headers: {
			"cache-control": "private, no-store",
		},
	});
}

function getMissingGithubConfig() {
	return Object.entries(githubConfig)
		.filter(([key, value]) => key !== "branch" && !value)
		.map(([key]) => `GITHUB_${key.toUpperCase()}`);
}

function ensureGithubConfig() {
	const missing = getMissingGithubConfig();

	if (missing.length)
		throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

function quote(value: string) {
	return JSON.stringify(value);
}

function serializeValue(value: unknown, indent = 2): string {
	const pad = " ".repeat(indent);
	const childPad = " ".repeat(indent + 2);

	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		if (value.every((item) => typeof item !== "object" || item === null)) {
			return `[${value.map((item) => serializeValue(item, indent)).join(", ")}]`;
		}
		return `[\n${value.map((item) => `${childPad}${serializeValue(item, indent + 2)}`).join(",\n")}\n${pad}]`;
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value).filter(
			([, item]) => item !== undefined && item !== "",
		);
		if (entries.length === 0) return "{}";
		return `{\n${entries.map(([key, item]) => `${childPad}${key}: ${serializeValue(item, indent + 2)},`).join("\n")}\n${pad}}`;
	}

	if (typeof value === "string") return quote(value);
	if (typeof value === "boolean") return String(value);
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return "null";
}

function serializeDataFile(kind: ManageKind, items: Record<string, unknown>[]) {
	const target = targets[kind];
	return `${target.prefix}${serializeValue(items, 0)};\n`;
}

async function getExistingFile(filePath: string) {
	let url: URL;
	try {
		url = new URL(
			`https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${filePath}`,
		);
	} catch {
		throw new Error(`Invalid GitHub contents path: ${filePath}`);
	}
	url.searchParams.set("ref", githubConfig.branch);

	const response = await fetch(url, {
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

async function commitFile(
	filePath: string,
	sha: string,
	content: string,
	message: string,
) {
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
				sha,
			}),
		},
	);

	if (!response.ok)
		throw new Error(
			`GitHub commit failed: ${response.status} ${await response.text()}`,
		);
	return response.json();
}

async function writeLocalDataFile(filePath: string, content: string) {
	const root = path.resolve(process.cwd());
	const target = path.resolve(root, filePath);
	if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
		throw new Error(`Invalid local file path: ${filePath}`);
	}
	await writeFile(target, content, "utf8");
}

export const POST: APIRoute = async ({ cookies, request }) => {
	if (!hasPrivateAccess(cookies)) return json({ error: "Unauthorized." }, 401);

	try {
		const payload = (await request.json()) as ManagePayload;
		const kind = payload.kind;
		if (kind !== "projects" && kind !== "tools" && kind !== "favorites")
			throw new Error("Invalid manage kind.");
		if (!Array.isArray(payload.items))
			throw new Error("Items must be an array.");

		const target = targets[kind];
		const content = serializeDataFile(kind, payload.items);
		const missingGithubConfig = getMissingGithubConfig();
		if (missingGithubConfig.length && import.meta.env.DEV) {
			await writeLocalDataFile(target.path, content);
			return json({
				ok: true,
				path: target.path,
				local: true,
			});
		}

		ensureGithubConfig();
		const current = await getExistingFile(target.path);
		const result = await commitFile(
			target.path,
			current.sha,
			content,
			`content(${target.commitScope}): update order`,
		);

		return json({
			ok: true,
			path: target.path,
			commitUrl: result?.commit?.html_url,
			contentUrl: result?.content?.html_url,
		});
	} catch (error) {
		return json(
			{
				error: error instanceof Error ? error.message : "Manage update failed.",
			},
			400,
		);
	}
};
