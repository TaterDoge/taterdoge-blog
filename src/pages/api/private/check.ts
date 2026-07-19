import type { APIRoute } from "astro";
import { hasPrivateAccess } from "@/lib/private-access";

export const prerender = false;

export const GET: APIRoute = ({ cookies }) => {
  const enabled = hasPrivateAccess(cookies);

  return Response.json(
    { enabled },
    {
      headers: {
        "cache-control": "private, no-store",
        vary: "Cookie",
      },
    },
  );
};
