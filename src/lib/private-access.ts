type CookieReader = {
  get: (name: string) => { value: string } | undefined;
};

export const privateCookieKey = import.meta.env.PRIVATE_COOKIE_KEY ?? "marchen_private";
export const privateCookieValue = import.meta.env.PRIVATE_COOKIE_VALUE ?? "";

export function hasPrivateAccess(cookies: CookieReader) {
  return Boolean(privateCookieValue && cookies.get(privateCookieKey)?.value === privateCookieValue);
}
