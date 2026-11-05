/*!
 * Nahdah24 NewsDesk — top news list, one-tap news cards, headline variations
 * and online image suggestions. Works with index.html and d2.html.
 * Needs api.php in the same folder.
 */
(function () {
  'use strict';

  // ---------------- SETTINGS ----------------
  // Backend location: found automatically — "api" (Vercel) or "api.php" (PHP hosting).
  // To force one, set window.NEWSDESK_API = '...' before this script.
  let API = window.NEWSDESK_API || '';
  const KEY = '';            // same value as 'access_key' in api.php (leave empty if not used)

  // ---------------- UTILITIES ----------------
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const BN = '০১২৩৪৫৬৭৮৯';
  const bnNum = n => String(n).replace(/\d/g, d => BN[d]);
  const N = s => String(s || '').normalize('NFC');
  const proxy = u => (API || 'api') + '?action=img&url=' + encodeURIComponent(u);
  let apiReady = null;
  function resolveAPI(){
    if (API) return Promise.resolve(API);
    if (!apiReady) apiReady = (async () => {
      for (const c of ['api', 'api.php']) {
        try {
          const r = await fetch(c + '?action=status', { headers: KEY ? { 'X-NewsDesk-Key': KEY } : {} });
          if ((r.headers.get('content-type') || '').includes('json')) { API = c; return c; }
        } catch(e) {}
      }
      apiReady = null; throw new Error('api-missing');
    })();
    return apiReady;
  }
  const store = {
    get(k, d){ try { const v = localStorage.getItem('nd_' + k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } },
    set(k, v){ try { localStorage.setItem('nd_' + k, JSON.stringify(v)); } catch(e){} }
  };
  function timeAgo(ts){
    const m = Math.max(1, Math.round((Date.now() / 1000 - ts) / 60));
    if (m < 60) return bnNum(m) + ' মিনিট আগে';
    const h = Math.round(m / 60);
    return h < 24 ? bnNum(h) + ' ঘণ্টা আগে' : bnNum(Math.round(h / 24)) + ' দিন আগে';
  }
  async function api(action, params, body){
    await resolveAPI();
    const qs = new URLSearchParams(Object.assign({ action }, params || {})).toString();
    const opt = { headers: {} };
    if (KEY) opt.headers['X-NewsDesk-Key'] = KEY;
    if (body){ opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(API + '?' + qs, opt);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error('api-missing');
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || ('http ' + r.status));
    return d;
  }
  const hl = s => esc(s).replace(/\*([^*]+)\*/g, '<mark>$1</mark>');

  // ---------------- STYLES ----------------
  const css = `
  .nd-topbtn{white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:6px;padding:8px 13px;border-radius:30px;border:0;background:linear-gradient(135deg,#e11d2e,#ff5a5f);color:#fff;font:700 13.5px 'Hind Siliguri',sans-serif;box-shadow:0 4px 14px rgba(225,29,46,.4);position:relative;margin-left:auto}
  .nd-topbtn + .top-link{margin-left:8px;flex-shrink:0}
  .topbar .brand{min-width:0}
  .topbar .brand h1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media(max-width:440px){.topbar .brand p{display:none}.topbar .brand h1{font-size:15px}.nd-topbtn{padding:8px 11px}.top-link{padding:8px 11px}}
  .nd-topbtn .nd-dot{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;padding:0 4px;border-radius:10px;background:#fbbf24;color:#111;font:700 11px 'Poppins',sans-serif;display:none;align-items:center;justify-content:center}
  .nd-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:900;opacity:0;pointer-events:none;transition:.25s}
  .nd-backdrop.open{opacity:1;pointer-events:auto}
  .nd-sheet{position:fixed;left:0;right:0;bottom:0;z-index:901;background:#fff;border-radius:22px 22px 0 0;max-height:88vh;display:flex;flex-direction:column;transform:translateY(105%);transition:transform .32s cubic-bezier(.2,.8,.2,1);box-shadow:0 -10px 40px rgba(0,0,0,.25);font-family:'Hind Siliguri',sans-serif;color:#0f172a;padding-bottom:env(safe-area-inset-bottom)}
  .nd-sheet.open{transform:none}
  .nd-sheet.small{max-height:62vh}
  .nd-grab{width:44px;height:5px;border-radius:5px;background:#cbd5e1;margin:9px auto 2px;flex-shrink:0}
  .nd-head{display:flex;align-items:center;gap:10px;padding:8px 16px 12px;border-bottom:1px solid #eef0f3;flex-shrink:0}
  .nd-head h3{font-size:18px;font-weight:700;line-height:1.3}
  .nd-head small{display:block;font-size:12px;color:#64748b;font-weight:500}
  .nd-x{margin-left:auto;width:38px;height:38px;border-radius:50%;border:0;background:#f1f5f9;color:#334155;font-size:16px;flex-shrink:0}
  .nd-head .nd-iconbtn{margin-left:auto}
  .nd-head .nd-iconbtn + .nd-x{margin-left:0}
  .nd-iconbtn{width:38px;height:38px;border-radius:50%;border:0;background:#fff1f2;color:#e11d2e;font-size:15px;flex-shrink:0}
  .nd-body{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 14px 18px;flex:1}
  .nd-tools{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
  .nd-search{flex:1;min-width:150px;padding:10px 14px;border:1.5px solid #e5e7eb;border-radius:12px;font:16px 'Hind Siliguri',sans-serif;background:#f9fafb;outline:none}
  .nd-search:focus{border-color:#e11d2e;background:#fff}
  .nd-chk{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#475569;white-space:nowrap}
  .nd-chk input{width:17px;height:17px;accent-color:#e11d2e}
  .nd-item{display:flex;gap:11px;padding:10px;border-radius:14px;border:1px solid #eef0f3;margin-bottom:9px;background:#fff;cursor:pointer;position:relative;transition:.15s;text-align:left;width:100%;font-family:inherit}
  .nd-item:active{transform:scale(.99);background:#fff7f7}
  .nd-rank{position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:7px;background:#e11d2e;color:#fff;font:700 12px 'Poppins',sans-serif;display:flex;align-items:center;justify-content:center;z-index:1}
  .nd-thumb{width:96px;height:72px;border-radius:10px;background:#e2e8f0 center/cover no-repeat;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:20px}
  .nd-info{min-width:0;flex:1}
  .nd-title{font-size:15.5px;font-weight:700;line-height:1.45;color:#0f172a;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .nd-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;font-size:12px;color:#64748b;align-items:center}
  .nd-pill{background:#fff1f2;color:#e11d2e;border-radius:20px;padding:1px 8px;font-weight:700}
  .nd-pill.hot{background:#e11d2e;color:#fff}
  .nd-busy{position:absolute;inset:0;border-radius:14px;background:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700;color:#e11d2e;font-size:14px}
  .nd-skel{height:92px;border-radius:14px;margin-bottom:9px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:ndsk 1.2s infinite}
  @keyframes ndsk{to{background-position:-200% 0}}
  .nd-empty{text-align:center;color:#64748b;padding:30px 10px;font-size:14px;line-height:1.7}
  .nd-empty b{color:#0f172a}
  .nd-tabs{display:flex;gap:6px;background:#f1f5f9;padding:4px;border-radius:12px;margin-bottom:10px}
  .nd-tabs button{flex:1;border:0;background:transparent;padding:9px 6px;border-radius:9px;font:600 14px 'Hind Siliguri',sans-serif;color:#475569}
  .nd-tabs button.active{background:#fff;color:#e11d2e;box-shadow:0 1px 4px rgba(0,0,0,.1)}
  .nd-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
  @media(min-width:520px){.nd-grid{grid-template-columns:repeat(3,1fr)}}
  .nd-img{position:relative;aspect-ratio:4/3;border-radius:12px;overflow:hidden;background:#e2e8f0;border:0;padding:0;cursor:pointer}
  .nd-img img{width:100%;height:100%;object-fit:cover;display:block}
  .nd-img span{position:absolute;left:0;right:0;bottom:0;padding:14px 7px 5px;background:linear-gradient(transparent,rgba(0,0,0,.75));color:#fff;font-size:11px;font-weight:600;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nd-img .nd-busy{border-radius:12px}
  .nd-var{display:block;width:100%;text-align:left;padding:12px 14px;border-radius:12px;border:1.5px solid #e5e7eb;background:#fff;margin-bottom:8px;font:600 15.5px/1.5 'Hind Siliguri',sans-serif;color:#0f172a}
  .nd-var.active{border-color:#e11d2e;background:#fff5f5}
  .nd-var mark{background:none;color:#e11d2e}
  .nd-var small{display:block;font-size:11.5px;color:#94a3b8;font-weight:600;margin-top:2px}
  .nd-label{font-size:13px;font-weight:700;color:#334155;margin:14px 0 8px;display:flex;align-items:center;gap:7px}
  .nd-label:first-child{margin-top:0}
  .nd-note{font-size:12.5px;color:#64748b;line-height:1.55;margin-top:8px;background:#f8fafc;border-radius:10px;padding:9px 11px}
  .nd-row{display:flex;gap:8px;margin-top:12px}
  .nd-btn{flex:1;padding:12px;border-radius:12px;border:1.5px solid #e5e7eb;background:#fff;font:700 14.5px 'Hind Siliguri',sans-serif;color:#0f172a;display:flex;align-items:center;justify-content:center;gap:7px}
  .nd-btn.primary{border:0;background:linear-gradient(135deg,#b3121f,#e11d2e);color:#fff}
  .nd-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  .nd-act{flex:1 1 0;min-width:0;padding:11px 10px;border-radius:12px;border:1.5px dashed #fca5a5;background:#fff5f5;color:#b91c1c;font:700 14px 'Hind Siliguri',sans-serif;display:flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap}
  .nd-big{width:100%;margin-top:10px;padding:13px;border-radius:14px;border:0;background:linear-gradient(135deg,#0f172a,#334155);color:#fff;font:700 15px 'Hind Siliguri',sans-serif;display:flex;align-items:center;justify-content:center;gap:9px}
  @media(min-width:960px){
    .nd-sheet{left:auto;top:0;width:480px;max-height:none;border-radius:22px 0 0 22px;transform:translateX(105%)}
    .nd-sheet.small{max-height:none}
    .nd-grab{display:none}
  }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---------------- SHEETS ----------------
  const backdrop = document.createElement('div'); backdrop.className = 'nd-backdrop'; document.body.appendChild(backdrop);
  const sheets = [];
  function makeSheet(cls){
    const el = document.createElement('div'); el.className = 'nd-sheet ' + (cls || '');
    el.innerHTML = '<div class="nd-grab"></div><div class="nd-head"></div><div class="nd-body"></div>';
    document.body.appendChild(el); sheets.push(el);
    return { el, head: el.querySelector('.nd-head'), body: el.querySelector('.nd-body') };
  }
  function open(sh){ sheets.forEach(s => s !== sh.el && s.classList.remove('open')); sh.el.classList.add('open'); backdrop.classList.add('open'); }
  function closeAll(){ sheets.forEach(s => s.classList.remove('open')); backdrop.classList.remove('open'); }
  backdrop.addEventListener('click', closeAll);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

  // ---------------- STATE ----------------
  let STATUS = { ai:false };
  let NEWS = null;
  let srcCredit = '', imgCredit = '';
  let lastOriginal = '', lastKeywords = [], lastVariations = [];
  const opts = { addSource: store.get('addSource', true), addImgCredit: store.get('addImgCredit', true) };

  function NC(){ return window.NewsCardAPI; }
  function applyCredits(){
    const parts = [];
    if (opts.addSource && srcCredit) parts.push('সূত্র: ' + srcCredit);
    if (opts.addImgCredit && imgCredit) parts.push('ছবি: ' + imgCredit);
    NC().setSub(parts.join(' · '));
  }

  // ---------------- LOCAL HEADLINE VARIATIONS (no AI key) ----------------
  const SYN = [
    ['রাজধানীতে','ঢাকায়'], ['বলেছেন','জানিয়েছেন'], ['মৃত্যু','প্রাণহানি'],
    ['আহত','জখম'], ['বৈঠক','সভা'], ['দুর্ঘটনায়','দুর্ঘটনার ঘটনায়'], ['সংঘর্ষে','সংঘর্ষের ঘটনায়'],
    ['বাড়ল','বেড়েছে'], ['কমল','কমেছে'], ['শুরু','শুরু হলো'], ['নিশ্চিত','নিশ্চিত করল']
  ].map(p => p.map(N));
  const BN_DIG = '০১২৩৪৫৬৭৮৯';
  const toEn = x => x.replace(/[০-৯]/g, d => BN_DIG.indexOf(d));
  const toBn = x => String(x).replace(/\d/g, d => BN_DIG[d]);
  // "Actor" words that often end a headline in the genitive: "... স্থাপন প্রধানমন্ত্রীর"
  const ACTION_VERB = { 'স্থাপন':'করলেন', 'উদ্বোধন':'করলেন', 'ঘোষণা':'দিলেন', 'নির্দেশ':'দিলেন', 'অনুমোদন':'দিলেন',
    'আহ্বান':'জানালেন', 'সফর':'করলেন', 'বৈঠক':'করলেন', 'সাক্ষাৎ':'করলেন', 'উদ্বেগ':'প্রকাশ করলেন', 'শোক':'প্রকাশ করলেন',
    'নিন্দা':'জানালেন', 'অভিনন্দন':'জানালেন', 'হুঁশিয়ারি':'দিলেন', 'প্রতিশ্রুতি':'দিলেন', 'আশ্বাস':'দিলেন', 'দাবি':'জানালেন' };
  function localVariations(title){
    const t = N(title).replace(/\*/g, '').trim();
    const out = new Set();
    const add = v => { v = v.replace(/\s+/g, ' ').trim(); if (v && v !== t) out.add(v); };

    // A) "...<কাজ> <ব্যক্তি>র"  →  "<ব্যক্তি> ... <কাজ> <ক্রিয়া>"
    const words = t.split(' ');
    if (words.length >= 4) {
      const last = words[words.length - 1].replace(/[।.!]$/, ''), act = words[words.length - 2];
      const verb = ACTION_VERB[N(act)];
      const m = last.match(/^(.+?)(?:ের|এর|র)$/);
      if (verb && m) {
        const rest = words.slice(0, -2).join(' ');
        add(m[1] + ' ' + rest + ' ' + act + ' ' + verb);           // প্রধানমন্ত্রী … স্থাপন করলেন
        add(rest + ' ' + act + ' ' + verb + ' ' + m[1]);           // … স্থাপন করলেন প্রধানমন্ত্রী
      }
    }
    // B) topic + colon:  "মোংলা বন্দরের আধুনিকায়নে …" → "মোংলা বন্দরের আধুনিকায়ন: …"
    const loc = t.match(/^((?:\S+\s){0,3}?\S+?ন)ে\s+(.{12,})$/);
    if (loc && !/:/.test(t)) add(loc[1] + ': ' + loc[2]);
    // C) "৫ জন নিহত" ⇄ "নিহত ৫" / "৫ জনের প্রাণহানি"
    const d = t.match(/([০-৯\d]+)\s*জন\s+(নিহত|আহত)/);
    if (d) { add(t.replace(d[0], d[2] + ' ' + d[1])); if (d[2] === 'নিহত') add(t.replace(d[0], d[1] + ' জনের প্রাণহানি')); }
    const d2 = t.match(/(নিহত|আহত)\s+([০-৯\d]+)(?!\s*জন)/);
    if (d2) add(t.replace(d2[0], d2[2] + ' জন ' + d2[1]));
    // D) number style: "৪ হাজার কোটি" → "৪,০০০ কোটি"
    const h = t.match(/([০-৯\d]+)\s*হাজার\s+(কোটি|লাখ)/);
    if (h) add(t.replace(h[0], toBn((+toEn(h[1]) * 1000).toLocaleString('en-US')) + ' ' + h[2]));
    // D2) "ডলারের দাম বেড়ে ১২৫ টাকা" → "১২৫ টাকায় উঠল ডলারের দাম"
    const pr = t.match(/^(.+?)\s(বেড়ে|কমে)\s([০-৯\d][^,;:]*?)$/);
    if (pr) { const obj = pr[3].trim(); add((/া$/.test(obj) ? obj + 'য়' : obj + 'ে') + ' ' + (pr[2] === 'বেড়ে' ? 'উঠল' : 'নামল') + ' ' + pr[1]); }
    // E) swap two clauses around a comma / semicolon
    const parts = t.split(/\s*[,;]\s*/);
    if (parts.length === 2 && parts[0].split(' ').length > 1 && parts[1].split(' ').length > 1) add(parts[1] + ', ' + parts[0]);
    // F) attribution "X: Y" ⇄ "Y — X"
    const c = t.match(/^([^:]{2,40}):\s*(.+)$/);
    if (c) add(c[2].replace(/[।.]$/, '') + ' — ' + c[1]);
    // G) safe synonym swaps (applied on top of the first variation too)
    const syn = v => { let s2 = v, n = 0;
      if (/ বললেন/.test(s2)) { s2 = s2.replace(' বললেন', ' জানালেন'); n++; }   // one-way only
      SYN.forEach(([a, b]) => { if (s2.includes(a)) { s2 = s2.replace(a, b); n++; } else if (s2.includes(b)) { s2 = s2.replace(b, a); n++; } }); return n ? s2 : ''; };
    add(syn(t));
    const first = [...out][0]; if (first) add(syn(first));
    return [...out].slice(0, 4);
  }

  // ---------------- BENGALI → ENGLISH keywords for free image search ----------------
  const EN = Object.entries({
    'ঢাকা':'Dhaka','রাজধানী':'Dhaka city','বাংলাদেশ':'Bangladesh','চট্টগ্রাম':'Chittagong','সিলেট':'Sylhet','রাজশাহী':'Rajshahi','খুলনা':'Khulna','বরিশাল':'Barisal','রংপুর':'Rangpur','কক্সবাজার':"Cox's Bazar",'সুন্দরবন':'Sundarbans','পদ্মা':'Padma Bridge','মেট্রোরেল':'Dhaka Metro Rail',
    'ক্রিকেট':'cricket','ফুটবল':'football','টাইগার':'Bangladesh cricket','বিশ্বকাপ':'world cup','অলিম্পিক':'Olympics',
    'বাস':'bus','ট্রাক':'truck','সড়ক':'road','দুর্ঘটনা':'road accident','ট্রেন':'train','রেল':'railway','বিমান':'airplane','লঞ্চ':'launch boat','নৌকা':'boat',
    'আগুন':'fire','অগ্নিকাণ্ড':'fire','বন্যা':'flood','ঘূর্ণিঝড়':'cyclone','ভূমিকম্প':'earthquake','বৃষ্টি':'rain','শীত':'winter fog','তাপপ্রবাহ':'heatwave','গরম':'heatwave','নদী':'river',
    'নির্বাচন':'election','ভোট':'voting','সংসদ':'Parliament of Bangladesh','সরকার':'Bangladesh Secretariat','আদালত':'court','হাইকোর্ট':'Supreme Court of Bangladesh','পুলিশ':'police','সেনাবাহিনী':'Bangladesh Army','বিক্ষোভ':'protest','মিছিল':'rally',
    'ডলার':'US dollar','টাকা':'Bangladeshi taka','ব্যাংক':'bank','বাজার':'market','চাল':'rice','তেল':'oil','পেঁয়াজ':'onion','রপ্তানি':'export','গার্মেন্টস':'garment factory','পোশাক':'garment factory','বিদ্যুৎ':'electricity','গ্যাস':'gas',
    'ডেঙ্গু':'dengue mosquito','হাসপাতাল':'hospital','চিকিৎসা':'hospital','শিক্ষার্থী':'students','বিশ্ববিদ্যালয়':'university','পাঠ্যবই':'textbooks','পরীক্ষা':'exam',
    'রোহিঙ্গা':'Rohingya','ভারত':'India','চীন':'China','পাকিস্তান':'Pakistan','যুক্তরাষ্ট্র':'United States','আমেরিকা':'United States','রাশিয়া':'Russia','ইউক্রেন':'Ukraine','গাজা':'Gaza','ফিলিস্তিন':'Palestine','ইসরায়েল':'Israel','ইরান':'Iran','সৌদি':'Saudi Arabia','জাতিসংঘ':'United Nations','মিয়ানমার':'Myanmar',
    'মসজিদ':'mosque','ঈদ':'Eid','হজ':'Hajj','রমজান':'Ramadan','কৃষক':'farmer','ধান':'paddy field','চা':'tea garden','মাছ':'fish market','ইলিশ':'hilsa fish','স্মার্টফোন':'smartphone','এআই':'artificial intelligence','ইন্টারনেট':'internet'
  }).map(([k, v]) => [N(k), v]);
  function guessKeywords(title){
    const words = N(title).replace(/[*,;:।!?"'‘’“”()-]/g, ' ').split(/\s+/).filter(Boolean);
    const out = [];
    words.forEach(w => { for (const [bn, en] of EN) if (w.startsWith(bn) && !out.includes(en)) { out.push(en); break; } });
    return out.slice(0, 3);
  }

  // ---------------- AI VARIATIONS ----------------
  async function getVariations(title, context){
    let res = { variations: [], keywords: [], source: 'local' };
    if (STATUS.ai) {
      try { res = await api('rewrite', {}, { title, context: context || '' }); }
      catch(e) { console.warn('AI', e); res = { variations: [], keywords: [], aiError: e.message }; }
    }
    if (!res.variations || !res.variations.length) res = { variations: localVariations(title), keywords: res.keywords || [], source: 'local', aiError: res.aiError };
    if (!res.keywords || !res.keywords.length) res.keywords = guessKeywords(title);
    return res;
  }

  // ======================================================================
  //   1. TOP NEWS SHEET
  // ======================================================================
  const newsSheet = makeSheet();
  newsSheet.head.innerHTML = `
    <div><h3>🔥 আজকের টপ নিউজ</h3><small id="ndUpd">লোড হচ্ছে…</small></div>
    <button class="nd-iconbtn" id="ndRefresh" title="রিফ্রেশ"><i class="fa-solid fa-rotate-right"></i></button>
    <button class="nd-x" data-close>✕</button>`;
  newsSheet.body.innerHTML = `
    <div class="nd-tools">
      <input class="nd-search" id="ndFilter" type="search" placeholder="খবর খুঁজুন…">
      <label class="nd-chk"><input type="checkbox" id="ndAddSrc"> সূত্র দেখান</label>
    </div>
    <div id="ndList"></div>`;
  newsSheet.head.querySelector('[data-close]').onclick = closeAll;
  const ndList = newsSheet.body.querySelector('#ndList');
  const ndAddSrc = newsSheet.body.querySelector('#ndAddSrc');
  ndAddSrc.checked = opts.addSource;
  ndAddSrc.onchange = () => { opts.addSource = ndAddSrc.checked; store.set('addSource', opts.addSource); applyCredits(); };
  newsSheet.body.querySelector('#ndFilter').oninput = renderNews;
  newsSheet.head.querySelector('#ndRefresh').onclick = () => loadNews(true);

  function showUpdated(){
    const ok = (NEWS.feeds || []).filter(f => f.ok).length;
    $('#ndUpd').textContent = 'আপডেট ' + timeAgo(NEWS.updated) + ' · ' + bnNum(ok) + 'টি উৎস থেকে';
    const dot = $('.nd-topbtn .nd-dot');
    if (dot && NEWS.items.length) { dot.textContent = bnNum(Math.min(NEWS.items.length, 99)); dot.style.display = 'flex'; }
  }
  async function loadNews(refresh){
    ndList.innerHTML = '<div class="nd-skel"></div>'.repeat(6);
    $('#ndUpd').textContent = 'খবর সংগ্রহ ও র‍্যাঙ্কিং হচ্ছে…';
    try {
      NEWS = await api('news', refresh ? { refresh: 1 } : {});
      showUpdated(); renderNews();
    } catch(e) {
      $('#ndUpd').textContent = 'লোড করা যায়নি';
      ndList.innerHTML = e.message === 'api-missing' || e.message === 'Failed to fetch'
        ? `<div class="nd-empty">⚠️ <b>api.php</b> পাওয়া যায়নি।<br>api.php ফাইলটি index.html এর পাশে আপনার হোস্টিংয়ে আপলোড করুন (PHP লাগবে)।<br><small>সরাসরি ফাইল (file://) হিসেবে খুললে এটি কাজ করবে না।</small></div>`
        : `<div class="nd-empty">⚠️ খবর আনা যায়নি (${esc(e.message)})।<br>একটু পরে রিফ্রেশ করুন।</div>`;
    }
  }

  function renderNews(){
    if (!NEWS) return;
    const q = N($('#ndFilter').value.trim());
    const items = NEWS.items.filter(n => !q || N(n.title).includes(q) || (n.related || []).some(r => N(r.title).includes(q)));
    if (!items.length){ ndList.innerHTML = '<div class="nd-empty">কোনো খবর পাওয়া যায়নি।</div>'; return; }
    ndList.innerHTML = items.map((n, i) => `
      <button class="nd-item" data-id="${esc(n.id)}">
        <span class="nd-rank">${bnNum(i + 1)}</span>
        <span class="nd-thumb" ${n.image ? `style="background-image:url('${esc(proxy(n.image))}')"` : ''}>${n.image ? '' : '<i class="fa-regular fa-newspaper"></i>'}</span>
        <span class="nd-info">
          <span class="nd-title">${esc(n.title)}</span>
          <span class="nd-meta">
            <span class="nd-pill ${n.coverage >= 4 ? 'hot' : ''}">${bnNum(n.coverage || 1)}টি মাধ্যমে</span>
            <span>${esc(n.source)}</span><span>· ${timeAgo(n.ts)}</span>
          </span>
        </span>
      </button>`).join('');
    ndList.querySelectorAll('.nd-item').forEach(b => b.onclick = () => buildCard(NEWS.items.find(n => n.id === b.dataset.id), b));
  }

  // ---------------- ONE-TAP CARD ----------------
  async function findImage(item){
    if (item.image) return { url: item.image, credit: item.source };
    for (const r of item.related || []) if (r.image) return { url: r.image, credit: r.source };
    const links = [item.link].concat((item.related || []).map(r => r.link)).filter(l => l && !/news\.google\./.test(l));
    for (const l of links.slice(0, 3)) {
      try { const a = await api('article', { url: l }); if (a.images && a.images[0]) return { url: a.images[0], credit: item.source }; } catch(e) {}
    }
    return null;
  }

  async function buildCard(item, btn){
    if (!item || btn.querySelector('.nd-busy')) return;
    const busy = document.createElement('div'); busy.className = 'nd-busy';
    busy.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>কার্ড তৈরি হচ্ছে…</span>';
    btn.appendChild(busy);
    try {
      const ctx = (item.related || []).map(r => r.title).slice(0, 4).join(' | ') + (item.desc ? ' | ' + item.desc : '');
      const [vars, img] = await Promise.all([getVariations(item.title, ctx), findImage(item)]);
      lastOriginal = item.title; lastKeywords = vars.keywords; lastVariations = vars.variations;
      NC().setTitle(vars.variations[0] || item.title);
      srcCredit = item.source; imgCredit = '';
      if (img) {
        busy.querySelector('span').textContent = 'ছবি বসানো হচ্ছে…';
        try { await NC().setImageFromURL(proxy(img.url), 'news.jpg'); imgCredit = img.credit === item.source ? '' : img.credit; }
        catch(e) { NC().toast('⚠️ ছবি আনা যায়নি — অন্য ছবি বেছে নিন'); }
      }
      applyCredits();
      showVariations(vars, item.title, !img);
    } catch(e) {
      NC().toast('❌ সমস্যা: ' + e.message);
    } finally { busy.remove(); }
  }

  // ======================================================================
  //   2. HEADLINE VARIATIONS SHEET
  // ======================================================================
  const varSheet = makeSheet('small');
  varSheet.head.innerHTML = `<div><h3>✅ কার্ড প্রস্তুত</h3><small>পছন্দের শিরোনামে ট্যাপ করুন</small></div><button class="nd-x" data-close>✕</button>`;
  varSheet.head.querySelector('[data-close]').onclick = closeAll;

  function showVariations(vars, original, noImage){
    const current = NC().getTitle();
    const list = vars.variations.map(v => ({ text: v, tag: vars.source === 'local' ? 'সাধারণ ভেরিয়েশন' : 'AI ভেরিয়েশন' }));
    if (original) list.push({ text: original, tag: 'মূল শিরোনাম (হুবহু)' });
    varSheet.body.innerHTML = `
      <div class="nd-label"><i class="fa-solid fa-wand-magic-sparkles" style="color:#f59e0b"></i> শিরোনামের বিকল্প</div>
      ${list.length ? list.map((v, i) => `<button class="nd-var ${v.text === current ? 'active' : ''}" data-i="${i}">${hl(v.text)}<small>${v.tag}</small></button>`).join('') : '<div class="nd-note">এই শিরোনামের কোনো ভেরিয়েশন বানানো যায়নি।</div>'}
      ${vars.source === 'local' ? `<div class="nd-note">${aiNote(vars.aiError)}</div>` : ''}
      ${noImage ? '<div class="nd-note">🖼️ এই খবরের ছবি পাওয়া যায়নি — নিচের বাটন থেকে ছবি বেছে নিন।</div>' : ''}
      <div class="nd-row">
        <button class="nd-btn" id="ndMoreImg"><i class="fa-regular fa-images"></i> অন্য ছবি</button>
        <button class="nd-btn primary" data-close>ঠিক আছে</button>
      </div>`;
    varSheet.body.querySelectorAll('.nd-var').forEach(b => b.onclick = () => {
      NC().setTitle(list[+b.dataset.i].text);
      varSheet.body.querySelectorAll('.nd-var').forEach(x => x.classList.toggle('active', x === b));
    });
    varSheet.body.querySelector('[data-close]').onclick = closeAll;
    varSheet.body.querySelector('#ndMoreImg').onclick = () => openImagePicker(original || NC().getTitle());
    open(varSheet);
  }

  function aiNote(err){
    if (!STATUS.ai) return '💡 আরও স্বাভাবিক ও ভিন্ন শিরোনামের জন্য সার্ভারে Gemini API key যোগ করুন (Vercel → Environment Variables → GEMINI_API_KEY)।';
    const e = String(err || '');
    if (/403|PERMISSION|denied|billing|restricted/i.test(e)) return '⚠️ AI কাজ করছে না: Google আপনার Gemini প্রজেক্টে ফ্রি ব্যবহার বন্ধ রেখেছে। AI Studio-তে বিলিং চালু করুন বা অন্য Google অ্যাকাউন্টের key দিন। ততক্ষণ সাধারণ ভেরিয়েশন দেখানো হচ্ছে।';
    if (/429|quota|rate/i.test(e)) return '⚠️ AI-এর আজকের/মিনিটের সীমা শেষ। একটু পরে আবার চেষ্টা করুন। ততক্ষণ সাধারণ ভেরিয়েশন দেখানো হচ্ছে।';
    if (/400|API key not valid|INVALID/i.test(e)) return '⚠️ Gemini API key সঠিক নয়। Vercel-এ GEMINI_API_KEY আবার দেখুন, তারপর Redeploy করুন।';
    return '⚠️ AI থেকে উত্তর পাওয়া যায়নি' + (e ? ' (' + esc(e.slice(0, 120)) + ')' : '') + '। ততক্ষণ সাধারণ ভেরিয়েশন দেখানো হচ্ছে।';
  }

  async function variationsForCurrent(){
    const t = (NC().getTitle() || '').replace(/\*/g, '').trim();
    if (t.length < 8){ NC().toast('আগে শিরোনাম লিখুন'); return; }
    NC().toast(STATUS.ai ? '✨ AI শিরোনাম লিখছে…' : '✨ ভেরিয়েশন তৈরি হচ্ছে…');
    const base = lastVariations.includes(NC().getTitle()) && lastOriginal ? lastOriginal : t;
    const vars = await getVariations(base);
    lastOriginal = base; lastKeywords = vars.keywords; lastVariations = vars.variations;
    showVariations(vars, base, false);
  }

  // ======================================================================
  //   3. IMAGE SUGGESTION POPUP
  // ======================================================================
  const imgSheet = makeSheet();
  imgSheet.head.innerHTML = `<div><h3>🖼️ ছবি সাজেশন</h3><small>শিরোনাম অনুযায়ী অনলাইন থেকে</small></div><button class="nd-x" data-close>✕</button>`;
  imgSheet.head.querySelector('[data-close]').onclick = closeAll;
  imgSheet.body.innerHTML = `
    <div class="nd-tools">
      <input class="nd-search" id="ndImgQ" type="search" placeholder="কী ধরনের ছবি? (বাংলা বা English)">
      <button class="nd-iconbtn" id="ndImgGo"><i class="fa-solid fa-magnifying-glass"></i></button>
    </div>
    <div class="nd-tabs" id="ndImgTabs">
      <button data-k="news" class="active">📰 খবরের ছবি</button>
      <button data-k="free">🌐 ফ্রি ছবি</button>
    </div>
    <div class="nd-grid" id="ndImgGrid"></div>
    <label class="nd-chk" style="margin-top:12px"><input type="checkbox" id="ndAddCredit"> কার্ডে ছবির ক্রেডিট দেখান</label>
    <div class="nd-note" id="ndImgNote"></div>
    <button class="nd-big" id="ndOwn"><i class="fa-solid fa-upload"></i> নিজের ছবি আপলোড করুন</button>`;
  const grid = imgSheet.body.querySelector('#ndImgGrid');
  const qInput = imgSheet.body.querySelector('#ndImgQ');
  let imgTab = 'news', imgTitle = '';
  const credChk = imgSheet.body.querySelector('#ndAddCredit');
  credChk.checked = opts.addImgCredit;
  credChk.onchange = () => { opts.addImgCredit = credChk.checked; store.set('addImgCredit', opts.addImgCredit); applyCredits(); };
  imgSheet.body.querySelector('#ndOwn').onclick = () => { closeAll(); document.getElementById('imageLoader').click(); };
  imgSheet.body.querySelectorAll('#ndImgTabs button').forEach(b => b.onclick = () => { imgTab = b.dataset.k; syncTabs(); searchImages(); });
  imgSheet.body.querySelector('#ndImgGo').onclick = () => { if (imgTab === 'news' && /^[\x00-\x7F\s]+$/.test(qInput.value)) imgTab = 'free'; syncTabs(); searchImages(); };
  qInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchImages(); } });
  function syncTabs(){
    imgSheet.body.querySelectorAll('#ndImgTabs button').forEach(b => b.classList.toggle('active', b.dataset.k === imgTab));
    imgSheet.body.querySelector('#ndImgNote').innerHTML = imgTab === 'news'
      ? '📰 আজকের যেসব খবরের শিরোনাম আপনার শিরোনামের সাথে মেলে, সেগুলোর ছবি। এগুলো সংশ্লিষ্ট সংবাদমাধ্যমের ছবি — ব্যবহার করলে ক্রেডিট দিন।'
      : '🌐 Wikimedia Commons ও অন্যান্য উৎসের ফ্রি-লাইসেন্স ছবি — ক্রেডিটসহ ব্যবহার করা নিরাপদ। ইংরেজি কিওয়ার্ডে বেশি ফল পাবেন।';
  }

  async function openImagePicker(title){
    imgTitle = (title || NC().getTitle() || '').replace(/\*/g, '');
    const kw = (lastKeywords && lastKeywords.length && imgTitle === lastOriginal.replace(/\*/g, '')) ? lastKeywords : guessKeywords(imgTitle);
    imgTab = 'news';
    qInput.value = imgTitle;
    qInput.dataset.kw = kw.join(' ');
    syncTabs();
    open(imgSheet);
    const found = await searchImages();
    if (!found && kw.length) { imgTab = 'free'; qInput.value = kw.join(' '); syncTabs(); searchImages(); }
  }

  async function searchImages(){
    let q = qInput.value.trim();
    if (imgTab === 'free' && q === imgTitle && qInput.dataset.kw) { q = qInput.dataset.kw; qInput.value = q; }
    if (!q) { grid.innerHTML = ''; return 0; }
    grid.innerHTML = '<div class="nd-skel" style="height:110px"></div>'.repeat(6);
    try {
      const d = await api(imgTab === 'news' ? 'related' : 'freeimg', { q });
      const items = d.items || [];
      if (!items.length) {
        grid.innerHTML = `<div class="nd-empty" style="grid-column:1/-1">কোনো ছবি পাওয়া যায়নি।${imgTab === 'news' ? '<br>"ফ্রি ছবি" ট্যাবে দেখুন।' : '<br>অন্য বা ইংরেজি কিওয়ার্ডে খুঁজুন।'}</div>`;
        return 0;
      }
      grid.innerHTML = items.map((it, i) => `<button class="nd-img" data-i="${i}" title="${esc(it.title || it.credit)}"><img loading="lazy" src="${esc(proxy(it.thumb))}" alt="" onerror="this.parentNode.remove()"><span>${esc(it.credit)}${it.license ? ' · ' + esc(it.license) : ''}</span></button>`).join('');
      grid.querySelectorAll('.nd-img').forEach(b => b.onclick = async () => {
        const it = items[+b.dataset.i];
        const busy = document.createElement('div'); busy.className = 'nd-busy'; busy.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        b.appendChild(busy);
        try {
          await NC().setImageFromURL(proxy(it.full), 'online-image.jpg');
          imgCredit = (it.credit === srcCredit) ? '' : it.credit;
          applyCredits();
          closeAll();
          NC().showTab('pImage');
        } catch(e) { NC().toast('⚠️ এই ছবিটি আনা যায়নি, অন্যটি বেছে নিন'); }
        busy.remove();
      });
      return items.length;
    } catch(e) {
      grid.innerHTML = `<div class="nd-empty" style="grid-column:1/-1">⚠️ ${e.message === 'api-missing' ? 'api.php পাওয়া যায়নি — হোস্টিংয়ে আপলোড করুন।' : 'ছবি আনা যায়নি: ' + esc(e.message)}</div>`;
      return 0;
    }
  }

  // ======================================================================
  //   4. HOOK INTO THE PAGE
  // ======================================================================
  function init(){
    if (!NC()) return;
    // top bar button
    const bar = document.querySelector('.topbar');
    const tb = document.createElement('button');
    tb.className = 'nd-topbtn';
    tb.innerHTML = '<i class="fa-solid fa-fire"></i> টপ নিউজ<span class="nd-dot"></span>';
    tb.onclick = () => { open(newsSheet); if (!NEWS) loadNews(false); };
    const link = bar && bar.querySelector('.top-link');
    if (bar) bar.insertBefore(tb, link || null);

    // buttons under the title box
    const titleGroup = document.getElementById('titleInput').closest('.group');
    const acts = document.createElement('div'); acts.className = 'nd-actions';
    acts.innerHTML = `<button class="nd-act" id="ndVarBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> শিরোনাম ভেরিয়েশন</button>
                      <button class="nd-act" id="ndImgBtn"><i class="fa-regular fa-images"></i> ছবি সাজেস্ট</button>`;
    titleGroup.appendChild(acts);
    acts.querySelector('#ndVarBtn').onclick = variationsForCurrent;
    acts.querySelector('#ndImgBtn').onclick = () => openImagePicker(NC().getTitle());

    // big button in the image tab
    const dz = document.getElementById('dropzone');
    const big = document.createElement('button'); big.className = 'nd-big';
    big.innerHTML = '<i class="fa-solid fa-globe"></i> অনলাইনে ছবি খুঁজুন (শিরোনাম অনুযায়ী)';
    big.onclick = () => openImagePicker(NC().getTitle());
    dz.parentNode.appendChild(big);

    // auto-suggest images once the user has finished typing a headline
    const ti = document.getElementById('titleInput');
    let idle = null; const suggested = new Set();
    const maybeSuggest = () => {
      const t = ti.value.replace(/\*/g, '').trim();
      if (t.length < 15 || NC().hasImage() || suggested.has(t) || document.querySelector('.nd-sheet.open')) return;
      suggested.add(t);
      openImagePicker(t);
    };
    ti.addEventListener('input', () => { clearTimeout(idle); idle = setTimeout(() => { if (document.activeElement !== ti) maybeSuggest(); }, 2500); });
    ti.addEventListener('blur', () => { clearTimeout(idle); idle = setTimeout(maybeSuggest, 400); });

    api('status').then(s => { STATUS = s; }).catch(() => {});
    // warm the news cache quietly so the list opens instantly
    setTimeout(() => { if (!NEWS) api('news').then(d => { NEWS = d; showUpdated(); renderNews(); }).catch(() => {}); }, 1200);
  }
  if (window.NewsCardAPI) init(); else document.addEventListener('newscard:ready', init, { once: true });
})();
