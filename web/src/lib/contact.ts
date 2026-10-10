/** Contact / takedown address for the Terms and Privacy pages (VITE_CONTACT_EMAIL; required by
 * build:cloud — see scripts/check-no-secrets.mjs). Empty in builds that don't set it. */
export const CONTACT_EMAIL: string = (import.meta.env.VITE_CONTACT_EMAIL ?? "").trim();
