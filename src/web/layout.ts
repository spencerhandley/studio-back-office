export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Escapes text, then turns bare URLs into links.
export const linkify = (s: string) =>
  esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";

// Layout: a quiet paper surface with ink type. Each creator type's pigment is the only accent.
const BASE_CSS = `
:root {
  --paper: #F2F3F0; --surface: #FBFBF9; --ink: #1B1E23; --muted: #5A616B; --line: #D9DCD6;
  --accent: #3B4BA8; --good: #2F7A4E; --warn: #A3263A;
  --display: "Bricolage Grotesque", "Avenir Next", "Segoe UI", system-ui, sans-serif;
  --body: "IBM Plex Sans", "Helvetica Neue", Arial, system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #14161A; --surface: #1C1F24; --ink: #E6E7E3; --muted: #A0A6AE; --line: #2E3238; --accent: #8E9BF0; --good: #6CC593; --warn: #F08A9A; color-scheme: dark; }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.55 var(--body); }
a { color: var(--accent); }
h1, h2, h3 { font-family: var(--display); text-wrap: balance; margin: 0; }
p, li { text-wrap: pretty; }
.wrap { max-width: 980px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.eyebrow { font-family: var(--mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.muted { color: var(--muted); }
.btn { font: 600 14px/1 var(--body); background: var(--ink); color: var(--paper); border: 0; border-radius: 8px; padding: 12px 16px; cursor: pointer; text-decoration: none; display: inline-block; }
.btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
.btn.small { padding: 7px 10px; font-size: 13px; }
.btn:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
input, select { font: 400 15px var(--body); color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; width: 100%; }
label { display: grid; gap: 6px; font-size: 13px; font-weight: 500; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-block: 18px; }
.mark { font-family: var(--display); font-weight: 800; font-size: 20px; letter-spacing: -0.01em; text-decoration: none; color: var(--ink); display: inline-flex; gap: 8px; align-items: center; }
.mark i { width: 14px; height: 14px; border-radius: 46% 54% 42% 58% / 55% 45% 55% 45%; background: var(--accent); display: block; }
.scroll-x { overflow-x: auto; }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
`;

export function page(opts: { title: string; body: string; css?: string; accent?: string; script?: string }): string {
  const accent = opts.accent ? `<style>:root{--accent:${esc(opts.accent)}}@media (prefers-color-scheme: dark){:root{--accent:color-mix(in srgb, ${esc(opts.accent)} 55%, white)}}</style>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(opts.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${BASE_CSS}${opts.css ?? ""}</style>
${accent}
</head>
<body>
${opts.body}
${opts.script ? `<script>${opts.script}</script>` : ""}
</body>
</html>`;
}
