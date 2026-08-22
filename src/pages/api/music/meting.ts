import type { APIRoute } from "astro";

export const prerender = false;

const METING_ENDPOINT = "https://api.injahow.cn/meting/";
const allowedServers = new Set([
	"netease",
	"tencent",
	"kugou",
	"kuwo",
	"baidu",
]);
const allowedTypes = new Set(["song", "playlist", "album", "artist", "search"]);

export const GET: APIRoute = async ({ url }) => {
	const server = url.searchParams.get("server") ?? "tencent";
	const type = url.searchParams.get("type") ?? "playlist";
	const id = url.searchParams.get("id") ?? "";

	if (!allowedServers.has(server) || !allowedTypes.has(type)) {
		return Response.json({ error: "Unsupported music source." }, { status: 400 });
	}

	if (!id || id.startsWith("YOUR_")) {
		return Response.json([], {
			headers: {
				"cache-control": "no-store",
				"x-meting-placeholder": `${server}:${type}:${id}`,
			},
		});
	}

	try {
		const upstream = new URL(METING_ENDPOINT);
		upstream.searchParams.set("server", server);
		upstream.searchParams.set("type", type);
		upstream.searchParams.set("id", id);

		const response = await fetch(upstream, {
			headers: {
				accept: "application/json",
				"user-agent": "Marchen-Astro-Meting-Proxy/1.0",
			},
			// 上游卡住时 8 秒后中止，避免长时间占用 Vercel 函数
			signal: AbortSignal.timeout(8000),
		});

		if (!response.ok) {
			return Response.json([], {
				status: 200,
				headers: {
					"cache-control": "public, max-age=60",
					"x-meting-upstream-status": String(response.status),
				},
			});
		}

		const body = await response.text();
		return new Response(body, {
			status: 200,
			headers: {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "public, max-age=600, stale-while-revalidate=3600",
			},
		});
	} catch {
		return Response.json([], {
			status: 200,
			headers: {
				"cache-control": "public, max-age=60",
				"x-meting-upstream-status": "network-error",
			},
		});
	}
};
