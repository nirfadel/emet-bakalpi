// Wraps index.html (artifact-style body) into a full standalone document with SEO and social-preview tags.
// Output: public/  ->  deploy this folder (Vercel output directory).
// Usage: node scripts/build.mjs [https://your-domain]
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Social crawlers need an absolute, public URL for og:image. On Vercel the production domain is provided automatically
// (a deployment-specific URL sits behind Vercel Authentication, so it must not be used).
const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const site = (process.argv[2] || (prodHost ? `https://${prodHost}` : '') || process.env.SITE_URL || '').replace(/\/$/, '');
// The deployed page loads data from /api/data, so the embedded snapshot is dropped to keep the page small.
const body = (await readFile(path.join(root, 'index.html'), 'utf8'))
  .replace(/(<script type="application\/json" id="snapshot">)[\s\S]*?(<\/script>)/, '$1{}$2');
const title = 'האמת בקלפי | פייק מול אמת בבחירות 2026';
const desc = 'רגע לפני שמעבירים הלאה: שמועות מהבחירות מול מה שקרה באמת, עם מקור לכל בדיקה. N12, פייק ריפורטר והמשרוקית של גלובס.';
const og = site ? `${site}/og.jpg` : 'og.jpg';

const head = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0038B8">
<meta property="og:type" content="website">
<meta property="og:locale" content="he_IL">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
${site ? `<meta property="og:url" content="${site}/">\n<link rel="canonical" href="${site}/">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${og}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}</style>
`;
// The artifact body starts with <title> and <meta> tags; they belong in <head>, so the head stays open until the first <style>.
const i = body.indexOf('<style>');
const doc = head + body.slice(0, i).replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`) + body.slice(i).replace('</style>', '</style>\n</head>\n<body>') + '\n</body>\n</html>\n';

const out = path.join(root, 'public');
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'index.html'), doc);
for (const f of ['og.jpg', 'favicon.svg']) await copyFile(path.join(root, 'assets', f), path.join(out, f));
console.log(`Built public/ (${(doc.length / 1024).toFixed(0)} KB)${site ? ' for ' + site : ''}`);
