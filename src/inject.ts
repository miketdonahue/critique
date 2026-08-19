/**
 * Inject the critique SDK loader into an artifact document.
 *
 * The artifact is served at `/artifact/:key/index.html`, so its own relative
 * asset URLs resolve against `/artifact/:key/` with no `<base>` rewrite needed.
 * We only append the SDK loader script, keyed with the current load token so the
 * chrome can reject messages from a stale (pre-reload) iframe.
 */
export function injectSdk(
  html: string,
  key: string,
  revision: number,
  token: string,
): string {
  const params = new URLSearchParams({ key, rev: String(revision), token });
  const tag = `<script src="/sdk.js?${params.toString()}" data-critique-sdk></script>`;
  const closing = /<\/body\s*>/i;
  if (closing.test(html)) return html.replace(closing, `${tag}$&`);
  return `${html}\n${tag}`;
}
