// Abnehm-Begleiter: Kalorien, Gewicht und ein Plüschmonster. Alle Daten bleiben auf dem Handy (localStorage).
(function () {
  "use strict";

  // ================= Speicher =================
  const KEY = "abnehm-begleiter-v1";
  const KCAL_PER_KG = 7700;

  function emptyState() {
    return { version: 1, profile: null, days: {}, weights: {}, products: {}, dishes: {}, favorites: [], meta: {} };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyState();
      return Object.assign(emptyState(), JSON.parse(raw));
    } catch (e) {
      return emptyState();
    }
  }
  let S = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast("Speichern hat nicht geklappt. Ist der Speicher voll?"); }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ================= Hilfen =================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nfx = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
  const n0 = (x) => nf0.format(Math.round(x || 0));
  const n1 = (x) => nf1.format(x || 0);
  const num = (v) => { const x = parseFloat(String(v).replace(",", ".")); return isFinite(x) ? x : NaN; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function dkey(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }
  function parseKey(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dkey(d); }
  const today = () => dkey(new Date());
  function dayLabel(k) {
    const t = today();
    if (k === t) return "Heute";
    if (k === addDays(t, -1)) return "Gestern";
    return parseKey(k).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
  }
  const shortDate = (k) => parseKey(k).toLocaleDateString("de-DE", { day: "numeric", month: "short" });
  const nowTime = () => { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  const stem = (w) => (w.length > 3 ? w.replace(/(en|er|n|e|s)$/, "") : w);

  let toastTimer;
  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2600);
  }

  // ================= Berechnungen =================
  function sortedWeights() {
    return Object.keys(S.weights).sort().map((k) => ({ k, w: S.weights[k] }));
  }
  // geglätteter Trend (exponentieller Mittelwert), damit Tagesschwankungen nicht stören
  function trendSeries() {
    const list = sortedWeights();
    let t = null;
    return list.map((e) => { t = t == null ? e.w : t + 0.2 * (e.w - t); return { k: e.k, w: e.w, t }; });
  }
  function weightAt(k) {
    const ser = trendSeries().filter((e) => e.k <= k);
    if (ser.length) return ser[ser.length - 1].t;
    const all = trendSeries();
    if (all.length) return all[0].t;
    return S.profile ? S.profile.startWeight : 70;
  }
  function goals(k) {
    const p = S.profile;
    const w = weightAt(k || today());
    const bmr = 10 * w + 6.25 * p.height - 5 * p.age - 161;
    const tdee = bmr * p.activity;
    const deficit = (p.rate * KCAL_PER_KG) / 7;
    let kcal = Math.round((tdee - deficit) / 10) * 10;
    const floor = 1200;
    const floored = kcal < floor;
    if (floored) kcal = floor;
    if (p.kcalOverride) kcal = p.kcalOverride;
    const protein = p.proteinOverride || Math.round((p.goalWeight || w) * 1.5);
    return { w, bmr, tdee, deficit, kcal, protein, floored: floored && !p.kcalOverride };
  }
  function dayEntries(k) { return (S.days[k] || []).slice().sort((a, b) => (a.t || "").localeCompare(b.t || "")); }
  function dayTotals(k) {
    return dayEntries(k).reduce((s, e) => { s.k += e.k; s.p += e.p; return s; }, { k: 0, p: 0 });
  }

  // ================= Lebensmittel =================
  function foodFromBase(b) { return { ref: "b:" + b.n, name: b.n, brand: "", k: b.k, p: b.p, s: b.s, u: b.u, kind: "base" }; }
  function foodFromProduct(pr) { return { ref: "p:" + pr.key, name: pr.name, brand: pr.brand || "", k: pr.k, p: pr.p, s: pr.s, u: pr.u, kind: pr.source === "off" ? "off" : "own", barcode: pr.barcode }; }
  function foodFromDish(d) {
    const portions = d.portions || 1;
    if (d.weight) {
      return { ref: "d:" + d.id, name: d.name, brand: "", k: (d.kcal / d.weight) * 100, p: (d.prot / d.weight) * 100, s: d.weight / portions, u: "Portion", kind: "dish", portions };
    }
    const W = 1000; // ohne gewogenes Gesamtgewicht rechnen wir intern mit 1000 g
    return { ref: "d:" + d.id, name: d.name, brand: "", k: d.kcal / 10, p: d.prot / 10, s: W / portions, u: "Portion", kind: "dish", noGrams: true, portions };
  }
  function getFood(ref) {
    if (!ref) return null;
    const [t, ...rest] = ref.split(":"); const id = rest.join(":");
    if (t === "b") { const b = BASE_FOODS.find((x) => x.n === id); return b ? foodFromBase(b) : null; }
    if (t === "p") { const pr = S.products[id]; return pr ? foodFromProduct(pr) : null; }
    if (t === "d") { const d = S.dishes[id]; return d ? foodFromDish(d) : null; }
    return null;
  }
  function foodFromEntry(e) {
    return getFood(e.ref) || { ref: e.ref, name: e.name, brand: e.brand || "", k: e.k100, p: e.p100, s: e.s, u: e.u, kind: "entry", noGrams: e.noGrams };
  }
  function units(f) {
    const list = [];
    if (!f.noGrams) list.push({ id: "g", label: "g", g: 1 });
    if (f.s) list.push({ id: "u", label: f.u || "Stück", g: f.s });
    return list;
  }
  function calc(f, qty, unitId) {
    const u = units(f).find((x) => x.id === unitId) || units(f)[0];
    const g = qty * u.g;
    return { g, k: (g * f.k) / 100, p: (g * (f.p || 0)) / 100, unit: u };
  }
  function amountText(qty, unitLabel) {
    if (unitLabel === "g") return nfx.format(qty) + " g";
    const PLURAL = { Scheibe: "Scheiben", Kugel: "Kugeln", Zehe: "Zehen", Portion: "Portionen", Dose: "Dosen", Flasche: "Flaschen", Tasse: "Tassen", Packung: "Packungen", Glas: "Gläser" };
    return nfx.format(qty) + " " + (qty > 1 && PLURAL[unitLabel] ? PLURAL[unitLabel] : unitLabel);
  }
  function makeEntry(f, qty, unitId, base) {
    const c = calc(f, qty, unitId);
    return Object.assign(base || {}, {
      id: (base && base.id) || uid(), t: (base && base.t) || defaultTime(), ref: f.ref, name: f.name, brand: f.brand || "",
      qty, unit: c.unit.id, ul: c.unit.label, g: c.g, k: c.k, p: c.p,
      k100: f.k, p100: f.p || 0, s: f.s, u: f.u, noGrams: !!f.noGrams
    });
  }
  function defaultTime() { return ui.date === today() ? nowTime() : "12:00"; }

  function allFoods() {
    const list = [];
    Object.values(S.dishes).forEach((d) => list.push(foodFromDish(d)));
    Object.values(S.products).forEach((p) => list.push(foodFromProduct(p)));
    BASE_FOODS.forEach((b) => list.push(foodFromBase(b)));
    return list;
  }
  function usageCounts() {
    const c = {};
    Object.values(S.days).forEach((arr) => arr.forEach((e) => { c[e.ref] = (c[e.ref] || 0) + 1; }));
    return c;
  }
  function searchLocal(query, limit = 8) {
    const STOP = ["mit", "und", "von", "vom", "der", "die", "das", "den", "dem", "aus", "auf", "in", "im", "zum", "zur", "ohne"];
    const q = norm(query).split(" ").filter((w) => w.length > 1 && !STOP.includes(w));
    if (!q.length) return [];
    const usage = usageCounts();
    const scored = [];
    allFoods().forEach((f) => {
      const hay = norm(f.name + " " + f.brand);
      const words = hay.split(" ");
      let score = 0, hits = 0;
      q.forEach((tok) => {
        const st = stem(tok);
        if (words.includes(tok) || words.some((w) => stem(w) === st)) { score += 3; hits++; }
        else if (words.some((w) => w.startsWith(st))) { score += 2.2; hits++; }
        else if (st.length >= 4 && hay.includes(st)) { score += 1.6; hits++; }
      });
      if (!hits) return;
      if (hits < q.length) score *= 0.55;
      score += Math.min(3, (usage[f.ref] || 0) * 0.3);
      if (S.favorites.includes(f.ref)) score += 1;
      if (f.kind === "dish" || f.kind === "own") score += 0.5;
      if (norm(f.name) === q.join(" ")) score += 2;
      scored.push({ f, score });
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.f);
  }
  // passt das Lebensmittel zu allen Suchwörtern? (z. B. "Skyr Ehrmann" passt nicht vollständig zum allgemeinen "Skyr")
  function matchesAll(f, query) {
    const STOP = ["mit", "und", "von", "vom", "der", "die", "das", "den", "dem", "aus", "auf", "in", "im", "zum", "zur", "ohne"];
    const q = norm(query).split(" ").filter((w) => w.length > 1 && !STOP.includes(w));
    const hay = norm(f.name + " " + f.brand);
    const words = hay.split(" ");
    return q.every((tok) => { const st = stem(tok); return words.some((w) => w === tok || stem(w) === st || w.startsWith(st)) || (st.length >= 4 && hay.includes(st)); });
  }
  function recentFoods(limit = 20) {
    const seen = new Set(), out = [];
    Object.keys(S.days).sort().reverse().forEach((k) => {
      dayEntries(k).reverse().forEach((e) => {
        if (seen.has(e.ref) || out.length >= limit) return;
        seen.add(e.ref);
        out.push({ f: foodFromEntry(e), qty: e.qty, unit: e.unit });
      });
    });
    return out;
  }
  function lastAmount(ref) {
    const keys = Object.keys(S.days).sort().reverse();
    for (const k of keys) {
      const e = (S.days[k] || []).slice().reverse().find((x) => x.ref === ref);
      if (e) return { qty: e.qty, unit: e.unit };
    }
    return null;
  }
  function defaultAmount(f) {
    const last = lastAmount(f.ref);
    if (last) return last;
    if (f.kind === "dish") return { qty: 1, unit: "u" };
    if (f.s && f.u && f.u !== "Portion") return { qty: 1, unit: "u" };
    if (f.s && f.u === "Portion" && f.kind === "off") return { qty: 1, unit: "u" };
    return { qty: 100, unit: "g" };
  }

  // ================= Freitext verstehen =================
  const WORDNUM = { ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, eins: 1, zwei: 2, drei: 3, vier: 4, "fünf": 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, halbe: 0.5, halber: 0.5, halben: 0.5, halbes: 0.5, halb: 0.5, anderthalb: 1.5, eineinhalb: 1.5, paar: 2 };
  const UNIT_RE = "kg|kilo|gramm|gr|g|ml|milliliter|liter|l|stück|stueck|stk|scheiben|scheibe|esslöffel|el|teelöffel|tl|portionen|portion|gläser|glas|tassen|tasse|dosen|dose|flaschen|flasche|kugeln|kugel|becher|packungen|packung|riegel|zehen|zehe|handvoll|schüssel|schale";
  const PIECE_DEFAULT = { "scheibe": 30, "glas": 200, "tasse": 150, "dose": 330, "flasche": 500, "kugel": 60, "becher": 150, "packung": 100, "riegel": 30, "zehe": 4, "handvoll": 30, "schüssel": 250, "schale": 250, "portion": 150, "stück": 100 };
  function unitKind(u) {
    if (!u) return null;
    u = u.toLowerCase();
    if (/^(kg|kilo)$/.test(u)) return { g: 1000 };
    if (/^(g|gr|gramm|ml|milliliter)$/.test(u)) return { g: 1 };
    if (/^(l|liter)$/.test(u)) return { g: 1000 };
    if (/^(el|esslöffel)$/.test(u)) return { g: 15, label: "EL" };
    if (/^(tl|teelöffel)$/.test(u)) return { g: 5, label: "TL" };
    const map = [["scheib", "scheibe"], ["glä", "glas"], ["glas", "glas"], ["tass", "tasse"], ["dose", "dose"], ["flasch", "flasche"], ["kugel", "kugel"], ["becher", "becher"], ["packung", "packung"], ["riegel", "riegel"], ["zehe", "zehe"], ["handvoll", "handvoll"], ["schüssel", "schüssel"], ["schale", "schale"], ["portion", "portion"], ["st", "stück"]];
    for (const [pre, key] of map) if (u.startsWith(pre)) return { piece: key };
    return null;
  }
  function parseText(text) {
    const parts = String(text).split(/\s*(?:,|;|\+|\n|\bund\b|\bsowie\b|\bmit\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    return parts.map((raw) => {
      let s = raw.replace(/^(ich hab(e)?|ich habe|hatte|gegessen|getrunken)\s+/i, "").replace(/\s+(gegessen|getrunken)$/i, "").trim();
      let qty = null, unit = null;
      const numRe = "(\\d+(?:[.,]\\d+)?|" + Object.keys(WORDNUM).join("|") + ")";
      let m = s.match(new RegExp("^" + numRe + "\\s*(" + UNIT_RE + ")?\\.?\\s+(?:(?:von|vom|der|die|das|den)\\s+)?(.+)$", "i"));
      if (m) {
        qty = WORDNUM[m[1].toLowerCase()] != null ? WORDNUM[m[1].toLowerCase()] : num(m[1]);
        unit = m[2] || null; s = m[3];
        const m2 = s.match(new RegExp("^halbe[nrs]?\\s+(.+)$", "i"));
        if (m2 && qty === 1) { qty = 0.5; s = m2[1]; }
      } else {
        m = s.match(new RegExp("^(.+?)\\s+" + numRe + "\\s*(" + UNIT_RE + ")\\.?$", "i"));
        if (m) { s = m[1]; qty = WORDNUM[m[2].toLowerCase()] != null ? WORDNUM[m[2].toLowerCase()] : num(m[2]); unit = m[3]; }
      }
      s = s.replace(/^(von|vom|der|die|das|den|dem)\s+/i, "").trim();
      return { raw, query: s, qty, unit: unitKind(unit) };
    });
  }
  // aus geparster Menge + gewähltem Lebensmittel eine Menge in den Einheiten des Lebensmittels machen
  function resolveAmount(p, f) {
    const us = units(f);
    const hasPiece = us.find((u) => u.id === "u");
    if (p.qty == null && !p.unit) return defaultAmount(f);
    const qty = p.qty == null ? 1 : p.qty;
    if (!p.unit) {
      if (hasPiece) return { qty, unit: "u" };
      if (qty >= 10) return { qty, unit: "g" };
      return { qty: qty * (PIECE_DEFAULT["stück"]), unit: "g" };
    }
    if (p.unit.g) {
      if (f.noGrams) return { qty: 1, unit: "u" };
      return { qty: Math.round(qty * p.unit.g * 10) / 10, unit: "g" };
    }
    if (hasPiece) return { qty, unit: "u" };
    if (f.noGrams) return { qty, unit: "u" };
    return { qty: Math.round(qty * (PIECE_DEFAULT[p.unit.piece] || 100)), unit: "g" };
  }

  // ================= Open Food Facts =================
  const OFF_FIELDS = "code,product_name,product_name_de,generic_name_de,brands,nutriments,serving_quantity,serving_size,quantity,countries_tags";
  function offToProduct(o) {
    const n = o.nutriments || {};
    let k = n["energy-kcal_100g"];
    if (k == null && n.energy_100g != null) k = n.energy_100g / 4.184;
    if (k == null) return null;
    const name = o.product_name_de || o.product_name || o.generic_name_de;
    if (!name) return null;
    const sq = parseFloat(o.serving_quantity);
    return {
      key: "off:" + o.code, source: "off", barcode: o.code, name: name.trim(),
      brand: (Array.isArray(o.brands) ? o.brands.join(",") : String(o.brands || "")).split(",")[0].trim(), k: Math.round(k * 10) / 10, p: Math.round((n.proteins_100g || 0) * 10) / 10,
      s: sq > 0 && sq < 2000 ? sq : null, u: sq > 0 ? "Portion" : null, size: o.quantity || ""
    };
  }
  async function fetchJson(url, ms = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error("http " + r.status);
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  async function offByBarcode(code) {
    const j = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
    if (j.status !== 1 || !j.product) return null;
    j.product.code = j.product.code || code;
    return offToProduct(j.product);
  }
  // Die Textsuche von Open Food Facts lehnt viele Anfragen sofort ab (Fehler 503), klappt aber meist beim
  // nächsten Versuch. Deshalb: mehrere Versuche mit kurzer Pause, und Ergebnisse für den Tag merken.
  const searchCache = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function offSearch(q) {
    const key = norm(q);
    if (searchCache[key]) return searchCache[key];
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=15&fields=${OFF_FIELDS}`;
    const waits = [0, 600, 1000, 1500, 2000, 2500, 3000, 4000];
    let lastErr;
    for (const w of waits) {
      if (w) await sleep(w);
      if (!navigator.onLine) throw new Error("offline");
      try {
        const j = await fetchJson(url, 15000);
        const seen = new Set();
        // passende Treffer zuerst, dann Produkte aus Deutschland
        const res = (j.products || [])
          .map((o) => ({ p: offToProduct(o), de: (o.countries_tags || []).includes("en:germany") }))
          .filter((x) => x.p && !seen.has(x.p.key) && seen.add(x.p.key))
          .map((x, i) => ({ p: x.p, s: (matchesAll(foodFromProduct(x.p), q) ? 4 : 0) + (x.de ? 2 : 0) - i * 0.01 }))
          .sort((a, b) => b.s - a.s)
          .map((x) => x.p);
        searchCache[key] = res;
        return res;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }
  function rememberProduct(pr) {
    if (!S.products[pr.key]) { S.products[pr.key] = pr; save(); }
    return foodFromProduct(S.products[pr.key]);
  }

  // ================= Ebenen (Sheets) mit Zurück-Taste =================
  const stack = [];
  const SID = uid(); // Einträge im Verlauf aus früheren Seitenaufrufen gehören nicht zu uns
  if (history.state && history.state.layer) history.replaceState(null, "");
  function openLayer(el, onClose) {
    $("#layer").appendChild(el);
    stack.push({ el, onClose });
    history.pushState({ layer: stack.length, sid: SID }, "");
    return el;
  }
  // schließt die obersten n Ebenen; das Promise erfüllt sich, wenn der Browser fertig zurückgesprungen ist
  let closeWaiters = [];
  function closeLayers(n = 1) {
    n = Math.min(n, stack.length);
    if (n <= 0) return Promise.resolve();
    return new Promise((res) => { closeWaiters.push(res); history.go(-n); });
  }
  window.addEventListener("popstate", () => {
    const st = history.state;
    const depth = st && st.sid === SID ? st.layer : 0;
    while (stack.length > depth) {
      const top = stack.pop();
      top.el.remove();
      if (top.onClose) top.onClose();
    }
    const w = closeWaiters; closeWaiters = [];
    w.forEach((f) => f());
  });
  function sheet(html, onClose) {
    const back = document.createElement("div");
    back.className = "sheet-back";
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
    back.addEventListener("click", (e) => { if (e.target === back) closeLayers(1); });
    openLayer(back, onClose);
    return back.firstElementChild;
  }
  function confirmSheet(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      let answered = false;
      const sh = sheet(`<div class="sheet-head"><h2>${esc(title)}</h2></div><p class="muted" style="margin:0">${esc(text)}</p>
        <div class="row"><button class="btn ghost" data-a="no">Abbrechen</button><button class="btn ${danger ? "danger" : ""}" data-a="yes">${esc(okLabel)}</button></div>`,
        () => { if (!answered) resolve(false); });
      sh.addEventListener("click", (e) => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        answered = true; closeLayers(1).then(() => resolve(a.dataset.a === "yes"));
      });
    });
  }

  // ================= Ansichten =================
  const ui = { tab: "heute", date: today(), weekOffset: 0, range: 30, moodOverride: null, msgIdx: 0 };
  const app = $("#app");

  function render() {
    if (!S.profile) { $("#nav").hidden = true; return renderOnboarding(); }
    $("#nav").hidden = false;
    $$(".tab").forEach((t) => t.setAttribute("aria-current", t.dataset.tab === ui.tab ? "page" : "false"));
    if (ui.tab === "heute") renderToday();
    else if (ui.tab === "gewicht") renderWeight();
    else if (ui.tab === "woche") renderWeek();
    else if (ui.tab === "gerichte") renderDishes();
  }
  const gearBtn = `<button class="icon-btn" id="settingsBtn" aria-label="Einstellungen"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>`;
  function topbar(title) { return `<header class="topbar"><h1>${esc(title)}</h1>${gearBtn}</header>`; }
  function bindTop() { const b = $("#settingsBtn"); if (b) b.onclick = openSettings; }

  // ---------- Monster-Stimmung ----------
  function moodFor(k) {
    const g = goals(k), t = dayTotals(k), entries = dayEntries(k).length;
    const rest = g.kcal - t.k, ratio = t.k / g.kcal;
    const isToday = k === today(), hour = new Date().getHours();
    let mood;
    if (!entries) mood = isToday ? (hour < 11 ? "sleepy" : "happy") : "sleepy";
    else if (ratio > 1) mood = "sad";
    else if (!isToday) mood = "party";
    else if (ratio > 0.9) mood = "nervous";
    else if (hour >= 20 && ratio >= 0.6) mood = "party";
    else mood = "happy";
    if (isToday && ui.moodOverride) mood = ui.moodOverride;
    return { mood, rest, entries, isToday };
  }
  function moodMessages(m) {
    const r = n0(Math.abs(m.rest));
    if (m.mood === "sleepy") return m.isToday
      ? ["*gähn* Guten Morgen! Was gibt's zum Frühstück?", "Noch nix im Bauch. Ich bin bereit, wenn du es bist!", "Zzz… oh, hallo! Schön, dass du da bist."]
      : ["An diesem Tag ist nichts eingetragen.", "Hier war ich wohl im Winterschlaf."];
    if (m.mood === "sad") return [`Heute sind es ${r} kcal mehr geworden. Morgen ist ein neuer Tag!`, "Ein Tag drüber macht gar nichts kaputt. Kopf hoch!", "Ich hab dich trotzdem lieb. Weiter geht's!"];
    if (m.mood === "nervous") return [`Uiuiui, nur noch ${r} kcal übrig…`, "Jetzt lieber was Leichtes, ja?", `Knapp! ${r} kcal sind noch drin.`];
    if (m.mood === "party") return m.isToday
      ? ["Juhu! Super Tag, alles im Plan!", "Hüpf, hüpf! Das hast du toll gemacht!", "Ziel geschafft! Ich bin so stolz!"]
      : ["Dieser Tag war im Soll. Hüpf!", "Geschafft! Das war ein guter Tag."];
    if (!m.entries) return ["Hunger? Tipp auf das Plus und trag dein Essen ein!", "Ich warte schon auf dein erstes Essen."];
    return [`Läuft super! Noch ${r} kcal übrig.`, "Weiter so, du machst das klasse!", `${r} kcal hast du noch. Lecker planen!`];
  }

  // ---------- Heute ----------
  function renderToday() {
    const k = ui.date, g = goals(k), t = dayTotals(k), entries = dayEntries(k);
    const m = moodFor(k);
    const msgs = moodMessages(m);
    const msg = msgs[ui.msgIdx % msgs.length];
    const rest = g.kcal - t.k, over = rest < 0;
    const C = 2 * Math.PI * 62, frac = Math.min(1, t.k / g.kcal);
    const name = S.profile.monsterName || "Plüschi";
    const status = !entries.length ? "" : over ? `<span class="pill bad">${n0(-rest)} kcal drüber</span>` : t.k / g.kcal > 0.9 ? `<span class="pill warn">Fast erreicht</span>` : `<span class="pill good">Im Plan</span>`;
    const hasWeight = S.weights[k] != null;

    app.innerHTML = `
      ${topbar("Hallo!")}
      <div class="view">
        <div class="datebar">
          <button id="prevDay" aria-label="Vorheriger Tag">‹</button>
          <div class="label" id="dayLabel">${esc(dayLabel(k))}</div>
          <button id="nextDay" aria-label="Nächster Tag" ${k >= today() ? "disabled" : ""}>›</button>
        </div>
        <section class="card hero">
          <button class="monster" id="monster" aria-label="${esc(name)} antippen"></button>
          <div class="speech" aria-live="polite"><span class="who">${esc(name)}</span>${esc(msg)}</div>
        </section>
        <section class="card">
          <div class="budget">
            <div class="ring">
              <svg viewBox="0 0 150 150"><circle class="track" cx="75" cy="75" r="62"/>
                <circle class="${over ? "over" : "fill"}" cx="75" cy="75" r="62" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
              <div class="center"><div class="big num">${n0(Math.abs(rest))}</div><div class="lbl">${over ? "kcal drüber" : "kcal übrig"}</div></div>
            </div>
            <div class="stats">
              <div class="stat"><div class="k">Gegessen</div><div class="v num">${n0(t.k)} <span class="muted small">/ ${n0(g.kcal)} kcal</span></div></div>
              <div class="stat"><div class="k">Eiweiß</div><div class="v num">${n0(t.p)} <span class="muted small">/ ${n0(g.protein)} g</span></div>
                <div class="bar"><span style="width:${Math.min(100, (t.p / g.protein) * 100)}%"></span></div></div>
              <div>${status}</div>
            </div>
          </div>
        </section>
        ${hasWeight ? "" : `<button class="weight-chip" id="weightChip"><span class="em">⚖️</span><span>Gewicht ${k === today() ? "heute" : "für diesen Tag"} eintragen</span></button>`}
        <section class="card">
          <h2>${k === today() ? "Heute gegessen" : "Gegessen"}</h2>
          ${entries.length ? `<ul class="entries">${entries.map((e) => `
            <li><button class="entry" data-id="${e.id}">
              <span class="time num">${esc(e.t || "")}</span>
              <span><span class="name">${esc(e.name)}</span><br><span class="sub">${esc(amountText(e.qty, e.ul))}${e.brand ? " · " + esc(e.brand) : ""}</span></span>
              <span class="kcal num">${n0(e.k)}<small>kcal · ${n0(e.p)} g E</small></span>
            </button></li>`).join("")}</ul>`
            : `<div class="empty"><b>Noch nichts eingetragen.</b><br>Tipp unten auf das Plus. Du kannst tippen, sprechen oder einen Barcode scannen.</div>`}
        </section>
        ${backupHint()}
      </div>`;
    bindTop();
    const mon = $("#monster");
    Monster.render(mon);
    Monster.setMood(mon, m.mood);
    if (m.mood === "party" && ui.moodOverride === "party") Monster.confetti(mon);
    mon.onclick = () => {
      ui.msgIdx++;
      $(".speech").innerHTML = `<span class="who">${esc(name)}</span>${esc(msgs[ui.msgIdx % msgs.length])}`;
      mon.classList.remove("poke"); void mon.offsetWidth; mon.classList.add("poke");
      if (m.mood === "party") Monster.confetti(mon);
    };
    $("#prevDay").onclick = () => { ui.date = addDays(ui.date, -1); ui.moodOverride = null; render(); };
    $("#nextDay").onclick = () => { if (ui.date < today()) { ui.date = addDays(ui.date, 1); render(); } };
    $("#dayLabel").onclick = () => { ui.date = today(); render(); };
    const wc = $("#weightChip"); if (wc) wc.onclick = () => openWeightEntry(k);
    $$(".entry").forEach((b) => (b.onclick = () => openEntry(b.dataset.id)));
    const bh = $("#backupNow"); if (bh) bh.onclick = exportBackup;
  }
  function backupHint() {
    const days = Object.keys(S.days).length + Object.keys(S.weights).length;
    if (days < 5) return "";
    const last = S.meta.lastBackup;
    if (last && (Date.now() - last) / 86400000 < 14) return "";
    return `<section class="card" style="display:flex;gap:12px;align-items:center">
      <span style="font-size:1.6rem">💾</span><div style="flex:1;min-width:0"><b>Zeit für ein Backup</b><div class="small muted">Deine Daten liegen nur auf diesem Handy.</div></div>
      <button class="btn ghost" id="backupNow">Sichern</button></section>`;
  }

  // ---------- Eintrag bearbeiten ----------
  function openEntry(id) {
    const k = ui.date;
    const e = (S.days[k] || []).find((x) => x.id === id);
    if (!e) return;
    openAmount(foodFromEntry(e), { entry: e, qty: e.qty, unit: e.unit });
  }

  // ---------- Menge wählen ----------
  function openAmount(f, opts = {}) {
    const d = opts.entry ? { qty: opts.qty, unit: opts.unit } : opts.qty != null ? { qty: opts.qty, unit: opts.unit } : defaultAmount(f);
    const us = units(f);
    if (!us.find((u) => u.id === d.unit)) { d.unit = us[0].id; d.qty = d.unit === "g" ? 100 : 1; }
    const isFav = S.favorites.includes(f.ref);
    const pick = opts.mode === "pick";
    const sh = sheet(`
      <div class="sheet-head"><h2>${esc(f.name)}</h2>
        ${pick ? "" : `<button class="star" id="favBtn" aria-pressed="${isFav}" aria-label="Favorit"><svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg></button>`}</div>
      <div class="small muted">${f.brand ? esc(f.brand) + " · " : ""}${f.noGrams ? n0(f.k * f.s / 100) + " kcal pro Portion" : n0(f.k) + " kcal / 100 g"}${f.kind === "dish" ? ` · ${n0(f.k * f.s / 100)} kcal pro Portion (1 von ${f.portions})` : ""}</div>
      <div class="bigamount">
        <label class="field">Menge<input class="input num" id="amtQty" inputmode="decimal" value="${nfx.format(d.qty)}"></label>
        <label class="field">Einheit<select class="input" id="amtUnit">${us.map((u) => `<option value="${u.id}" ${u.id === d.unit ? "selected" : ""}>${esc(u.label)}${u.id === "u" && !f.noGrams ? ` (${n0(u.g)} g)` : ""}</option>`).join("")}</select></label>
      </div>
      ${f.kind === "dish" ? `<div class="hint">Tipp: 0,5 Portion = halbe Portion. Bei ${f.portions} Portionen ist 1 Portion = 1 von ${f.portions}.</div>` : ""}
      <div class="nutri"><div><b class="num" id="amtK">0</b><span>kcal</span></div><div><b class="num" id="amtP">0</b><span>g Eiweiß</span></div></div>
      ${opts.entry ? `<label class="field">Uhrzeit<input class="input" id="amtTime" type="time" value="${esc(opts.entry.t || "12:00")}"></label>` : ""}
      <button class="btn block" id="amtSave">${pick ? "Hinzufügen" : opts.entry ? "Speichern" : "Eintragen"}</button>
      ${opts.entry ? `<button class="btn danger block" id="amtDel">Eintrag löschen</button>` : ""}
      ${f.kind === "own" && !pick ? `<button class="btn ghost block" id="amtEdit">Produkt bearbeiten</button>` : ""}`);
    const q = $("#amtQty", sh), u = $("#amtUnit", sh);
    function upd() {
      const c = calc(f, num(q.value) || 0, u.value);
      $("#amtK", sh).textContent = n0(c.k);
      $("#amtP", sh).textContent = n1(c.p);
    }
    q.oninput = upd;
    u.onchange = () => {
      const old = calc(f, num(q.value) || 0, u.value === "g" ? "u" : "g");
      if (u.value === "g") q.value = nfx.format(Math.round(old.g));
      else q.value = nfx.format(Math.round((old.g / f.s) * 100) / 100 || 1);
      upd();
    };
    upd();
    setTimeout(() => { q.focus(); q.select(); }, 250);
    const fav = $("#favBtn", sh);
    if (fav) fav.onclick = () => {
      const i = S.favorites.indexOf(f.ref);
      if (i >= 0) S.favorites.splice(i, 1); else S.favorites.push(f.ref);
      save(); fav.setAttribute("aria-pressed", i < 0);
      toast(i < 0 ? "Zu Favoriten hinzugefügt" : "Aus Favoriten entfernt");
    };
    $("#amtSave", sh).onclick = () => {
      const qty = num(q.value);
      if (!(qty > 0)) { toast("Bitte eine Menge eingeben."); q.focus(); return; }
      if (pick) { opts.onPick(f, qty, u.value); return; }
      const k = ui.date;
      S.days[k] = S.days[k] || [];
      if (opts.entry) {
        makeEntry(f, qty, u.value, opts.entry);
        opts.entry.t = $("#amtTime", sh).value || opts.entry.t;
      } else {
        S.days[k].push(makeEntry(f, qty, u.value));
      }
      save();
      closeLayers(opts.closeCount || 1);
      afterLog(opts.entry ? "Gespeichert" : "Eingetragen");
    };
    const del = $("#amtDel", sh);
    if (del) del.onclick = () => {
      S.days[ui.date] = (S.days[ui.date] || []).filter((x) => x.id !== opts.entry.id);
      if (!S.days[ui.date].length) delete S.days[ui.date];
      save(); closeLayers(1); afterLog("Gelöscht");
    };
    const ed = $("#amtEdit", sh);
    if (ed) ed.onclick = () => openProductForm({ product: S.products[f.ref.slice(2)] });
  }
  function afterLog(msg) {
    ui.moodOverride = null;
    ui.tab = "heute";
    render();
    toast(msg);
  }

  // ---------- Essen hinzufügen ----------
  function openAdd(opts = {}) {
    const pick = opts.mode === "pick";
    const sh = sheet(`
      <div class="sheet-head"><h2>${pick ? "Zutat hinzufügen" : "Was hast du gegessen?"}</h2></div>
      <textarea class="input" id="addText" rows="2" placeholder="z. B. 200 g Skyr von Ehrmann und eine Banane"></textarea>
      <div class="hint">🎤 Zum Sprechen tippe auf das Mikrofon deiner Tastatur. Mehrere Sachen mit „und“ oder Komma trennen.</div>
      <button class="btn block" id="addGo">Suchen</button>
      <div class="quick">
        <button id="addScan"><span class="ic v"><svg viewBox="0 0 24 24"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8"/></svg></span>Barcode scannen</button>
        <button id="addOwn"><span class="ic p"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></span>Eigenes Produkt</button>
      </div>
      <div id="addResults"></div>
      <div id="addLists">
        <div class="segs" role="group" aria-label="Listen">
          <button data-l="recent" aria-pressed="true">Zuletzt</button>
          <button data-l="fav" aria-pressed="false">Favoriten</button>
          ${pick ? "" : `<button data-l="dish" aria-pressed="false">Gerichte</button>`}
        </div>
        <div class="list" id="addList" style="margin-top:10px"></div>
      </div>`);
    const closeN = pick ? 2 : 2; // Menge + dieses Sheet
    function choose(f, amount) {
      openAmount(f, Object.assign({ closeCount: closeN }, amount || {}, pick ? { mode: "pick", onPick: (ff, qty, unit) => { closeLayers(2); opts.onPick(ff, qty, unit); } } : {}));
    }
    function listHtml(items) {
      if (!items.length) return "";
      return items.map((it, i) => {
        const f = it.f;
        const am = it.qty != null ? it : defaultAmount(f);
        const c = calc(f, am.qty, am.unit);
        return `<button class="item" data-i="${i}"><span><span class="t">${esc(f.name)}${f.kind === "dish" ? '<span class="badge">Gericht</span>' : ""}</span><br><span class="s">${f.brand ? esc(f.brand) + " · " : ""}${esc(amountText(am.qty, c.unit.label))}</span></span><span class="r num">${n0(c.k)}<small>kcal</small></span></button>`;
      }).join("");
    }
    function showList(which) {
      $$(".segs button", sh).forEach((b) => b.setAttribute("aria-pressed", b.dataset.l === which));
      let items = [];
      if (which === "recent") items = recentFoods();
      if (which === "fav") items = S.favorites.map(getFood).filter(Boolean).map((f) => ({ f }));
      if (which === "dish") items = Object.values(S.dishes).map((d) => ({ f: foodFromDish(d) }));
      const box = $("#addList", sh);
      box.innerHTML = listHtml(items) || `<div class="empty small">${which === "recent" ? "Hier erscheint, was du zuletzt gegessen hast." : which === "fav" ? "Markiere Lebensmittel mit dem Stern, dann landen sie hier." : "Noch keine Gerichte. Lege sie im Tab „Gerichte“ an."}</div>`;
      $$(".item", box).forEach((b) => (b.onclick = () => { const it = items[+b.dataset.i]; choose(it.f, it.qty != null ? { qty: it.qty, unit: it.unit } : null); }));
    }
    $$(".segs button", sh).forEach((b) => (b.onclick = () => showList(b.dataset.l)));
    showList("recent");

    $("#addScan", sh).onclick = () => openScanner((f) => choose(f));
    $("#addOwn", sh).onclick = () => openProductForm({ onSaved: (f) => choose(f), name: $("#addText", sh).value.trim() });
    const ta = $("#addText", sh);
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } });
    $("#addGo", sh).onclick = go;

    function go() {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      ta.blur();
      const parsed = parseText(text);
      $("#addLists", sh).hidden = true;
      renderParsed(parsed);
    }

    function renderParsed(parsed) {
      const box = $("#addResults", sh);
      const rows = parsed.map((p) => {
        const cands = searchLocal(p.query);
        return { p, cands, sel: cands[0] || null, amount: cands[0] ? resolveAmount(p, cands[0]) : null, on: true, loading: false, tried: false };
      });
      function rowHtml(r, i) {
        let body;
        if (r.loading) body = `<div class="small muted"><span class="spinner"></span> Suche in der Produktdatenbank… das kann ein paar Sekunden dauern.</div>`;
        else if (!r.sel) body = `<div class="small muted">${r.tried ? "Nichts gefunden." : "Nicht in deiner Liste."}</div>
            <div class="row">${r.tried ? "" : `<button class="btn ghost" data-act="online" data-i="${i}">Online suchen</button>`}<button class="btn ghost" data-act="own" data-i="${i}">Selbst eingeben</button></div>`;
        else {
          const us = units(r.sel);
          const c = calc(r.sel, r.amount.qty, r.amount.unit);
          body = `<div class="pick"><input type="checkbox" data-act="on" data-i="${i}" ${r.on ? "checked" : ""} aria-label="Übernehmen">
              <select class="input" data-act="sel" data-i="${i}">${r.cands.map((f, j) => `<option value="${j}" ${f === r.sel ? "selected" : ""}>${esc(f.name)}${f.brand ? " – " + esc(f.brand) : ""} (${n0(f.k)} kcal/100 g)</option>`).join("")}</select></div>
            <div class="amount">
              <input class="input num" data-act="qty" data-i="${i}" inputmode="decimal" value="${nfx.format(r.amount.qty)}" aria-label="Menge">
              <select class="input" data-act="unit" data-i="${i}">${us.map((u) => `<option value="${u.id}" ${u.id === r.amount.unit ? "selected" : ""}>${esc(u.label)}</option>`).join("")}</select>
            </div>
            <div class="result-line"><span class="small muted" data-pp="${i}">${n1(c.p)} g Eiweiß</span><span class="kc num" data-kc="${i}">${n0(c.k)} kcal</span></div>
            ${r.tried ? "" : `<button class="btn ghost" data-act="online" data-i="${i}">Nicht dabei? Online suchen</button>`}`;
        }
        return `<div class="parsed"><div class="q">${esc(r.p.raw)}</div>${body}</div>`;
      }
      function paint() {
        const any = rows.some((r) => r.sel && r.on);
        const total = rows.reduce((s, r) => s + (r.sel && r.on ? calc(r.sel, r.amount.qty, r.amount.unit).k : 0), 0);
        box.innerHTML = `<div class="list">${rows.map(rowHtml).join("")}</div>
          <div style="margin-top:12px"><button class="btn pink block" id="addAll" ${any ? "" : "disabled"}>${pick ? "Hinzufügen" : "Alles eintragen"} · ${n0(total)} kcal</button></div>`;
        $("#addAll", box).onclick = commit;
      }
      async function online(i) {
        const r = rows[i];
        r.loading = true; paint();
        try {
          const res = await offSearch(r.p.query);
          r.tried = true;
          const fs = res.map((pr) => foodFromProduct(pr));
          r.offMap = res;
          if (fs.length) { r.cands = fs.concat(r.cands.filter((f) => !fs.find((x) => x.ref === f.ref))); r.sel = fs[0]; r.amount = resolveAmount(r.p, fs[0]); }
        } catch (e) {
          toast(navigator.onLine ? "Die Produktdatenbank antwortet gerade nicht. Tipp gleich nochmal auf „Online suchen“ oder scanne den Barcode." : "Du bist offline. Online-Suche geht gerade nicht.");
        }
        r.loading = false; paint();
      }
      box.onclick = (e) => {
        const a = e.target.closest("[data-act]"); if (!a) return;
        const i = +a.dataset.i;
        if (a.dataset.act === "online") online(i);
        if (a.dataset.act === "own") openProductForm({ name: rows[i].p.query, onSaved: (f) => { closeLayers(1); rows[i].cands.unshift(f); rows[i].sel = f; rows[i].amount = resolveAmount(rows[i].p, f); paint(); }, keepOpen: true });
      };
      box.onchange = (e) => {
        const a = e.target.closest("[data-act]"); if (!a) return;
        const r = rows[+a.dataset.i];
        if (a.dataset.act === "on") r.on = a.checked;
        if (a.dataset.act === "sel") { r.sel = r.cands[+a.value]; r.amount = resolveAmount(r.p, r.sel); }
        if (a.dataset.act === "unit") {
          const oldG = calc(r.sel, r.amount.qty, r.amount.unit).g;
          r.amount = { unit: a.value, qty: a.value === "g" ? Math.round(oldG) : Math.round((oldG / r.sel.s) * 100) / 100 || 1 };
        }
        if (a.dataset.act === "qty") return;
        paint();
      };
      // Menge tippen: nur Zahlen aktualisieren, nicht alles neu zeichnen (sonst springt der Fokus weg)
      box.oninput = (e) => {
        const a = e.target.closest('[data-act="qty"]'); if (!a) return;
        const i = +a.dataset.i, r = rows[i];
        r.amount.qty = num(a.value) || 0;
        const c = calc(r.sel, r.amount.qty, r.amount.unit);
        $(`[data-kc="${i}"]`, box).textContent = n0(c.k) + " kcal";
        $(`[data-pp="${i}"]`, box).textContent = n1(c.p) + " g Eiweiß";
        const total = rows.reduce((s, x) => s + (x.sel && x.on ? calc(x.sel, x.amount.qty, x.amount.unit).k : 0), 0);
        $("#addAll", box).textContent = (pick ? "Hinzufügen" : "Alles eintragen") + " · " + n0(total) + " kcal";
      };
      function commit() {
        const chosen = rows.filter((r) => r.sel && r.on && r.amount.qty > 0);
        chosen.forEach((r) => {
          if (r.sel.kind !== "off") return;
          const pr = S.products[r.sel.ref.slice(2)] || (r.offMap || []).find((x) => "p:" + x.key === r.sel.ref);
          if (pr) rememberProduct(pr);
        });
        if (pick) {
          closeLayers(1);
          chosen.forEach((r) => opts.onPick(getFood(r.sel.ref) || r.sel, r.amount.qty, r.amount.unit));
          return;
        }
        const k = ui.date;
        S.days[k] = S.days[k] || [];
        chosen.forEach((r) => S.days[k].push(makeEntry(getFood(r.sel.ref) || r.sel, r.amount.qty, r.amount.unit)));
        save();
        closeLayers(1);
        afterLog(chosen.length === 1 ? "Eingetragen" : chosen.length + " Sachen eingetragen");
      }
      paint();
      // was lokal nicht (vollständig) gefunden wurde, z. B. mit Markenname, gleich online suchen (nacheinander)
      (async () => { for (let i = 0; i < rows.length; i++) if (!rows[i].sel || !matchesAll(rows[i].sel, rows[i].p.query)) await online(i); })();
    }
    return sh;
  }

  // ---------- Barcode-Scanner ----------
  function openScanner(onFood) {
    const el = document.createElement("div");
    el.className = "scanner";
    el.innerHTML = `<div style="position:relative;overflow:hidden">
        <video playsinline muted></video><div class="frame"></div><div class="msg" id="scanMsg">Halte den Barcode in den Rahmen</div></div>
      <div class="panel">
        <div class="row"><input class="input num" id="scanCode" inputmode="numeric" placeholder="Oder Nummer eintippen"><button class="btn" id="scanOk" style="flex:0 0 auto">OK</button></div>
        <button class="btn ghost block" id="scanClose">Abbrechen</button>
      </div>`;
    let stream = null, stopped = false, reader = null, busy = false;
    function stop() {
      stopped = true;
      if (reader) try { reader.reset(); } catch (e) {}
      if (stream) stream.getTracks().forEach((t) => t.stop());
    }
    openLayer(el, stop);
    const video = $("video", el), msg = $("#scanMsg", el);
    $("#scanClose", el).onclick = () => closeLayers(1);
    $("#scanOk", el).onclick = () => { const c = $("#scanCode", el).value.replace(/\D/g, ""); if (c.length >= 6) found(c); };

    async function found(code) {
      if (busy) return; busy = true;
      if (navigator.vibrate) navigator.vibrate(60);
      msg.innerHTML = `<span class="spinner"></span> Suche ${esc(code)}…`;
      const own = Object.values(S.products).find((p) => p.barcode === code);
      if (own) { closeLayers(1).then(() => onFood(foodFromProduct(own))); return; }
      try {
        const pr = await offByBarcode(code);
        if (pr) { const f = rememberProduct(pr); closeLayers(1).then(() => onFood(f)); return; }
        closeLayers(1).then(() => { toast("Produkt nicht gefunden. Trag die Werte einmal von der Packung ein."); openProductForm({ barcode: code, onSaved: onFood }); });
      } catch (e) {
        busy = false;
        msg.textContent = "Keine Verbindung zur Produktdatenbank. Versuch es gleich nochmal.";
      }
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play();
      } catch (e) {
        msg.textContent = "Die Kamera ist nicht verfügbar. Erlaube den Kamerazugriff oder tippe die Nummer unten ein.";
        return;
      }
      let detector = null;
      if ("BarcodeDetector" in window) {
        try { detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] }); } catch (e) { detector = null; }
      }
      if (detector) {
        const loop = async () => {
          if (stopped || busy) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length) return found(codes[0].rawValue);
          } catch (e) {}
          setTimeout(loop, 180);
        };
        loop();
      } else {
        try {
          await loadScript("https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js");
          if (stopped) return;
          reader = new ZXing.BrowserMultiFormatReader();
          reader.decodeFromStream(stream, video, (res) => { if (res && !stopped) found(res.getText()); });
        } catch (e) {
          msg.textContent = "Scanner konnte nicht starten. Tippe die Nummer unten ein.";
        }
      }
    })();
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ($(`script[src="${src}"]`)) return res();
      const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  // ---------- Eigenes Produkt ----------
  function openProductForm(opts = {}) {
    const pr = opts.product || {};
    const sh = sheet(`
      <div class="sheet-head"><h2>${pr.key ? "Produkt bearbeiten" : "Eigenes Produkt"}</h2></div>
      <div class="hint">Die Werte stehen auf der Packung in der Nährwerttabelle (pro 100 g).</div>
      <label class="field">Name<input class="input" id="pfName" value="${esc(pr.name || opts.name || "")}" placeholder="z. B. Skyr Natur"></label>
      <label class="field">Marke (optional)<input class="input" id="pfBrand" value="${esc(pr.brand || "")}" placeholder="z. B. Ehrmann"></label>
      <div class="row">
        <label class="field">kcal pro 100 g<input class="input num" id="pfK" inputmode="decimal" value="${pr.k != null ? nfx.format(pr.k) : ""}"></label>
        <label class="field">Eiweiß pro 100 g<input class="input num" id="pfP" inputmode="decimal" value="${pr.p != null ? nfx.format(pr.p) : ""}"></label>
      </div>
      <div class="row">
        <label class="field">Einheit (optional)<input class="input" id="pfU" value="${esc(pr.u || "")}" placeholder="z. B. Becher, Riegel"></label>
        <label class="field">Gramm pro Einheit<input class="input num" id="pfS" inputmode="decimal" value="${pr.s ? nfx.format(pr.s) : ""}"></label>
      </div>
      <label class="field">Barcode (optional)<input class="input num" id="pfCode" inputmode="numeric" value="${esc(pr.barcode || opts.barcode || "")}"></label>
      <button class="btn block" id="pfSave">Speichern</button>
      ${pr.key ? `<button class="btn danger block" id="pfDel">Produkt löschen</button>` : ""}`);
    $("#pfSave", sh).onclick = () => {
      const name = $("#pfName", sh).value.trim(), k = num($("#pfK", sh).value), p = num($("#pfP", sh).value);
      if (!name) return toast("Bitte einen Namen eingeben.");
      if (!(k >= 0)) return toast("Bitte die kcal pro 100 g eingeben.");
      const s = num($("#pfS", sh).value);
      const prod = Object.assign(pr.key ? S.products[pr.key] : { key: "own:" + uid(), source: "own" }, {
        name, brand: $("#pfBrand", sh).value.trim(), k, p: p >= 0 ? p : 0,
        s: s > 0 ? s : null, u: s > 0 ? ($("#pfU", sh).value.trim() || "Stück") : null,
        barcode: $("#pfCode", sh).value.replace(/\D/g, "") || null
      });
      S.products[prod.key] = prod; save();
      toast("Produkt gespeichert");
      const f = foodFromProduct(prod);
      if (opts.onSaved) { if (opts.keepOpen) opts.onSaved(f); else closeLayers(1).then(() => opts.onSaved(f)); }
      else closeLayers(pr.key ? 2 : 1);
    };
    const del = $("#pfDel", sh);
    if (del) del.onclick = async () => {
      if (!(await confirmSheet("Produkt löschen?", "Bereits eingetragene Mahlzeiten bleiben erhalten.", "Löschen", true))) return;
      delete S.products[pr.key];
      S.favorites = S.favorites.filter((r) => r !== "p:" + pr.key);
      save(); closeLayers(2); render();
    };
  }

  // ---------- Gewicht ----------
  function openWeightEntry(k) {
    k = k || today();
    const cur = S.weights[k];
    const last = sortedWeights().filter((e) => e.k < k).pop();
    const sh = sheet(`
      <div class="sheet-head"><h2>Gewicht eintragen</h2></div>
      <label class="field">Datum<input class="input" id="wDate" type="date" value="${k}" max="${today()}"></label>
      <label class="field">Gewicht in kg<input class="input num" id="wKg" inputmode="decimal" value="${cur != null ? nfx.format(cur) : last ? nfx.format(last.w) : ""}" style="font-size:1.6rem;text-align:center"></label>
      <div class="hint">Am besten morgens nach dem Aufstehen wiegen, immer unter gleichen Bedingungen.</div>
      <button class="btn block" id="wSave">Speichern</button>
      ${cur != null ? `<button class="btn danger block" id="wDel">Eintrag löschen</button>` : ""}`);
    const inp = $("#wKg", sh);
    setTimeout(() => { inp.focus(); inp.select(); }, 250);
    $("#wSave", sh).onclick = () => {
      const w = num(inp.value), d = $("#wDate", sh).value || k;
      if (!(w > 25 && w < 400)) return toast("Bitte ein Gewicht in kg eingeben.");
      const before = trendSeries();
      const prevTrend = before.length ? before[before.length - 1].t : null;
      S.weights[d] = Math.round(w * 10) / 10;
      save(); closeLayers(1);
      const after = trendSeries(), nowTrend = after[after.length - 1].t;
      if (d === today() && prevTrend != null && nowTrend < prevTrend) {
        ui.moodOverride = "party"; ui.tab = "heute"; ui.date = today(); render();
        toast("Dein Trend geht runter. Super!");
        setTimeout(() => { ui.moodOverride = null; if (ui.tab === "heute") render(); }, 7000);
      } else { render(); toast("Gewicht gespeichert"); }
    };
    const del = $("#wDel", sh);
    if (del) del.onclick = () => { delete S.weights[k]; save(); closeLayers(1); render(); };
  }

  function forecast() {
    const p = S.profile, ser = trendSeries();
    if (!p.goalWeight || !ser.length) return null;
    const cur = ser[ser.length - 1].t;
    if (cur <= p.goalWeight) return { done: true };
    let rate = p.rate / 7, basis = "plan"; // kg pro Tag
    const lastK = ser[ser.length - 1].k;
    const recent = ser.filter((e) => e.k >= addDays(lastK, -28));
    const span = recent.length > 1 ? (parseKey(lastK) - parseKey(recent[0].k)) / 86400000 : 0;
    if (span >= 10 && recent.length >= 5) {
      const xs = recent.map((e) => (parseKey(e.k) - parseKey(recent[0].k)) / 86400000), ys = recent.map((e) => e.t);
      const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
      let num_ = 0, den = 0;
      xs.forEach((x, i) => { num_ += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
      const slope = den ? num_ / den : 0;
      if (slope < -0.005) { rate = -slope; basis = "real"; }
      else basis = "stall";
    }
    const days = Math.ceil((cur - p.goalWeight) / rate);
    const d = parseKey(today()); d.setDate(d.getDate() + days);
    return { done: false, date: d, days, rate: rate * 7, basis, left: cur - p.goalWeight };
  }

  function weightChart(range) {
    const ser = trendSeries();
    if (!ser.length) return `<div class="empty">Noch kein Gewicht eingetragen.</div>`;
    const lastK = ser[ser.length - 1].k;
    const from = range ? addDays(lastK, -range + 1) : ser[0].k;
    const pts = ser.filter((e) => e.k >= from);
    const W = 340, H = 200, L = 34, R = 12, T = 12, B = 24;
    const t0 = parseKey(pts[0].k).getTime(), t1 = Math.max(parseKey(lastK).getTime(), t0 + 86400000 * 6);
    const goal = S.profile.goalWeight;
    let lo = Math.min(...pts.map((e) => Math.min(e.w, e.t))), hi = Math.max(...pts.map((e) => Math.max(e.w, e.t)));
    if (goal && goal > lo - 3) lo = Math.min(lo, goal);
    lo = Math.floor(lo - 0.5); hi = Math.ceil(hi + 0.5);
    if (hi - lo < 4) { hi = lo + 4; }
    const step = hi - lo > 16 ? 5 : hi - lo > 8 ? 2 : 1;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const x = (k) => L + ((parseKey(k).getTime() - t0) / (t1 - t0)) * (W - L - R);
    const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
    let grid = "";
    for (let v = lo; v <= hi; v += step) grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`;
    const line = pts.map((e, i) => `${i ? "L" : "M"}${x(e.k).toFixed(1)} ${y(e.t).toFixed(1)}`).join(" ");
    const area = line + ` L${x(pts[pts.length - 1].k).toFixed(1)} ${H - B} L${x(pts[0].k).toFixed(1)} ${H - B}Z`;
    const dots = pts.map((e) => `<circle class="dot" cx="${x(e.k).toFixed(1)}" cy="${y(e.w).toFixed(1)}" r="3"/>`).join("");
    const g = goal && goal >= lo && goal <= hi ? `<line class="goal" x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}"/><text class="goal-l" x="${W - R}" y="${y(goal) - 5}" text-anchor="end">Ziel ${n1(goal)}</text>` : "";
    const last = pts[pts.length - 1];
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gewichtsverlauf">
      <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b4fe0" stop-opacity="0.22"/><stop offset="1" stop-color="#8b4fe0" stop-opacity="0"/></linearGradient></defs>
      ${grid}${g}<path class="area" d="${area}"/>${dots}<path class="trend" d="${line}"/>
      <circle class="end" cx="${x(last.k)}" cy="${y(last.t)}" r="6"/>
      <text class="axis" x="${L}" y="${H - 6}">${shortDate(pts[0].k)}</text>
      <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${shortDate(lastK)}</text>
    </svg>`;
  }

  function renderWeight() {
    const ser = trendSeries(), p = S.profile;
    const cur = ser.length ? ser[ser.length - 1] : null;
    const start = p.startWeight;
    const lost = cur ? start - cur.t : 0;
    const fc = forecast();
    let fcHtml = "";
    if (fc && fc.done) fcHtml = `<div class="forecast"><span class="em">🏆</span><div><b>Ziel erreicht!</b><span class="small">Dein Trend liegt bei deinem Zielgewicht. Wahnsinn!</span></div></div>`;
    else if (fc) fcHtml = `<div class="forecast"><span class="em">🔮</span><div><b>Ziel ca. am ${fc.date.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })}</b>
      <span class="small">${fc.basis === "real" ? `Bei deinem bisherigen Tempo von ${n1(fc.rate)} kg pro Woche.` : fc.basis === "stall" ? `Gerade tut sich wenig. Mit deinem geplanten Tempo (${n1(fc.rate)} kg pro Woche) wäre es dieses Datum.` : `Mit deinem geplanten Tempo von ${n1(fc.rate)} kg pro Woche. Nach 2 Wochen Wiegen rechne ich mit deinem echten Tempo.`} Noch ${n1(fc.left)} kg.</span></div></div>`;
    const rows = sortedWeights().reverse().slice(0, 30);
    app.innerHTML = `
      ${topbar("Gewicht")}
      <div class="view">
        <button class="btn block" id="wAdd">⚖️ Gewicht eintragen</button>
        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <h2 style="margin:0">Verlauf</h2>
            <div class="ranges">${[[30, "30 T"], [90, "90 T"], [0, "Alles"]].map(([v, l]) => `<button data-r="${v}" aria-pressed="${ui.range === v}">${l}</button>`).join("")}</div>
          </div>
          ${weightChart(ui.range)}
          <div class="small muted" style="margin-top:6px">Punkte = gewogen, Linie = geglätteter Trend</div>
        </section>
        <section class="kpis">
          <div class="kpi"><div class="k">Aktuell (Trend)</div><div class="v num">${cur ? n1(cur.t) : "–"} <small>kg</small></div></div>
          <div class="kpi"><div class="k">Abgenommen</div><div class="v num">${lost >= 0.05 ? "−" + n1(lost) : lost <= -0.05 ? "+" + n1(-lost) : n1(0)} <small>kg</small></div></div>
          <div class="kpi"><div class="k">Start</div><div class="v num">${n1(start)} <small>kg</small></div></div>
          <div class="kpi"><div class="k">Ziel</div><div class="v num">${p.goalWeight ? n1(p.goalWeight) : "–"} <small>kg</small></div></div>
        </section>
        ${fcHtml}
        <section class="card">
          <h2>Einträge</h2>
          ${rows.length ? `<div class="wlist">${rows.map((e, i) => {
            const prev = rows[i + 1];
            const diff = prev ? e.w - prev.w : null;
            return `<button class="wrow" data-k="${e.k}"><span>${esc(dayLabel(e.k))}</span><span class="num">${n1(e.w)} kg ${diff != null ? `<span class="diff ${diff < 0 ? "down" : diff > 0 ? "up" : ""} small">${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${n1(Math.abs(diff))}</span>` : ""}</span></button>`;
          }).join("")}</div>` : `<div class="empty">Trag dein erstes Gewicht ein. Danach siehst du hier deinen Verlauf.</div>`}
        </section>
      </div>`;
    bindTop();
    $("#wAdd").onclick = () => openWeightEntry(today());
    $$(".ranges button").forEach((b) => (b.onclick = () => { ui.range = +b.dataset.r; render(); }));
    $$(".wrow").forEach((b) => (b.onclick = () => openWeightEntry(b.dataset.k)));
  }

  // ---------- Woche ----------
  function renderWeek() {
    const end = addDays(today(), ui.weekOffset * 7);
    const keys = []; for (let i = 6; i >= 0; i--) keys.push(addDays(end, -i));
    const data = keys.map((k) => ({ k, t: dayTotals(k), g: goals(k).kcal, n: (S.days[k] || []).length }));
    const logged = data.filter((d) => d.n);
    const avg = logged.length ? logged.reduce((s, d) => s + d.t.k, 0) / logged.length : 0;
    const avgP = logged.length ? logged.reduce((s, d) => s + d.t.p, 0) / logged.length : 0;
    const deficit = logged.reduce((s, d) => s + (d.g - d.t.k), 0);
    const inGoal = logged.filter((d) => d.t.k <= d.g).length;
    const W = 340, H = 190, L = 8, R = 8, T = 14, B = 28;
    const maxV = Math.max(...data.map((d) => Math.max(d.t.k, d.g))) * 1.12 || 2000;
    const bw = (W - L - R) / 7;
    const y = (v) => T + (1 - v / maxV) * (H - T - B);
    const goalNow = goals(end).kcal;
    const bars = data.map((d, i) => {
      const x = L + i * bw + bw * 0.18, w = bw * 0.64;
      const cls = !d.n ? "bar-none" : d.t.k > d.g ? "bar-over" : "bar-ok";
      const v = d.n ? d.t.k : maxV * 0.04;
      const wd = parseKey(d.k).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
      return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - B - y(v)).toFixed(1)}" rx="7"/>
        ${d.n ? `<text class="axis" x="${(x + w / 2).toFixed(1)}" y="${(y(v) - 4).toFixed(1)}" text-anchor="middle">${n0(d.t.k)}</text>` : ""}
        <text class="axis ${d.k === today() ? "today-l" : ""}" x="${(x + w / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle">${wd}</text>`;
    }).join("");
    const kgEq = deficit / KCAL_PER_KG;
    app.innerHTML = `
      ${topbar("Woche")}
      <div class="view">
        <div class="datebar">
          <button id="wkPrev" aria-label="Vorherige Woche">‹</button>
          <div class="label">${shortDate(keys[0])} – ${shortDate(keys[6])}</div>
          <button id="wkNext" aria-label="Nächste Woche" ${ui.weekOffset >= 0 ? "disabled" : ""}>›</button>
        </div>
        <section class="card">
          <h2>Kalorien pro Tag</h2>
          <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kalorien der Woche">
            ${bars}
            <line class="goal-line" x1="${L}" x2="${W - R}" y1="${y(goalNow)}" y2="${y(goalNow)}"/>
          </svg>
          <div class="small muted">Gestrichelt = dein Tagesziel (${n0(goalNow)} kcal). Rot = drüber.</div>
        </section>
        <section class="kpis">
          <div class="kpi"><div class="k">Ø pro Tag</div><div class="v num">${logged.length ? n0(avg) : "–"} <small>kcal</small></div></div>
          <div class="kpi"><div class="k">Ø Eiweiß</div><div class="v num">${logged.length ? n0(avgP) : "–"} <small>g</small></div></div>
          <div class="kpi"><div class="k">Im Ziel</div><div class="v num">${inGoal} <small>von ${logged.length} Tagen</small></div></div>
          <div class="kpi"><div class="k">${deficit >= 0 ? "Defizit" : "Überschuss"}</div><div class="v num">${n0(Math.abs(deficit))} <small>kcal</small></div></div>
        </section>
        ${logged.length ? `<div class="forecast"><span class="em">${deficit >= 0 ? "🔥" : "🫶"}</span><div><b>${deficit >= 0 ? `≈ ${n1(kgEq)} kg Fett weniger` : "Diese Woche war mehr drin"}</b><span class="small">${deficit >= 0 ? `Rein rechnerisch aus ${n0(deficit)} kcal Defizit (7.700 kcal ≈ 1 kg).` : "Kein Problem. Eine Woche entscheidet nichts, der lange Trend zählt."}</span></div></div>` : `<div class="empty">In dieser Woche ist noch nichts eingetragen.</div>`}
      </div>`;
    bindTop();
    $("#wkPrev").onclick = () => { ui.weekOffset--; render(); };
    $("#wkNext").onclick = () => { if (ui.weekOffset < 0) { ui.weekOffset++; render(); } };
  }

  // ---------- Gerichte ----------
  function renderDishes() {
    const list = Object.values(S.dishes).sort((a, b) => a.name.localeCompare(b.name, "de"));
    app.innerHTML = `
      ${topbar("Gerichte")}
      <div class="view">
        <button class="btn block" id="dNew">+ Neues Gericht anlegen</button>
        <div class="small muted" style="padding:0 4px">Lege ein Gericht mit allen Zutaten an. Danach trägst du einfach deine Portion ein, in Gramm oder als Anteil.</div>
        ${list.length ? `<div class="list">${list.map((d) => {
          const f = foodFromDish(d);
          return `<div class="item" style="grid-template-columns:1fr auto"><span><span class="t">${esc(d.name)}</span><br>
            <span class="s">${d.ings.length} Zutaten · ${d.portions} Portionen${d.weight ? " · " + n0(f.k) + " kcal/100 g" : ""}</span></span>
            <span class="r num">${n0(d.kcal / d.portions)}<small>kcal/Portion</small></span>
            <div class="row" style="grid-column:1/-1"><button class="btn ghost" data-ed="${d.id}">Bearbeiten</button><button class="btn" data-log="${d.id}">Eintragen</button></div></div>`;
        }).join("")}</div>` : `<div class="card empty"><b>Noch keine Gerichte.</b><br>Zum Beispiel deine Bolognese oder dein Lieblings-Curry.</div>`}
      </div>`;
    bindTop();
    $("#dNew").onclick = () => openDishEditor(null);
    $$("[data-ed]").forEach((b) => (b.onclick = () => openDishEditor(b.dataset.ed)));
    $$("[data-log]").forEach((b) => (b.onclick = () => { ui.date = ui.date || today(); openAmount(foodFromDish(S.dishes[b.dataset.log])); }));
  }

  function openDishEditor(id) {
    const src = id ? S.dishes[id] : null;
    const draft = src ? JSON.parse(JSON.stringify(src)) : { id: uid(), name: "", ings: [], weight: null, portions: 4 };
    const sh = sheet(`<div id="dishBody" style="display:grid;gap:12px"></div>`);
    const body = $("#dishBody", sh);
    function totals() { return draft.ings.reduce((s, i) => { s.k += i.k; s.p += i.p; s.g += i.g; return s; }, { k: 0, p: 0, g: 0 }); }
    function paint() {
      const t = totals();
      const per = draft.portions > 0 ? t.k / draft.portions : 0;
      body.innerHTML = `
        <div class="sheet-head"><h2>${src ? "Gericht bearbeiten" : "Neues Gericht"}</h2></div>
        <label class="field">Name<input class="input" id="dName" value="${esc(draft.name)}" placeholder="z. B. Bolognese"></label>
        <div class="field" style="font-weight:800;font-size:.85rem;color:var(--ink-soft)">Zutaten</div>
        <div class="list">${draft.ings.map((i, n) => `<div class="ing"><span><span class="t">${esc(i.name)}</span><br><span class="s">${esc(amountText(i.qty, i.ul))}${i.brand ? " · " + esc(i.brand) : ""}</span></span><span class="num" style="font-weight:800">${n0(i.k)} kcal</span><button class="x" data-rm="${n}" aria-label="Entfernen">×</button></div>`).join("") || `<div class="small muted">Noch keine Zutaten.</div>`}</div>
        <button class="btn ghost block" id="dAddIng">+ Zutat hinzufügen</button>
        <div class="row">
          <label class="field">Portionen<input class="input num" id="dPort" inputmode="decimal" value="${nfx.format(draft.portions)}"></label>
          <label class="field">Fertiges Gewicht (g)<input class="input num" id="dWeight" inputmode="decimal" value="${draft.weight ? nfx.format(draft.weight) : ""}" placeholder="optional"></label>
        </div>
        <div class="hint">Wiege den fertigen Topf (ohne Topf) und trag das Gewicht ein. Dann kannst du später deinen Teller in Gramm eintragen. Rohes Gewicht der Zutaten: ${n0(t.g)} g.</div>
        <div class="calc">
          <div class="line"><span>Ganzes Gericht</span><span class="num">${n0(t.k)} kcal · ${n0(t.p)} g E</span></div>
          ${draft.weight ? `<div class="line"><span>Pro 100 g</span><span class="num">${n0((t.k / draft.weight) * 100)} kcal</span></div>` : ""}
          <div class="line total"><span>Pro Portion</span><span class="num">${n0(per)} kcal</span></div>
        </div>
        <button class="btn block" id="dSave">Gericht speichern</button>
        ${src ? `<button class="btn danger block" id="dDel">Gericht löschen</button>` : ""}`;
      $("#dName", body).oninput = (e) => (draft.name = e.target.value);
      $("#dPort", body).onchange = (e) => { const v = num(e.target.value); draft.portions = v > 0 ? v : 1; paint(); };
      $("#dWeight", body).onchange = (e) => { const v = num(e.target.value); draft.weight = v > 0 ? v : null; paint(); };
      $$("[data-rm]", body).forEach((b) => (b.onclick = () => { draft.ings.splice(+b.dataset.rm, 1); paint(); }));
      $("#dAddIng", body).onclick = () => openAdd({
        mode: "pick",
        onPick: (f, qty, unit) => {
          const c = calc(f, qty, unit);
          draft.ings.push({ ref: f.ref, name: f.name, brand: f.brand || "", qty, ul: c.unit.label, g: c.g, k: c.k, p: c.p });
          paint();
        }
      });
      $("#dSave", body).onclick = () => {
        if (!draft.name.trim()) return toast("Bitte gib dem Gericht einen Namen.");
        if (!draft.ings.length) return toast("Füge mindestens eine Zutat hinzu.");
        const t2 = totals();
        draft.name = draft.name.trim(); draft.kcal = t2.k; draft.prot = t2.p;
        S.dishes[draft.id] = draft; save(); closeLayers(1); render(); toast("Gericht gespeichert");
      };
      const del = $("#dDel", body);
      if (del) del.onclick = async () => {
        if (!(await confirmSheet("Gericht löschen?", "Bereits eingetragene Portionen bleiben erhalten.", "Löschen", true))) return;
        delete S.dishes[draft.id]; S.favorites = S.favorites.filter((r) => r !== "d:" + draft.id);
        save(); closeLayers(1); render();
      };
    }
    paint();
  }

  // ---------- Einstellungen ----------
  function profileFields(p) {
    return `
      <div class="row">
        <label class="field">Alter<input class="input num" id="pAge" inputmode="numeric" value="${p.age || ""}"></label>
        <label class="field">Größe (cm)<input class="input num" id="pHeight" inputmode="numeric" value="${p.height || ""}"></label>
      </div>
      <div class="row">
        <label class="field">Startgewicht (kg)<input class="input num" id="pStart" inputmode="decimal" value="${p.startWeight ? nfx.format(p.startWeight) : ""}"></label>
        <label class="field">Zielgewicht (kg)<input class="input num" id="pGoal" inputmode="decimal" value="${p.goalWeight ? nfx.format(p.goalWeight) : ""}"></label>
      </div>
      <label class="field">Alltag<select class="input" id="pAct">
        ${[[1.2, "Sitzend (Büro, wenig Bewegung)"], [1.375, "Leicht aktiv"], [1.55, "Aktiv (viel auf den Beinen)"], [1.725, "Sehr aktiv"]].map(([v, l]) => `<option value="${v}" ${p.activity === v ? "selected" : ""}>${l}</option>`).join("")}
      </select></label>
      <label class="field">Tempo<select class="input" id="pRate">
        ${[[0.25, "0,25 kg pro Woche (sanft)"], [0.5, "0,5 kg pro Woche (empfohlen)"], [0.75, "0,75 kg pro Woche (ehrgeizig)"]].map(([v, l]) => `<option value="${v}" ${p.rate === v ? "selected" : ""}>${l}</option>`).join("")}
      </select></label>`;
  }
  function readProfile(root, base) {
    const p = Object.assign({}, base);
    p.age = num($("#pAge", root).value); p.height = num($("#pHeight", root).value);
    p.startWeight = num($("#pStart", root).value); p.goalWeight = num($("#pGoal", root).value) || null;
    p.activity = num($("#pAct", root).value); p.rate = num($("#pRate", root).value);
    if (!(p.age >= 14 && p.age <= 100)) return { err: "Bitte dein Alter eingeben." };
    if (!(p.height >= 120 && p.height <= 230)) return { err: "Bitte deine Größe in cm eingeben." };
    if (!(p.startWeight >= 30 && p.startWeight <= 300)) return { err: "Bitte dein aktuelles Gewicht in kg eingeben." };
    return { p };
  }
  function calcBox(p) {
    const backup = S.profile; S.profile = p;
    const g = goals(today());
    S.profile = backup;
    return `<div class="calc">
      <div class="line"><span>Grundumsatz</span><span class="num">${n0(g.bmr)} kcal</span></div>
      <div class="line"><span>Verbrauch mit Alltag</span><span class="num">${n0(g.tdee)} kcal</span></div>
      <div class="line"><span>Defizit für ${nfx.format(p.rate)} kg/Woche</span><span class="num">− ${n0(g.deficit)} kcal</span></div>
      <div class="line total"><span>Dein Tagesziel</span><span class="num">${n0(g.kcal)} kcal</span></div>
      <div class="line"><span>Eiweißziel</span><span class="num">${n0(g.protein)} g</span></div>
      ${g.floored ? `<div class="small muted">Ich gehe nicht unter 1.200 kcal, damit du genug Nährstoffe bekommst.</div>` : ""}
    </div>`;
  }

  function openSettings() {
    const p = S.profile;
    const sh = sheet(`
      <div class="sheet-head"><h2>Einstellungen</h2></div>
      <label class="field">Name deines Monsters<input class="input" id="pName" value="${esc(p.monsterName || "")}"></label>
      ${profileFields(p)}
      <div class="row">
        <label class="field">Eigenes kcal-Ziel<input class="input num" id="pKcal" inputmode="numeric" value="${p.kcalOverride || ""}" placeholder="automatisch"></label>
        <label class="field">Eigenes Eiweißziel (g)<input class="input num" id="pProt" inputmode="numeric" value="${p.proteinOverride || ""}" placeholder="automatisch"></label>
      </div>
      <div id="calcBox">${calcBox(p)}</div>
      <button class="btn block" id="pSave">Speichern</button>
      <div class="card" style="display:grid;gap:10px">
        <h2 style="margin:0">Deine Daten</h2>
        <div class="small muted">Alles ist nur auf diesem Handy gespeichert. Mach ab und zu ein Backup, z. B. in Google Drive.${S.meta.lastBackup ? ` Letztes Backup: ${new Date(S.meta.lastBackup).toLocaleDateString("de-DE")}.` : " Noch kein Backup gemacht."}</div>
        <button class="btn pink block" id="bExport">💾 Backup speichern</button>
        <label class="btn ghost block" style="text-align:center">📂 Backup laden<input type="file" id="bImport" accept="application/json,.json" hidden></label>
        <button class="btn ghost block" id="bProducts">Eigene Produkte verwalten</button>
        <button class="btn danger block" id="bReset">Alles löschen</button>
      </div>`);
    const live = () => { const r = readProfile(sh, p); if (r.p) { r.p.kcalOverride = num($("#pKcal", sh).value) || null; r.p.proteinOverride = num($("#pProt", sh).value) || null; $("#calcBox", sh).innerHTML = calcBox(r.p); } };
    $$("input,select", sh).forEach((i) => { if (i.type !== "file") i.addEventListener("change", live); });
    $("#pSave", sh).onclick = () => {
      const r = readProfile(sh, p);
      if (r.err) return toast(r.err);
      r.p.monsterName = $("#pName", sh).value.trim() || "Plüschi";
      r.p.kcalOverride = num($("#pKcal", sh).value) || null;
      r.p.proteinOverride = num($("#pProt", sh).value) || null;
      S.profile = r.p; save(); closeLayers(1); render(); toast("Gespeichert");
    };
    $("#bExport", sh).onclick = exportBackup;
    $("#bImport", sh).onchange = (e) => importBackup(e.target.files[0]);
    $("#bProducts", sh).onclick = openProductList;
    $("#bReset", sh).onclick = async () => {
      if (!(await confirmSheet("Wirklich alles löschen?", "Alle Einträge, Gewichte, Produkte und Gerichte sind danach weg. Mach vorher besser ein Backup.", "Alles löschen", true))) return;
      S = emptyState(); save(); ob = { step: 0, name: "", p: { activity: 1.2, rate: 0.5, sex: "f" } };
      closeLayers(stack.length).then(render);
    };
  }

  function openProductList() {
    const own = Object.values(S.products).filter((p) => p.source === "own").sort((a, b) => a.name.localeCompare(b.name, "de"));
    const sh = sheet(`<div class="sheet-head"><h2>Eigene Produkte</h2></div>
      <div class="list">${own.map((p) => `<button class="item" data-k="${esc(p.key)}"><span><span class="t">${esc(p.name)}</span><br><span class="s">${esc(p.brand || "")}${p.barcode ? " · " + esc(p.barcode) : ""}</span></span><span class="r num">${n0(p.k)}<small>kcal/100 g</small></span></button>`).join("") || `<div class="empty small">Noch keine eigenen Produkte.</div>`}</div>`);
    $$(".item", sh).forEach((b) => (b.onclick = () => openProductForm({ product: S.products[b.dataset.k] })));
  }

  async function exportBackup() {
    S.meta.lastBackup = Date.now(); save();
    const json = JSON.stringify(S);
    const name = `abnehm-backup-${today()}.json`;
    const blob = new Blob([json], { type: "application/json" });
    try {
      const file = new File([blob], name, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Abnehm-Backup" });
        toast("Backup geteilt"); render(); return;
      }
    } catch (e) { if (e && e.name === "AbortError") { return; } }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Backup heruntergeladen");
    render();
  }
  async function importBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || !data.days || !data.profile) throw new Error("format");
      if (!(await confirmSheet("Backup laden?", "Deine aktuellen Daten auf diesem Handy werden durch das Backup ersetzt.", "Laden"))) return;
      S = Object.assign(emptyState(), data); save();
      closeLayers(stack.length).then(() => { render(); toast("Backup geladen"); });
    } catch (e) {
      toast("Diese Datei ist kein gültiges Backup.");
    }
  }

  // ---------- Einrichtung ----------
  let ob = { step: 0, name: "", p: { activity: 1.2, rate: 0.5, sex: "f" } };
  function renderOnboarding() {
    const dots = `<div class="dots">${[0, 1, 2].map((i) => `<i class="${i === ob.step ? "on" : ""}"></i>`).join("")}</div>`;
    if (ob.step === 0) {
      app.innerHTML = `<div class="onboard">
        <button class="monster" id="obMon" aria-label="Monster"></button>
        <h1>Hallo! Ich bin dein neues Plüschmonster.</h1>
        <p>Ich begleite dich beim Abnehmen. Wie soll ich heißen?</p>
        <input class="input" id="obName" placeholder="Name für mich" value="${esc(ob.name)}" style="text-align:center;font-size:1.2rem">
        <button class="btn block" id="obNext">Weiter</button>${dots}</div>`;
      const m = $("#obMon"); Monster.render(m); Monster.setMood(m, "happy");
      m.onclick = () => { m.classList.remove("poke"); void m.offsetWidth; m.classList.add("poke"); };
      $("#obNext").onclick = () => { ob.name = $("#obName").value.trim() || "Plüschi"; ob.step = 1; render(); };
    } else if (ob.step === 1) {
      app.innerHTML = `<div class="onboard">
        <h1>Erzähl ${esc(ob.name)} von dir</h1>
        <p>Damit kann ich ausrechnen, wie viel du am Tag essen darfst.</p>
        <div class="card" style="display:grid;gap:12px">${profileFields(ob.p)}</div>
        <div class="row"><button class="btn ghost" id="obBack">Zurück</button><button class="btn" id="obNext">Weiter</button></div>${dots}</div>`;
      $("#obBack").onclick = () => { ob.step = 0; render(); };
      $("#obNext").onclick = () => {
        const r = readProfile(app, ob.p);
        if (r.err) return toast(r.err);
        ob.p = r.p; ob.step = 2; render();
      };
    } else {
      const p = Object.assign({}, ob.p, { monsterName: ob.name });
      app.innerHTML = `<div class="onboard">
        <button class="monster" id="obMon" aria-label="Monster"></button>
        <h1>Dein Plan steht!</h1>
        ${calcBox(p)}
        <p class="small">Du kannst alles später in den Einstellungen ändern.</p>
        <div class="row"><button class="btn ghost" id="obBack">Zurück</button><button class="btn pink" id="obGo">Los geht's!</button></div>${dots}</div>`;
      const m = $("#obMon"); Monster.render(m); Monster.setMood(m, "party");
      setTimeout(() => Monster.confetti(m), 200);
      $("#obBack").onclick = () => { ob.step = 1; render(); };
      $("#obGo").onclick = () => {
        p.createdAt = Date.now();
        S.profile = p;
        S.weights[today()] = S.weights[today()] || Math.round(p.startWeight * 10) / 10;
        save(); ui.tab = "heute"; render();
      };
    }
  }

  // ================= Start =================
  $$(".tab").forEach((t) => (t.onclick = () => { ui.tab = t.dataset.tab; if (ui.tab === "heute") ui.date = ui.date || today(); window.scrollTo(0, 0); render(); }));
  $("#fab").onclick = () => openAdd();
  // nach Mitternacht oder nach längerer Pause auf "Heute" springen
  let lastSeen = today();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && today() !== lastSeen) { if (ui.date === lastSeen) ui.date = today(); lastSeen = today(); render(); }
  });
  render();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
