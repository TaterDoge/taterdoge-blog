// GitHub Contents API 客户端（/admin/publish 与 /admin/manage 共用）。
// 404 语义：getGithubFile 返回 undefined（文件不存在）→ 调用方决定抛错或新建；
// getExistingSha 将 404 归一为 undefined，commitGithubFile 在 sha 缺失时不带 sha（新建文件）。
import { Buffer } from "node:buffer";
import { getSecret } from "astro:env/server";

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

export function json(data: unknown, status = 200) {
	return Response.json(data, {
		status,
		headers: {
			"cache-control": "private, no-store",
		},
	});
}

export function getMissingGithubConfig() {
	return Object.entries(githubConfig)
		.filter(([key, value]) => key !== "branch" && !value)
		.map(([key]) => `GITHUB_${key.toUpperCase()}`);
}

export function ensureGithubConfig() {
	const missing = getMissingGithubConfig();

	if (missing.length)
		throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

const githubHeaders = {
	accept: "application/vnd.github+json",
	authorization: `Bearer ${githubConfig.token}`,
	"x-github-api-version": "2022-11-28",
};

function githubContentsUrl(filePath: string) {
	try {
		return new URL(
			`https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${filePath}`,
		);
	} catch {
		throw new Error(`Invalid GitHub contents path: ${filePath}`);
	}
}

export async function getGithubFile(filePath: string) {
	const url = githubContentsUrl(filePath);
	url.searchParams.set("ref", githubConfig.branch);

	const response = await fetch(url, {
		headers: githubHeaders,
	});

	if (response.status === 404) return undefined;
	if (!response.ok)
		throw new Error(
			`GitHub read failed: ${response.status} ${await response.text()}`,
		);

	const data = (await response.json()) as {
		content?: string;
		sha?: string;
	};
	const encoded =
		typeof data.content === "string" ? data.content.replace(/\s/g, "") : "";
	if (!encoded || typeof data.sha !== "string")
		throw new Error(`GitHub file payload is invalid: ${filePath}`);

	return {
		sha: data.sha,
		content: Buffer.from(encoded, "base64").toString("utf8"),
	};
}

export async function getExistingSha(filePath: string) {
	const file = await getGithubFile(filePath);
	return file?.sha;
}

export async function commitGithubFile(
	filePath: string,
	content: string,
	message: string,
	sha?: string,
) {
	const url = githubContentsUrl(filePath);
	url.searchParams.set("ref", githubConfig.branch);

	const response = await fetch(url, {
		method: "PUT",
		headers: {
			...githubHeaders,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			message,
			content: Buffer.from(content, "utf8").toString("base64"),
			branch: githubConfig.branch,
			...(sha ? { sha } : {}),
		}),
	});

	if (!response.ok)
		throw new Error(
			`GitHub commit failed: ${response.status} ${await response.text()}`,
		);
	return response.json();
}
