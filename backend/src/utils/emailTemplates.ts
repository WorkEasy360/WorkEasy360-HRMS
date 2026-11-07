import { appUrl, MailMessage } from "./mailer";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

interface EmailContent {
  to: string;
  subject: string;
  heading: string;
  /** Plain-text paragraphs; escaped for HTML. */
  paragraphs: string[];
  /** Optional label/value rows shown as a small table (e.g. dates, amounts). */
  details?: [string, string][];
  action?: { label: string; path: string };
  footnote?: string;
}

/**
 * Builds a consistent, branded HTML email plus a plain-text alternative.
 *
 * The brand mark is served from the web app at /logo.png. Its alt is empty
 * because the "WorkEasy360" wordmark sits beside it, so a client that blocks
 * images still shows the name exactly once.
 */
export function renderEmail(c: EmailContent): MailMessage {
  const url = c.action ? appUrl(c.action.path) : null;
  const detailsHtml = c.details?.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">${c.details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 0;color:#64748b;width:40%">${escapeHtml(k)}</td><td style="padding:6px 0;color:#0f172a;font-weight:600">${escapeHtml(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";

  const html = `<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#1b3040;padding:16px 24px;color:#ffffff;font-size:16px;font-weight:600">
<img src="${escapeHtml(appUrl("/logo.png"))}" width="28" height="28" alt="" style="width:28px;height:28px;vertical-align:middle;margin-right:8px;border:0">WorkEasy360</td></tr>
<tr><td style="padding:28px 24px;color:#334155;font-size:15px;line-height:1.6">
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">${escapeHtml(c.heading)}</h1>
${c.paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`).join("")}
${detailsHtml}
${url ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(c.action!.label)}</a></p>
<p style="margin:0;font-size:12px;color:#64748b">Or open this link: <a href="${escapeHtml(url)}" style="color:#2563eb;word-break:break-all">${escapeHtml(url)}</a></p>` : ""}
${c.footnote ? `<p style="margin:20px 0 0;font-size:12px;color:#64748b">${escapeHtml(c.footnote)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">This is an automated message from WorkEasy360. Please don't reply.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    c.heading,
    "",
    ...c.paragraphs,
    ...(c.details?.length ? ["", ...c.details.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(url ? ["", `${c.action!.label}: ${url}`] : []),
    ...(c.footnote ? ["", c.footnote] : []),
  ].join("\n");

  return { to: c.to, subject: c.subject, html, text };
}
