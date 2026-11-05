/**
 * Nahdah24 NewsDesk API — Vercel version (same features as api.php)
 * ---------------------------------------------------------------------------
 * URL: /api?action=status | news | article | related | freeimg | img | rewrite
 *
 * Secrets are NOT stored in this file. Add them in Vercel →
 * Project → Settings → Environment Variables:
 *   GEMINI_API_KEY      (free: https://aistudio.google.com/apikey)
 *   GEMINI_MODEL        optional, default gemini-flash-latest
 *   ANTHROPIC_API_KEY   optional alternative to Gemini
 *   ANTHROPIC_MODEL     optional, default claude-haiku-5-5
 *   AI_PROVIDER         optional: gemini | anthropic (auto-detected from the keys)
 *   PEXELS_API_KEY      optional, free stock photos
 *   ACCESS_KEY          optional password (set the same in newsdesk.js KEY)
 *   NEWS_FEEDS          optional JSON: [["name","rss url",1.0], ...]
 */
import dns from 'node:dns/promises';
import net from 'node:net';

const ENV = process.env;
const UA = 'Mozilla/5.0 (compatible; Nahdah24-NewsDesk/1.0; +news card generator)';
const GOOGLE_NEWS = ENV.GOOGLE_NEWS_URL || 'https://news.google.com/rss?hl=bn&gl=BD&ceid=BD:bn';
const MAX_AGE_HOURS = 30;
const DEFAULT_FEEDS = [
  ['প্রথম আলো',     'https://www.prothomalo.com/feed/',            1.3],
  ['বিবিসি বাংলা',   'https://feeds.bbci.co.uk/bengali/rss.xml',    1.2],
  ['যুগান্তর',       'https://www.jugantor.com/feed/rss.xml',       1.1],
  ['কালের কণ্ঠ',     'https://www.kalerkantho.com/rss.xml',         1.1],
  ['জাগো নিউজ',     'https://www.jagonews24.com/rss/rss.xml',      1.0],
  ['বাংলা ট্রিবিউন', 'https://www.banglatribune.com/feed',         1.0],
  ['বাংলানিউজ২৪',   'https://www.banglanews24.com/rss/rss.xml',    1.0],
];
let FEEDS = DEFAULT_FEEDS;
try { if (ENV.NEWS_FEEDS) FEEDS = JSON.parse(ENV.NEWS_FEEDS); } catch (e) {}

const AI_PROVIDER = ENV.AI_PROVIDER || (ENV.GEMINI_API_KEY ? 'gemini' : (ENV.ANTHROPIC_API_KEY ? 'anthropic' : ''));
const aiEnabled = () => (AI_PROVIDER === 'gemini' && !!ENV.GEMINI_API_KEY) || (AI_PROVIDER === 'anthropic' && !!ENV.ANTHROPIC_API_KEY);

// in-memory cache (lives while the function instance is warm; the CDN cache does the rest)
const MEM = new Map();
const memGet = (k, ttl) => { const v = MEM.get(k); return v && Date.now() - v.t < ttl * 1000 ? v.d : null; };
const memPut = (k, d) => { if (MEM.size > 300) MEM.delete(MEM.keys().next().value); MEM.set(k, { t: Date.now(), d }); };

// ============================ HTTP HANDLER ==================================
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const q = Object.fromEntries(url.searchParams);
  const action = q.action || 'status';
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (ENV.ACCESS_KEY && action !== 'img') {
    const k = req.headers['x-newsdesk-key'] || q.key || '';
    if (k !== ENV.ACCESS_KEY) return json(res, { error: 'unauthorized' }, 401);
  }
  try {
    switch (action) {
      case 'status':  return json(res, { ok: true, version: '1.0-vercel', ai: aiEnabled(), ai_provider: aiEnabled() ? AI_PROVIDER : null, pexels: !!ENV.PEXELS_API_KEY, feeds: FEEDS.length });
      case 'news':    return json(res, await getNews(!!q.refresh), 200, q.refresh ? 'no-store' : 'public, s-maxage=1200, stale-while-revalidate=900');
      case 'article': return json(res, await articleImages(q.url || ''), 200, 'public, s-maxage=21600');
      case 'related': return json(res, await relatedImages(q.q || ''), 200, 'public, s-maxage=900');
      case 'freeimg': return json(res, await freeImages(q.q || ''), 200, 'public, s-maxage=43200');
      case 'img':     return await imageProxy(q.url || '', res);
      case 'rewrite': return json(res, await rewrite(req));
      default:        return json(res, { error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json(res, { error: e.message || String(e) }, e.status || 500);
  }
}

function json(res, data, code = 200, cache = 'no-store') {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(data));
}
const fail = (msg, status) => Object.assign(new Error(msg), { status });

// ============================ SAFE FETCH ====================================
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
           (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') ||
         (v.startsWith('::ffff:') && isPrivate(v.slice(7)));
}
async function assertSafe(u) {
  let p; try { p = new URL(u); } catch (e) { throw fail('bad url', 400); }
  if (!/^https?:$/.test(p.protocol)) throw fail('blocked url', 400);
  if (ENV.ALLOW_PRIVATE_HOSTS === '1') return;
  const host = p.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivate(a.address))) throw fail('blocked url', 400);
}
/** GET with checked redirects, timeout and size cap. Returns { buf, type }. */
async function safeGet(u, { max = 3e6, timeout = 10000, headers = {} } = {}) {
  for (let hop = 0; hop < 4; hop++) {
    await assertSafe(u);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    let r;
    try { r = await fetch(u, { redirect: 'manual', signal: ctl.signal, headers: Object.assign({ 'User-Agent': UA }, headers) }); }
    finally { clearTimeout(t); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u).href; continue; }
    if (r.status !== 200) throw fail('http ' + r.status, 502);
    const chunks = []; let size = 0;
    for await (const c of r.body) { size += c.length; if (size > max) throw fail('too large', 413); chunks.push(c); }
    return { buf: Buffer.concat(chunks), type: (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
  }
  throw fail('too many redirects', 502);
}
async function getText(u, opts) { return (await safeGet(u, opts)).buf.toString('utf8'); }

// ============================ TEXT TOOLS ====================================
const decodeEntities = s => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const stripCdata = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const cleanText = s => decodeEntities(stripCdata(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function absUrl(u, base) { try { return u ? new URL(decodeEntities(u.trim()), base).href : ''; } catch (e) { return ''; } }

const N = s => String(s || '').normalize('NFC');
const STOP = new Set(N('ও এবং বা কিন্তু যে যা এই সেই এ সে তার তাদের তিনি তারা হয় হয়ে হলো হল হবে ছিল করে করা করেন করছে করল করলেন করেছে করেছেন দিয়ে দিল থেকে পর্যন্ত জন্য নিয়ে সঙ্গে সাথে মধ্যে উপর কাছে বলে বললেন বলেছেন জানালেন না নয় নেই আর কি কী কেন কোন কোনো এক একটি একজন অনেক সব আরও মতো হতে পারে গেল আছে রয়েছে আজ গত নতুন বিরুদ্ধে প্রতি তবে যদি').split(/\s+/));
const SUFFIX_RE = new RegExp('(' + ['গুলোর','গুলো','দের','য়ের','য়ে','য়','ের','কে','তে','রা','টি','টা','র','ে'].map(N).join('|') + ')$', 'u');
function bnTokens(title) {
  const out = new Set();
  for (let w of N(title).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ').split(/\s+/)) {
    if (!w || STOP.has(w)) continue;
    w = w.replace(SUFFIX_RE, '');
    if ([...w].length >= 2) out.add(w);
  }
  return [...out];
}
function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b); let inter = 0;
  for (const x of a) if (sb.has(x)) inter++;
  if (inter < 2) return 0;
  const union = new Set([...a, ...b]).size;
  return Math.max(inter / union, (inter / Math.min(a.length, b.length)) * 0.75);
}

// =============================== FEEDS ======================================
const tag = (xml, name) => { const m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i')); return m ? m[1] : ''; };
const attr = (xml, name, a) => { const m = xml.match(new RegExp('<' + name + '\\b[^>]*\\b' + a + '=["\']([^"\']+)["\']', 'i')); return m ? m[1] : ''; };

function parseFeed(xml, source, weight, base) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = [];
  for (const it of blocks) {
    const title = cleanText(tag(it, 'title'));
    if (!title) continue;
    let link = cleanText(tag(it, 'link')) || attr(it, 'link', 'href');
    const date = cleanText(tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated') || tag(it, 'dc:date'));
    const ts = Math.floor((Date.parse(date) || Date.now()) / 1000);
    const desc = stripCdata(tag(it, 'description') || tag(it, 'summary'));
    const content = stripCdata(tag(it, 'content:encoded') || tag(it, 'content'));
    let img = attr(it, 'media:content', 'url') || attr(it, 'media:thumbnail', 'url');
    if (!img) { const enc = it.match(/<enclosure\b[^>]*>/i); if (enc && /image/i.test(enc[0])) img = attr(enc[0], 'enclosure', 'url'); }
    if (!img) { const m = (content + desc).match(/<img[^>]+src=["']([^"']+)/i) || decodeEntities(content + desc).match(/<img[^>]+src=["']([^"']+)/i); if (m) img = m[1]; }
    items.push({ title, link: decodeEntities(link), source, weight, ts, image: img ? absUrl(img, base) : '', desc: cleanText(desc).slice(0, 220) });
  }
  return items;
}

function parseGoogleNews(xml) {
  const out = []; let rank = 0;
  for (const it of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []) {
    rank++;
    const src = cleanText(tag(it, 'source'));
    let title = cleanText(tag(it, 'title'));
    if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3));
    const desc = decodeEntities(stripCdata(tag(it, 'description')));
    const related = [];
    for (const m of desc.matchAll(/<a[^>]*>([\s\S]*?)<\/a>(?:&nbsp;|\s| )*<font[^>]*>([\s\S]*?)<\/font>/g)) related.push({ title: cleanText(m[1]), source: cleanText(m[2]) });
    out.push({ title, link: cleanText(tag(it, 'link')), source: src || 'Google News', ts: Math.floor((Date.parse(cleanText(tag(it, 'pubDate'))) || Date.now()) / 1000), rank, related });
  }
  return out;
}

async function getNews(refresh) {
  if (!refresh) { const c = memGet('news', 1200); if (c) return Object.assign({}, c, { cached: true }); }
  const urls = FEEDS.map(f => f[1]).concat(GOOGLE_NEWS ? [GOOGLE_NEWS] : []);
  const bodies = await Promise.all(urls.map(u => getText(u, { max: 4e6, timeout: 9000 }).catch(() => null)));
  const body = Object.fromEntries(urls.map((u, i) => [u, bodies[i]]));

  let items = []; const feeds = [];
  for (const [name, u, w] of FEEDS) {
    const parsed = body[u] ? parseFeed(body[u], name, w, u) : [];
    feeds.push({ source: name, ok: parsed.length > 0, items: parsed.length });
    items.push(...parsed);
  }
  const gn = GOOGLE_NEWS && body[GOOGLE_NEWS] ? parseGoogleNews(body[GOOGLE_NEWS]) : [];
  feeds.push({ source: 'Google News', ok: gn.length > 0, items: gn.length });

  const now = Math.floor(Date.now() / 1000), minTs = now - MAX_AGE_HOURS * 3600;
  items = items.filter(i => i.ts >= minTs).sort((a, b) => b.ts - a.ts);

  // cluster outlet items that describe the same story
  const clusters = [];
  for (const it of items) {
    const tok = bnTokens(it.title);
    let best = -1, bestSim = 0;
    clusters.forEach((cl, ci) => { const s = similarity(tok, cl.tokens); if (s > bestSim) { bestSim = s; best = ci; } });
    if (best >= 0 && bestSim >= 0.42) { clusters[best].items.push(it); clusters[best].tokens = [...new Set([...clusters[best].tokens, ...tok])]; }
    else clusters.push({ tokens: tok, items: [it], gn: null });
  }
  // attach Google News signal
  for (const g of gn) {
    const gt = bnTokens(g.title);
    let best = -1, bestSim = 0;
    clusters.forEach((cl, ci) => {
      let s = similarity(gt, cl.tokens);
      for (const r of g.related) s = Math.max(s, similarity(bnTokens(r.title), cl.tokens));
      if (s > bestSim) { bestSim = s; best = ci; }
    });
    if (best >= 0 && bestSim >= 0.42) { if (!clusters[best].gn || g.rank < clusters[best].gn.rank) clusters[best].gn = g; }
    else if (g.ts >= minTs) clusters.push({ tokens: [...new Set([...gt, ...g.related.flatMap(r => bnTokens(r.title))])], items: [], gn: g });
  }

  const out = clusters.map(cl => {
    const sources = new Set(cl.items.map(i => i.source));
    if (cl.gn) { sources.add(cl.gn.source); cl.gn.related.forEach(r => sources.add(r.source)); }
    let newest = 0, wmax = 0, img = '', rep = null;
    for (const i of cl.items) {
      newest = Math.max(newest, i.ts); wmax = Math.max(wmax, i.weight);
      if (!img && i.image) img = i.image;
      if (!rep || i.weight > rep.weight) rep = i;
    }
    if (cl.gn) newest = Math.max(newest, cl.gn.ts);
    const hours = Math.max(0, (now - newest) / 3600);
    const score = sources.size * 3 + (cl.gn ? Math.max(0, 12 - cl.gn.rank * 0.35) : 0) + Math.max(0, 10 - hours * 0.6) + wmax;
    const title = rep ? rep.title : cl.gn.title;
    return {
      id: hash(title), title, link: rep ? rep.link : cl.gn.link, source: rep ? rep.source : cl.gn.source,
      desc: rep ? rep.desc : '', image: img, sources: [...sources].slice(0, 8), coverage: sources.size,
      ts: newest, score: Math.round(score * 100) / 100,
      related: cl.items.slice(0, 8).map(i => ({ title: i.title, link: i.link, source: i.source, image: i.image })),
    };
  }).sort((a, b) => b.score - a.score);

  const res = { updated: now, items: out.slice(0, 40), feeds, cached: false };
  memPut('news', res);
  return res;
}
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

// ============================ ARTICLE IMAGES ================================
async function articleImages(u) {
  if (!u) throw fail('url required', 400);
  const c = memGet('art-' + u, 21600); if (c) return c;
  const html = await getText(u, { max: 2.5e6 });
  const imgs = [];
  for (const prop of ['og:image', 'twitter:image', 'og:image:url']) {
    const p = prop.replace(/[.:]/g, '\\$&');
    for (const m of html.matchAll(new RegExp('<meta[^>]+(?:property|name)=["\']' + p + '["\'][^>]*content=["\']([^"\']+)', 'gi'))) imgs.push(absUrl(m[1], u));
    for (const m of html.matchAll(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + p + '["\']', 'gi'))) imgs.push(absUrl(m[1], u));
  }
  let n = 0;
  for (const m of html.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)/gi)) {
    if (++n > 25) break;
    if (!/logo|icon|avatar|sprite|placeholder|ads?[\/_-]/i.test(m[1])) imgs.push(absUrl(m[1], u));
  }
  const tm = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)/i);
  const res = { title: tm ? cleanText(tm[1]) : '', images: [...new Set(imgs.filter(Boolean))].slice(0, 8) };
  memPut('art-' + u, res);
  return res;
}

async function relatedImages(q) {
  if ([...q].length < 4) return { items: [] };
  const news = await getNews(false);
  const tok = bnTokens(q); const hits = [];
  for (const n of news.items) {
    let s = similarity(tok, bnTokens(n.title));
    for (const r of n.related) s = Math.max(s, similarity(tok, bnTokens(r.title)));
    if (s < 0.3) continue;
    for (const r of n.related) if (r.image) hits.push({ thumb: r.image, full: r.image, credit: r.source, title: r.title, link: r.link, kind: 'news', score: s });
    if (n.image) hits.push({ thumb: n.image, full: n.image, credit: n.source, title: n.title, link: n.link, kind: 'news', score: s });
  }
  hits.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return { items: hits.filter(h => !seen.has(h.full) && seen.add(h.full)).slice(0, 12) };
}

// ============================ FREE IMAGES ===================================
async function freeImages(q) {
  if ([...q].length < 2) return { items: [] };
  const c = memGet('free-' + q, 43200); if (c) return c;
  const items = [];
  try {
    const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: q + ' filetype:bitmap',
      gsrlimit: '18', prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '1200' });
    const d = JSON.parse(await getText(u, { max: 2e6 }));
    const pages = Object.values((d.query && d.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const p of pages) {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii || !/image\/(jpeg|png|webp)/.test(ii.mime || '')) continue;
      const em = ii.extmetadata || {};
      const artist = em.Artist ? cleanText(em.Artist.value).slice(0, 40) : '';
      items.push({ thumb: ii.thumburl ? ii.thumburl.replace(/\/\d+px-/, '/400px-') : ii.url, full: ii.thumburl || ii.url,
        credit: (artist ? artist + ' / ' : '') + 'Wikimedia Commons', license: em.LicenseShortName ? cleanText(em.LicenseShortName.value) : '',
        link: ii.descriptionurl || '', kind: 'free' });
    }
  } catch (e) {}
  if (ENV.PEXELS_API_KEY) {
    try {
      const d = JSON.parse(await getText('https://api.pexels.com/v1/search?' + new URLSearchParams({ query: q, per_page: '12', orientation: 'landscape' }), { headers: { Authorization: ENV.PEXELS_API_KEY } }));
      for (const p of d.photos || []) items.push({ thumb: p.src.medium, full: p.src.large2x, credit: p.photographer + ' / Pexels', license: 'Pexels License', link: p.url, kind: 'free' });
    } catch (e) {}
  }
  if (items.length < 6) {
    try {
      const d = JSON.parse(await getText('https://api.openverse.org/v1/images/?' + new URLSearchParams({ q, page_size: '12', license_type: 'commercial' })));
      for (const r of d.results || []) items.push({ thumb: r.thumbnail, full: r.url, credit: (r.creator ? r.creator + ' / ' : '') + 'Openverse', license: ('CC ' + r.license).toUpperCase(), link: r.foreign_landing_url, kind: 'free' });
    } catch (e) {}
  }
  const res = { items: items.slice(0, 24) };
  if (items.length) memPut('free-' + q, res);
  return res;
}

// ============================ IMAGE PROXY ===================================
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.slice(4, 12).toString().includes('ftypavif')) return 'image/avif';
  return '';
}
async function imageProxy(u, res) {
  try {
    if (!u) throw fail('url', 400);
    const origin = new URL(u).origin + '/';
    const { buf, type } = await safeGet(u, { max: 1e7, timeout: 15000, headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', Referer: origin } });
    const real = sniff(buf) || (type.startsWith('image/') && type !== 'image/svg+xml' ? type : '');
    if (!real) throw fail('not an image', 415);
    res.statusCode = 200;
    res.setHeader('Content-Type', real);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(buf);
  } catch (e) {
    res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.end('image error');
  }
}

// ============================ AI REWRITE ====================================
const RL = new Map();
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 20000) throw fail('too large', 413); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
async function rewrite(req) {
  if (req.method !== 'POST') throw fail('POST only', 405);
  const body = await readBody(req);
  const title = String(body.title || '').trim().slice(0, 300);
  const context = String(body.context || '').trim().slice(0, 600);
  if ([...title].length < 5) throw fail('title required', 400);
  if (!aiEnabled()) return { source: 'none', variations: [], keywords: [] };
  const c = memGet('rw-' + title, 7 * 86400); if (c) return c;

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'x';
  const slot = ip + new Date().toISOString().slice(0, 13);
  RL.set(slot, (RL.get(slot) || 0) + 1);
  if (RL.size > 5000) RL.clear();
  if (RL.get(slot) > Number(ENV.AI_PER_HOUR_PER_IP || 120)) throw fail('rate limit', 429);

  const prompt = 'তুমি একজন অভিজ্ঞ বাংলা সংবাদ সম্পাদক। নিচের সংবাদ শিরোনাম থেকে সোশ্যাল মিডিয়া নিউজকার্ডের জন্য ৪টি নতুন শিরোনাম লেখো।\n'
    + 'নিয়ম:\n- তথ্য, সংখ্যা ও নাম হুবহু ঠিক রাখবে; নতুন কোনো তথ্য যোগ করবে না, অনুমান করবে না।\n'
    + '- মূল শিরোনামের বাক্য হুবহু কপি করবে না — শব্দচয়ন ও বাক্যগঠন ভিন্ন হবে।\n'
    + '- প্রমিত বাংলা, সংবাদের ভাষা; অতিরঞ্জন বা ক্লিকবেইট নয়।\n- প্রতিটি ৭ থেকে ১৫ শব্দ।\n'
    + '- প্রতিটি শিরোনামের সবচেয়ে গুরুত্বপূর্ণ ১-২টি শব্দ বা ছোট বাক্যাংশ *স্টার* দিয়ে ঘিরে দেবে।\n'
    + '- এছাড়া ছবি খোঁজার জন্য ইংরেজিতে ৩টি ছোট সার্চ কিওয়ার্ড দেবে (ব্যক্তি/স্থান/বিষয়)।\n'
    + 'শুধু এই JSON ফেরত দাও: {"variations":["..."],"keywords":["..."]}\n\n'
    + 'শিরোনাম: ' + title + (context ? '\nপ্রসঙ্গ: ' + context : '');

  let text = '';
  if (AI_PROVIDER === 'gemini') {
    const model = ENV.GEMINI_MODEL || 'gemini-flash-latest';
    const d = await aiPost('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      { 'Content-Type': 'application/json', 'x-goog-api-key': ENV.GEMINI_API_KEY },
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, responseMimeType: 'application/json' } });
    for (const p of (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || []) if (!p.thought && p.text) text += p.text;
  } else {
    const d = await aiPost('https://api.anthropic.com/v1/messages',
      { 'Content-Type': 'application/json', 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: ENV.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 800, messages: [{ role: 'user', content: prompt }] });
    for (const b of d.content || []) if (b.type === 'text') text += b.text;
  }
  const m = text.match(/\{[\s\S]*\}/);
  let j = {}; try { j = JSON.parse(m ? m[0] : text); } catch (e) {}
  const variations = (j.variations || []).map(v => String(v).replace(/\s+/g, ' ').trim()).filter(v => v && v.replace(/\*/g, '') !== title).slice(0, 5);
  const res = { source: AI_PROVIDER, variations, keywords: (j.keywords || []).map(String).slice(0, 4) };
  if (variations.length) memPut('rw-' + title, res);
  return res;
}
async function aiPost(url, headers, body) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 40000);
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw fail('AI error ' + r.status + (d.error && d.error.message ? ': ' + d.error.message : ''), 502);
    return d;
  } finally { clearTimeout(t); }
}
