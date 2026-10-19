// Fact-check source loaders shared by the snapshot script (scripts/update-data.mjs) and the live API (api/data.js).
//   1. N12 "המסננת" (with FakeReporter) - election rumors, public Storycards feed
//   2. FakeReporter "פייקפדיה" - catalog of debunked fakes, WordPress REST API
//   3. Globes "המשרוקית" - in-depth checks of politicians' claims, RSS + section page
const UA = { 'User-Agent': 'Mozilla/5.0 (emet-bakalpi data refresh)' };

const N12_FEED = 'https://storycards.co/api/story/uSi5daIWp/collection/43c601b7-e89c-4970-8e66-4912e80dd5e7/item?limit=500';
const N12_FIELDS = ['id', 'כותרת', 'פייק_אמת', 'בדיקת_עובדות', 'איתרנו_לראשונה', 'תפוצה_משוערת', 'מקור_ההפצה', 'קטגוריות', 'לינק_תמונה', 'קרדיט_צלם', 'כותרת_לשיתוף'];
const FR_API = 'https://fakereporter.net/wp-json/wp/v2';
const GLOBES_RSS = 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=10559';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', bull: '•', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = s => String(s ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const text = html => decode(String(html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

async function getJSON(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export async function loadN12() {
  const { result } = await getJSON(N12_FEED);
  return result.items.map(it => Object.fromEntries(N12_FIELDS.map(f => [f, it[f] ?? null])));
}

// Fakepedia entries are a <ul> whose <li>s start with a bold label.
const FR_LABELS = [
  ['claimText', /^התוכן הכוזב[^:]*:?/],
  ['spreaders', /^מפיצים( מרכזיים)?\s*:?/],
  ['debunk', /^ההפרכה\s*:?/],
  ['motive', /^מה המטרה או האינטרס\s*:?/],
  ['tip', /^(טיפ להתמודדות עם תכנים דומים|איך אפשר לזהות מקרים דומים\?)\s*:?/]
];

function parseFakepedia(html) {
  const out = { links: [] };
  for (const li of html.split(/<li[^>]*>/i).slice(1)) {
    const body = li.split(/<\/li>/i)[0];
    const plain = text(body);
    const hit = FR_LABELS.find(([, re]) => re.test(plain));
    if (!hit) continue;
    const [key, re] = hit;
    out[key] = plain.replace(re, '').trim();
    if (key === 'spreaders') {
      for (const m of body.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const label = text(m[2]);
        if (label && /^https?:/.test(m[1])) out.links.push({ url: decode(m[1]), label });
      }
    }
  }
  return out;
}

export async function loadFakeReporter() {
  const fields = 'id,date,link,title,content,excerpt,featured_media,topics,fakepedia_manipulation_type';
  const [posts, topics, types] = await Promise.all([
    getJSON(`${FR_API}/fakepedia?per_page=100&_fields=${fields}`),
    getJSON(`${FR_API}/topics?per_page=100&_fields=id,name`),
    getJSON(`${FR_API}/fakepedia_manipulation_type?per_page=100&_fields=id,name`)
  ]);
  const topicName = Object.fromEntries(topics.map(t => [t.id, decode(t.name)]));
  const typeName = Object.fromEntries(types.map(t => [t.id, decode(t.name)]));

  const mediaIds = [...new Set(posts.map(p => p.featured_media).filter(Boolean))];
  const media = {};
  for (let i = 0; i < mediaIds.length; i += 100) {
    const batch = await getJSON(`${FR_API}/media?per_page=100&include=${mediaIds.slice(i, i + 100).join(',')}&_fields=id,source_url,media_details`).catch(() => []);
    for (const m of batch) media[m.id] = m.media_details?.sizes?.medium_large?.source_url || m.media_details?.sizes?.large?.source_url || m.source_url;
  }

  return posts.map(p => {
    const f = parseFakepedia(p.content?.rendered || '');
    const title = text(p.title?.rendered).replace(/^["“”]+|["“”]+$/g, '');
    return {
      id: `fr-${p.id}`,
      verdict: 'fake',
      claim: title,
      claimText: f.claimText || '',
      truth: f.debunk || text(p.excerpt?.rendered),
      spreaders: f.spreaders || '',
      links: f.links,
      motive: f.motive || '',
      tip: f.tip || '',
      date: p.date.slice(0, 10),
      cats: (p.topics || []).map(id => topicName[id]).filter(Boolean),
      manipulation: [...new Set((p.fakepedia_manipulation_type || []).map(id => typeName[id]).filter(Boolean))],
      img: media[p.featured_media] || '',
      url: p.link
    };
  }).filter(x => x.claim && x.truth);
}

// Keep only fact-checks of claims; skip the polls column, the AI column, explainers and the history-myths column.
const GLOBES_KEEP = /המשרוקית של גלובס|במבחן העובדות/;
const GLOBES_SKIP = /הסקרים העדכניים|בודקים את המיתוס|ה[־-]AI שמאחורי הבחירות/;
const GLOBES_SECTION = 'https://www.globes.co.il/news/home.aspx?fid=10559';

const deepText = s => { let prev; do { prev = s; s = decode(s); } while (s !== prev); return text(s); };
const globesItem = ({ did, title, desc, date, img }) => ({
  id: `gl-${did}`,
  verdict: 'check',
  claim: title,
  truth: desc.replace(/\s*•\s*(המשרוקית של גלובס|המשרוקית מסבירה)\s*$/, '').replace(/\s*•\s*/g, '. ').replace(/\.\./g, '.'),
  raw: desc,
  date,
  cats: [],
  img,
  url: `https://www.globes.co.il/news/article.aspx?did=${did}`
});

export async function loadGlobes() {
  const get = async url => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return r.text(); };
  const [xml, page] = await Promise.all([get(GLOBES_RSS), get(GLOBES_SECTION).catch(() => '')]);
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '') : '';
  };
  const items = new Map();
  for (const [b] of page.matchAll(/class="\s*Madorlist"\s+data-did="\d+"[\s\S]*?(?=class="\s*Madorlist"|$)/gi)) {
    const did = b.match(/data-did="(\d+)"/)[1];
    const d = (b.match(/class="datetime">(\d{2})\.(\d{2})\.(\d{4})/) || []);
    if (!d.length) continue;
    items.set(did, globesItem({
      did,
      title: deepText((b.match(/<h2[^>]*class="title"[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || ''),
      desc: deepText((b.match(/class="subtitle">([\s\S]*?)<\/div>/) || [])[1] || ''),
      date: `${d[3]}-${d[2]}-${d[1]}`,
      img: decode((b.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '')
    }));
  }
  for (const [, b] of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const did = (tag(b, 'link').match(/did=(\d+)/) || [])[1];
    if (!did) continue;
    items.set(did, globesItem({
      did,
      title: deepText(tag(b, 'title')),
      desc: deepText(tag(b, 'description')),
      date: new Date(tag(b, 'pubDate')).toISOString().slice(0, 10),
      img: decode((b.match(/<media:content[^>]+url="([^"]+)"/i) || [])[1] || '')
    }));
  }
  return [...items.values()]
    .filter(x => x.claim && GLOBES_KEEP.test(x.raw) && !GLOBES_SKIP.test(x.raw))
    .map(({ raw, ...x }) => x);
}

// Loads every source; a failing source falls back to `prev` (or an empty list) instead of failing the whole load.
export async function loadAll(prev = {}, log = () => {}) {
  const settle = async (name, fn, fallback) => {
    try { const v = await fn(); log(`${name}: ${v.length}`); return v; }
    catch (e) { log(`${name} failed (${e.message}), keeping previous data`); return fallback ?? []; }
  };
  const [n12, fakereporter, globesNew] = await Promise.all([
    settle('N12', loadN12, prev.n12 || prev.items),
    settle('FakeReporter', loadFakeReporter, prev.fakereporter),
    settle('Globes', loadGlobes, [])
  ]);
  const globesById = new Map((prev.globes || []).map(g => [g.id, g]));
  globesNew.forEach(g => globesById.set(g.id, g));
  const globes = [...globesById.values()].sort((a, b) => b.date.localeCompare(a.date));
  return { fetchedAt: new Date().toISOString(), n12, fakereporter, globes };
}
