import { getSecret } from "astro:env/server";

type CookieReader = {
	get: (name: string) => { value: string } | undefined;
};

export const privateCookieKey =
	getSecret("PRIVATE_COOKIE_KEY") ?? "marchen_private";
export const privateCookieValue = getSecret("PRIVATE_COOKIE_VALUE") ?? "";

export function hasPrivateAccess(cookies: CookieReader) {
	return Boolean(
		privateCookieValue &&
			cookies.get(privateCookieKey)?.value === privateCookieValue,
	);
}
