/**
 * Branded emails (rule EM1). Every email template Enact writes can carry the workspace's logo, colour and footer, laid
 * out the way email clients render reliably: tables, inline styles, no <style> block, no web fonts, a 600px column.
 * Halo $variables pass through untouched. Shared by the builder and the app's email preview, so what the plan shows
 * is exactly what Halo is sent. Deterministic: no AI anywhere in here.
 */

export interface EmailBrand {
  /** Shown as the image's alt text and in the footer when no footer is given. */
  name?: string;
  /** https URL of a PNG or JPG logo. Email clients don't show SVG reliably, so SVG is refused. */
  logo_url?: string;
  /** Hex colour, #RRGGBB: the bar under the logo and links. */
  colour: string;
  /** One or two lines under the email, e.g. "IT Service Desk, 0121 000 0000". May use Halo $variables. */
  footer?: string;
}

/** A marker so a re-run recognises its own layout and doesn't wrap it twice. Halo's handling is checked in learn round 15. */
export const BRAND_MARK = 'data-enact-brand';

const HEX = /^#[0-9a-f]{6}$/i;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Problems with a brand, in plain words. Empty = fine. */
export function brandProblems(b: EmailBrand | undefined | null): string[] {
  if (!b) return [];
  const out: string[] = [];
  if (!HEX.test(b.colour ?? '')) out.push(`brand colour "${b.colour ?? ''}" isn't a hex colour like #1652F0`);
  if (b.logo_url) {
    let u: URL | null = null;
    try {
      u = new URL(b.logo_url);
    } catch {
      out.push('the logo address isn\'t a valid link');
    }
    if (u && u.protocol !== 'https:') out.push('the logo must be on an https:// address, or email clients will block it');
    if (u && /\.svg($|\?)/i.test(u.pathname)) out.push('the logo is an SVG; most email clients won\'t show it. Use a PNG or JPG');
  }
  if ((b.footer ?? '').length > 300) out.push('the email footer is over 300 characters');
  return out;
}

/** Black or white text, whichever reads better on the colour (WCAG relative luminance). */
export function textOn(hex: string): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return l > 0.36 ? '#15171c' : '#ffffff';
}

/** Plain text (paragraphs split by blank lines) to HTML. HTML passes through. `styled` adds email-safe inline styles. */
export function textToHtml(text: string, styled = false): string {
  if (/<\w+[^>]*>/.test(text)) return text;
  const p = styled ? '<p style="margin:0 0 14px 0;">' : '<p>';
  return text
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `${p}${esc(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** True when the HTML is already in Enact's branded layout. */
export const isBranded = (html: string) => html.includes(BRAND_MARK);

/** The body, plain text or HTML, inside the branded layout. Already-branded HTML is unwrapped first, so updates re-brand cleanly. */
export function brandedEmail(body: string, b: EmailBrand): string {
  const inner = isBranded(body) ? unwrap(body) : textToHtml(body, true);
  const colour = HEX.test(b.colour) ? b.colour : '#1652f0';
  const name = esc(b.name ?? '');
  const logo = b.logo_url
    ? `<img src="${esc(b.logo_url)}" alt="${name}" height="40" style="display:block;height:40px;width:auto;max-width:220px;border:0;outline:none;text-decoration:none;">`
    : `<span style="font-size:18px;font-weight:bold;color:#15171c;">${name}</span>`;
  const footer = esc(b.footer?.trim() || b.name || '').replace(/\n/g, '<br>');
  return [
    `<table role="presentation" ${BRAND_MARK}="1" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e3e5ea;">',
    `<tr><td style="padding:20px 28px;">${logo}</td></tr>`,
    `<tr><td style="height:4px;line-height:4px;font-size:4px;background-color:${colour};">&nbsp;</td></tr>`,
    `<tr><td data-enact-body="1" style="padding:28px;color:#15171c;font-size:15px;line-height:1.6;">${inner}</td></tr>`,
    footer ? `<tr><td style="padding:16px 28px;border-top:1px solid #e3e5ea;color:#6b7280;font-size:12px;line-height:1.5;">${footer}</td></tr>` : '',
    '</table>',
    '</td></tr>',
    '</table>',
  ].join('');
}

/** The body cell's content from a branded email (for re-branding on update). */
function unwrap(html: string): string {
  const m = html.match(/data-enact-body="1"[^>]*>([\s\S]*?)<\/td><\/tr>/);
  return m ? m[1] : html;
}

/** Every $VARIABLE in a subject or body, as written. */
export function variablesIn(text: string): string[] {
  return [...new Set((text.match(/\$[A-Za-z][A-Za-z0-9_]*/g) ?? []))];
}
