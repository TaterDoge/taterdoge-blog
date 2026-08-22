import type { APIRoute } from "astro";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { hasPrivateAccess } from "@/lib/private-access";
import { serializeValue } from "@/lib/serialize-data";
import {
	commitGithubFile,
	ensureGithubConfig,
	getGithubFile,
	getMissingGithubConfig,
	json,
} from "@/lib/github";

export const prerender = false;

type ManageKind = "projects" | "tools" | "favorites";

type ManagePayload = {
	kind?: ManageKind;
	items?: Record<string, unknown>[];
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

function serializeDataFile(kind: ManageKind, items: Record<string, unknown>[]) {
	const target = targets[kind];
	return `${target.prefix}${serializeValue(items, 0)};\n`;
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
		if (!Array.isArray(payload.items)) throw new Error("Items must be an array.");

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
		const current = await getGithubFile(target.path);
		if (!current)
			throw new Error(`GitHub file payload is invalid: ${target.path}`);
		const result = await commitGithubFile(
			target.path,
			content,
			`content(${target.commitScope}): update order`,
			current.sha,
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
