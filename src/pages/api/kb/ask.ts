import type { APIRoute } from "astro";

export const prerender = false;

export const POST: APIRoute = async () => {
  return new Response(
    JSON.stringify({
      error: "KB API is reserved for the next phase. Configure server-side knowledge base credentials before enabling it.",
    }),
    {
      status: 501,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
};
