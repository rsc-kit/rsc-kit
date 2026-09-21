/**
 * The head of a stored shell, corrected for the url it is served for.
 *
 * A shell for a route that listed no urls is one file for every url the
 * route matches, so its <title> is whatever the build could know without a
 * url: the layouts' metadata, once the page's own generateMetadata was seen
 * to read the params and left out. The host serving it does know the url,
 * and the page's metadata is a function of it - so the title and the
 * description are written into the head here, as a string edit on the way
 * out, before React resumes the holes below. The client's DocumentTitle
 * sets the title again after hydration; this is for the tab before that,
 * and for whoever reads the document without running it.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TITLE = /<title(?:\s[^>]*)?>[\s\S]*?<\/title>/i;
const DESCRIPTION = /<meta\s+name=(?:"description"|'description'|description)\s+content=(?:"[^"]*"|'[^']*'|[^\s>]*)\s*\/?>/i;
const HEAD_END = /<\/head>/i;

/**
 * `shell` with the given title and description in its head. Only the two
 * that every share preview and every tab reads; the rest of a page's
 * metadata rides with the payload.
 */
export function withHead(
  shell: string,
  metadata: { title?: unknown; description?: unknown } | null,
): string {
  if (!metadata) return shell;

  let out = shell;

  if (metadata.title != null) {
    const tag = `<title>${escapeHtml(String(metadata.title))}</title>`;

    out = TITLE.test(out) ? out.replace(TITLE, tag) : out.replace(HEAD_END, `${tag}</head>`);
  }

  if (metadata.description != null) {
    const tag = `<meta name="description" content="${escapeHtml(String(metadata.description))}"/>`;

    out = DESCRIPTION.test(out) ? out.replace(DESCRIPTION, tag) : out.replace(HEAD_END, `${tag}</head>`);
  }

  return out;
}
