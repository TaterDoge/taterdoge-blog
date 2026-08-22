import type { APIRoute } from "astro";
import { hasPrivateAccess } from "@/lib/private-access";
import {
	commitGithubFile,
	ensureGithubConfig,
	getExistingSha,
	getGithubFile,
	json,
} from "@/lib/github";
import {
	buildMarkdown,
	projectObject,
	type PublishPayload,
} from "@/lib/publish-markdown";

export const prerender = false;

async function publishProject(payload: PublishPayload) {
	const filePath = "src/data/projects.ts";
	const current = await getGithubFile(filePath);
	if (!current) throw new Error(`GitHub file payload is invalid: ${filePath}`);

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

	return commitGithubFile(
		filePath,
		nextContent,
		`content(projects): add ${payload.title?.trim() || "project"}`,
		current.sha,
	);
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
		const result = await commitGithubFile(
			file.filePath,
			file.content,
			file.message,
			await getExistingSha(file.filePath),
		);

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
