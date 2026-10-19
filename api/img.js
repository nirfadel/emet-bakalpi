// Same-origin image proxy, so source images can be drawn into the shareable story canvas.
// Only the fact-checkers' own image hosts are allowed.
const ALLOWED = ['img.mako.co.il', 'fakereporter.net', 'res.cloudinary.com', 'images.storycards.co'];

export default async function handler(req, res) {
  let url;
  try { url = new URL(String(req.query.u || '')); } catch { return res.status(400).send('bad url'); }
  if (url.protocol !== 'https:' || !ALLOWED.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return res.status(403).send('host not allowed');
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (emet-bakalpi image proxy)' } });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.startsWith('image/')) return res.status(502).send('image unavailable');
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=86400, immutable');
  res.status(200).send(Buffer.from(await r.arrayBuffer()));
}
