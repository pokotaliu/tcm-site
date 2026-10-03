/* 筆記專區互動：篩選、批註／螢光筆開關、章節目錄、手繪標註、心智圖（可收合）、關聯圖、連結懸停預覽。
   手繪筆觸借 rough.js（rough-stuff/rough）與 rough-notation（rough-stuff/rough-notation），皆 MIT、放 static/vendor；
   關聯圖與預覽卡的互動參照 Quartz（jackyzha0/quartz）的 graph view／popover，心智圖的由大綱長樹參照 markmap。
   兩個函式庫沒載到時一律退回純 SVG／CSS，內容不受影響。資料＝頁面內 #nb-data（app.py 組好的 JSON）。 */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NS = "http://www.w3.org/2000/svg";

  /* 站台可能掛在子路徑（GitHub Pages）：由本檔 script src 反推 base（同 site.js 作法）；JSON 裡的站內網址要補上 */
  var BASE = (function () {
    var ss = document.getElementsByTagName("script");
    for (var i = 0; i < ss.length; i++) {
      var src = ss[i].getAttribute("src") || "";
      if (/\/static\/notes\.js(\?.*)?$/.test(src)) return src.replace(/\/static\/notes\.js(\?.*)?$/, "");
    }
    return "";
  })();
  var U = function (p) { return p && p.charAt(0) === "/" ? BASE + p : p; };
  var NB = (function () { var e = $("#nb-data"); try { return e ? JSON.parse(e.textContent) : {}; } catch (x) { return {}; } })();
  var REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var HOVER = window.matchMedia && window.matchMedia("(hover: hover)").matches;
  /* 墨水色：筆記紅筆、證型藍、症狀綠、中藥土黃、疾病紫、未建灰（CSS 的 .k-* 同色） */
  var INK = { "筆記": "#B3261E", "證型": "#2B4C8C", "症狀": "#2f6f6a", "中藥": "#8a6d00", "疾病": "#5b4b9a", "未建": "#8b8f99" };
  var BR = ["#1F2C4D", "#2f6f6a", "#B3261E", "#8a6d00", "#5b4b9a"];   /* 心智圖枝色（.mm-link.b0–b4 同序） */
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e); return e;
  }
  function seedOf(s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647; return h || 1; }
  function rc(svg) { return window.rough ? window.rough.svg(svg) : null; }

  /* 章節目錄 */
  var toc = $("#toc");
  if (toc) {
    $$(".sheet[data-title]").forEach(function (sh) {
      var a = document.createElement("a");
      a.href = "#" + sh.id; a.textContent = sh.getAttribute("data-title");
      toc.appendChild(a);
    });
    if ($("#mindmap-sheet")) {
      var a0 = document.createElement("a"); a0.href = "#mindmap-sheet"; a0.textContent = "心智圖";
      toc.insertBefore(a0, toc.firstChild);
    }
  }

  /* 批註／螢光筆開關 */
  function toggle(btn, cls) {
    if (!btn) return;
    btn.addEventListener("click", function () {
      var on = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-pressed", on ? "false" : "true");
      document.body.classList.toggle(cls, on);
      marksSync();
    });
  }
  toggle($("#t-note"), "hide-note");
  toggle($("#t-hl"), "hide-hl");

  /* 即時篩選：表格列、條列、批註；關鍵字以空白分隔（AND） */
  var inp = $("#nfilter"), hit = $("#nhit");
  if (inp) {
    var units = $$(".note-body tbody tr, .note-body li, .note-body blockquote, .note-body p.note");
    inp.addEventListener("input", function () {
      var ks = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean), n = 0;
      units.forEach(function (u) {
        var ok = !ks.length || ks.every(function (k) { return u.textContent.toLowerCase().indexOf(k) >= 0; });
        u.classList.toggle("nf-hide", !ok);
        if (ok && ks.length) n++;
      });
      $$(".note-body .sheet").forEach(function (sh) {
        var any = $$("tbody tr, li, blockquote, p.note", sh).some(function (u) { return !u.classList.contains("nf-hide"); });
        sh.classList.toggle("nf-dim", ks.length > 0 && !any);
      });
      hit.textContent = ks.length ? "符合 " + n + " 項" : "";
      marksSync();
    });
  }

  /* 手繪標註（rough-notation）：==黃螢光== ++綠螢光++ ^^紅筆底線^^ !!紅筆圈!!——捲到眼前才「畫」上去。
     標註是貼在紙上的絕對定位 SVG：篩選隱藏、開關、版面位移後要重畫（marksSync），否則筆跡會留在原處。 */
  var MARKS = [];
  var MARK_CFG = {
    hl:  { type: "highlight", color: "rgba(255, 214, 51, .55)", multiline: true, iterations: 1, animationDuration: 650 },
    hl2: { type: "highlight", color: "rgba(110, 196, 140, .42)", multiline: true, iterations: 1, animationDuration: 650 },
    ul:  { type: "underline", color: "#B3261E", strokeWidth: 1.8, multiline: true, iterations: 2, padding: 1, animationDuration: 500 },
    ci:  { type: "circle", color: "#B3261E", strokeWidth: 1.6, padding: [3, 7], iterations: 2, animationDuration: 700 }
  };
  function marksSync() {
    if (!MARKS.length) return;
    var off = document.body.classList.contains("hide-hl");
    MARKS.forEach(function (m) {
      var vis = !off && m.el.offsetParent !== null && m.seen;
      m.a.hide();
      if (vis) { m.a.animate = false; m.a.show(); }
    });
  }
  function marksInit() {
    if (!window.RoughNotation) return;                      /* 沒載到＝留 CSS 色塊版 */
    var els = $$(".note-body .hl, .note-body .hl2, .note-body .ul, .note-body .ci");
    if (!els.length) return;
    document.body.classList.add("rn");
    els.forEach(function (e) {
      var k = ["hl", "hl2", "ul", "ci"].filter(function (c) { return e.classList.contains(c); })[0];
      var cfg = {}; Object.keys(MARK_CFG[k]).forEach(function (x) { cfg[x] = MARK_CFG[k][x]; });
      cfg.animate = !REDUCE;
      MARKS.push({ el: e, a: window.RoughNotation.annotate(e, cfg), seen: false });
    });
    var reveal = function (m) {
      m.seen = true;
      if (!document.body.classList.contains("hide-hl") && m.el.offsetParent !== null) m.a.show();
    };
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) {
          if (!en.isIntersecting) return;
          MARKS.forEach(function (m) { if (m.el === en.target) reveal(m); });
          io.unobserve(en.target);
        });
      }, { rootMargin: "0px 0px -10% 0px" });
      MARKS.forEach(function (m) { io.observe(m.el); });
    } else { MARKS.forEach(reveal); }
  }
  /* 手寫字型（Iansui）晚到會改字寬——等字型就緒再上標註，免得筆跡錯位 */
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(marksInit);

  /* ── 心智圖（rough.js 手繪；markmap 式由大綱長樹、可收合）────────────────────
     節點文字可含 [[目標|顯示字]]：顯示字變藍、點字前往；點框（或右側＋／−）收合。 */
  var svg = $("#mm");
  if (svg && NB.mm) {
    var root = NB.mm, LINKS = NB.links || {};
    var WRAP = 11, LH = 20, PADX = 12, PADY = 8, GAPX = 46, GAPY = 12;
    var WL = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    (function init(n, d, br) {
      n.d = d; n.br = br; n.open = d < 2;
      var m, url = null, plain = n.t.replace(WL, function (all, t, lab) { url = url || LINKS[t.trim()] || null; return (lab || t).trim(); });
      n.plain = plain; n.url = url;
      n.c.forEach(function (c, i) { init(c, d + 1, d === 0 ? i : br); });
    })(root, 0, 0);
    function lines(t) { var o = []; for (var i = 0; i < t.length; i += WRAP) o.push(t.slice(i, i + WRAP)); return o; }
    function render() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var R = rc(svg), colW = [], cursor = 10;
      (function measure(n) {
        n.ls = lines(n.plain);
        n.w = Math.max.apply(null, n.ls.map(function (s) { return s.length; })) * 16 + PADX * 2 + (n.c.length ? 14 : 0) + (n.url ? 12 : 0);
        n.h = n.ls.length * LH + PADY * 2;
        colW[n.d] = Math.max(colW[n.d] || 0, n.w);
        if (n.open) n.c.forEach(measure);
      })(root);
      var colX = [10]; for (var i = 1; i < colW.length; i++) colX[i] = colX[i - 1] + colW[i - 1] + GAPX;
      (function place(n) {
        n.x = colX[n.d];
        if (n.open && n.c.length) {
          n.c.forEach(place);
          n.y = (n.c[0].y + n.c[n.c.length - 1].y) / 2;
        } else { n.y = cursor + n.h / 2; cursor += n.h + GAPY; }
      })(root);
      var maxX = 0, gL = el("g", {}, svg), gN = el("g", {}, svg);
      (function draw(n) {
        maxX = Math.max(maxX, n.x + n.w);
        if (n.open) n.c.forEach(function (c) {
          var x1 = n.x + n.w, y1 = n.y, x2 = c.x, y2 = c.y, mx = (x1 + x2) / 2;
          var d = "M" + x1 + " " + y1 + " C" + mx + " " + y1 + " " + mx + " " + y2 + " " + x2 + " " + y2;
          if (R) {
            var p = R.path(d, { stroke: BR[c.br % 5], strokeWidth: c.d === 1 ? 2.4 : 1.6, roughness: 1.1, bowing: 1.4, seed: seedOf(c.t) });
            p.setAttribute("class", "mm-link rough"); gL.appendChild(p);
          } else el("path", { d: d, "class": "mm-link b" + (c.br % 5), filter: "url(#rough)" }, gL);
          draw(c);
        });
        var g = el("g", { "class": "mm-node d" + Math.min(n.d, 3) + " b" + (n.br % 5) + (n.c.length ? " has" : "") + (R ? " rough" : ""),
                          transform: "translate(" + n.x + "," + (n.y - n.h / 2) + ")", tabindex: n.c.length ? "0" : null,
                          role: n.c.length ? "button" : null, "aria-expanded": n.c.length ? String(n.open) : null }, gN);
        if (R) {
          var fill = n.d === 0 ? "rgba(110,196,140,.55)" : n.d === 1 ? "rgba(255,214,51,.5)" : "#fff";
          var box = R.rectangle(1, 1, n.w - 2, n.h - 2, {
            stroke: n.d === 0 ? "#B3261E" : "#1F2C4D", strokeWidth: n.d === 0 ? 2.2 : 1.5, roughness: 1.2,
            fill: fill, fillStyle: n.d === 0 ? "hachure" : "solid", hachureGap: 5, fillWeight: 1.4, seed: seedOf(n.t) });
          box.setAttribute("class", "mm-box"); g.appendChild(box);
        } else el("rect", { width: n.w, height: n.h, rx: 9, filter: "url(#rough)" }, g);
        var tx = el("g", { "class": n.url ? "mm-wl" : null }, g);
        n.ls.forEach(function (s, i) { var t = el("text", { x: PADX, y: PADY + LH * (i + 0.72) }, tx); t.textContent = s; });
        if (n.url) {
          var go = el("text", { x: n.w - PADX - (n.c.length ? 14 : 0), y: PADY + LH * 0.72, "class": "mm-go" }, g); go.textContent = "↗";
          var jump = function (e) { e.stopPropagation(); window.location.href = U(n.url); };
          tx.addEventListener("click", jump); go.addEventListener("click", jump);
          el("title", {}, tx).textContent = "前往：" + n.plain;
        }
        if (n.c.length) {
          var m = el("text", { x: n.w - 16, y: n.h / 2 + 5, "class": "mm-mark" }, g);
          m.textContent = n.open ? "−" : "＋";
          var act = function () { n.open = !n.open; render(); };
          g.addEventListener("click", act);
          g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
        }
      })(root);
      var H = Math.max(cursor, 60), W = maxX + 14;
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.setAttribute("width", W); svg.setAttribute("height", H);
    }
    function setAll(v) { (function f(n) { if (n.c.length) { n.open = v || n.d === 0; n.c.forEach(f); } })(root); render(); }
    var bo = $("#mm-open"), bc = $("#mm-close");
    if (bo) bo.addEventListener("click", function () { setAll(true); });
    if (bc) bc.addEventListener("click", function () { setAll(false); });
    render();
  }

  /* ── 關聯圖（Quartz graph view 同型：本篇一層鄰居／全域）──────────────────
     自寫的小力導引：固定初始位置＋固定步數，每次載入長得一樣；筆跡用 rough.js。 */
  var gv = $("#gv");
  if (gv && NB.graph && NB.graph.nodes.length) {
    var N = NB.graph.nodes, L = NB.graph.links, deg = N.map(function () { return 0; });
    L.forEach(function (l) { deg[l[0]]++; deg[l[1]]++; });
    var P = N.map(function (n, i) {
      var a = i * 2.39996, r = n.me ? 0 : 30 + 9 * Math.sqrt(i);          /* 黃金角螺旋：決定性初始位置 */
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 };
    });
    var GLOBAL = !N.some(function (n) { return n.me; });            /* 全域圖：筆記彼此推遠、共用節點夾在中間 */
    var LINK = GLOBAL ? 104 : 78, REP = GLOBAL ? 4200 : 2600, CEN = 0.012;
    for (var it = 0; it < 420; it++) {
      var cool = 1 - it / 420;
      for (var i = 0; i < P.length; i++) for (var j = i + 1; j < P.length; j++) {
        var dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
        var f = REP * (N[i].kind === "筆記" && N[j].kind === "筆記" ? 5 : 1) / d2;
        P[i].vx -= f * dx / d; P[i].vy -= f * dy / d; P[j].vx += f * dx / d; P[j].vy += f * dy / d;
      }
      L.forEach(function (l) {
        var a = P[l[0]], b = P[l[1]], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - LINK) * 0.04;
        a.vx += f * dx / d; a.vy += f * dy / d; b.vx -= f * dx / d; b.vy -= f * dy / d;
      });
      P.forEach(function (p, k) {
        p.vx -= p.x * CEN; p.vy -= p.y * CEN;
        if (N[k].me) { p.vx = 0; p.vy = 0; p.x = 0; p.y = 0; }
        p.x += Math.max(-12, Math.min(12, p.vx)) * cool; p.y += Math.max(-12, Math.min(12, p.vy)) * cool;
        p.vx *= 0.6; p.vy *= 0.6;
      });
    }
    var rad = function (k) { return (N[k].me ? 11 : 5) + 2.2 * Math.sqrt(deg[k]); };
    /* 標籤防重疊：每個節點連同標籤當一個框（本篇標題在圓點上方、其餘在下方），重疊就沿較淺的軸推開；本篇固定不動 */
    var box = function (k) {
      var r = rad(k), w = Math.max(28, N[k].label.length * (N[k].kind === "筆記" ? 14 : 12.5)) + 6;
      return N[k].me ? { w: w, h: 2 * r + 24, cy: P[k].y - 12 } : { w: w, h: 2 * r + 22, cy: P[k].y + 11 };
    };
    for (var pass = 0; pass < 240; pass++) {
      var moved = false;
      for (var i2 = 0; i2 < P.length; i2++) for (var j2 = i2 + 1; j2 < P.length; j2++) {
        var A = box(i2), B = box(j2), ox = (A.w + B.w) / 2 - Math.abs(P[i2].x - P[j2].x), oy = (A.h + B.h) / 2 - Math.abs(A.cy - B.cy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        var fi = N[i2].me ? 0 : (N[j2].me ? 1 : 0.5), fj = 1 - fi;
        if (ox < oy) { var sx = P[i2].x < P[j2].x ? -1 : 1; P[i2].x += sx * ox * fi; P[j2].x -= sx * ox * fj; }
        else { var sy = A.cy < B.cy ? -1 : 1; P[i2].y += sy * oy * fi; P[j2].y -= sy * oy * fj; }
      }
      if (!moved) break;
    }
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    P.forEach(function (p, k) { var w = Math.max(40, N[k].label.length * 14) / 2;
      x0 = Math.min(x0, p.x - w); x1 = Math.max(x1, p.x + w);
      y0 = Math.min(y0, p.y - rad(k) - (N[k].me ? 26 : 0)); y1 = Math.max(y1, p.y + rad(k) + 20); });
    var pad = 14;
    gv.setAttribute("viewBox", (x0 - pad) + " " + (y0 - pad) + " " + (x1 - x0 + 2 * pad) + " " + (y1 - y0 + 2 * pad));
    var R = rc(gv), gE = el("g", { "class": "gv-edges" }, gv), gNd = el("g", { "class": "gv-nodes" }, gv);
    var edgeEls = L.map(function (l, k) {
      var a = P[l[0]], b = P[l[1]], e;
      if (R) { e = R.line(a.x, a.y, b.x, b.y, { stroke: "#1F2C4D", strokeWidth: 1.2, roughness: 0.9, seed: k + 3 }); gE.appendChild(e); }
      else e = el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, gE);
      e.setAttribute("class", "gv-edge"); return e;
    });
    var nbr = N.map(function () { return []; });
    L.forEach(function (l, k) { nbr[l[0]].push([l[1], k]); nbr[l[1]].push([l[0], k]); });
    N.forEach(function (n, k) {
      var p = P[k], ink = INK[n.kind] || INK["未建"], r = rad(k);
      var g = el("g", { "class": "gv-node" + (n.me ? " me" : "") + (n.url ? " go" : ""), tabindex: n.url ? "0" : null,
                        role: n.url ? "link" : null, "aria-label": n.kind + "：" + n.label }, gNd);
      if (R) {
        var shape = R.circle(p.x, p.y, r * 2, {
          stroke: ink, strokeWidth: n.me ? 2.4 : 1.6, roughness: 1.3, seed: seedOf(n.id),
          fill: n.kind === "未建" ? "none" : ink, fillStyle: n.kind === "筆記" ? "solid" : "hachure", hachureGap: 3.2, fillWeight: 1.1,
          strokeLineDash: n.kind === "未建" ? [3, 3] : undefined });
        g.appendChild(shape);
      } else el("circle", { cx: p.x, cy: p.y, r: r, fill: n.kind === "未建" ? "none" : ink, stroke: ink }, g);
      el("circle", { cx: p.x, cy: p.y, r: r + 6, "class": "gv-hit" }, g);
      var t = el("text", { x: p.x, y: n.me ? p.y - r - 8 : p.y + r + 15, "class": "gv-label" + (n.kind === "筆記" ? " note" : "") + (n.me ? " me" : "") }, g);
      t.textContent = n.label;
      el("title", {}, g).textContent = n.kind + "：" + n.label;
      var on = function (v) {
        gv.classList.toggle("focus", v); g.classList.toggle("on", v);
        nbr[k].forEach(function (q) { gNd.children[q[0]].classList.toggle("on", v); edgeEls[q[1]].classList.toggle("on", v); });
      };
      g.addEventListener("mouseenter", function () { on(true); }); g.addEventListener("mouseleave", function () { on(false); });
      g.addEventListener("focus", function () { on(true); }); g.addEventListener("blur", function () { on(false); });
      if (n.url) {
        var go = function () { window.location.href = U(n.url); };
        g.addEventListener("click", go);
        g.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      }
    });
  }

  /* ── 連結懸停預覽（Quartz popover 同型；資料內嵌、不跨頁抓）─────────────── */
  var pv = $("#pv"), PV = {};
  Object.keys(NB.previews || {}).forEach(function (k) { PV[decodeURI(k)] = NB.previews[k]; });
  if (pv && HOVER && Object.keys(PV).length) {
    var timer = null;
    var keyOf = function (a) {
      var h = a.getAttribute("href") || "";
      if (BASE && h.indexOf(BASE) === 0) h = h.slice(BASE.length);
      try { return decodeURI(h.split("#")[0]); } catch (x) { return h.split("#")[0]; }
    };
    var hide = function () { clearTimeout(timer); pv.hidden = true; };
    var show = function (a) {
      var d = PV[keyOf(a)];
      if (!d) return;
      pv.innerHTML = "";
      var k = document.createElement("span"); k.className = "pv-k " + ({ "筆記": "k-note", "證型": "k-zx", "症狀": "k-sx", "中藥": "k-herb", "疾病": "k-dz" }[d.k] || "");
      k.textContent = d.k; pv.appendChild(k);
      var t = document.createElement("strong"); t.textContent = d.t; pv.appendChild(t);
      if (d.s) { var s = document.createElement("p"); s.textContent = d.s; pv.appendChild(s); }
      pv.hidden = false;
      var r = a.getBoundingClientRect(), w = pv.offsetWidth, h = pv.offsetHeight;
      var x = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      var y = r.bottom + 8 + h > window.innerHeight ? r.top - h - 8 : r.bottom + 8;
      pv.style.left = (x + window.scrollX) + "px"; pv.style.top = (y + window.scrollY) + "px";
    };
    $$("a.wl").forEach(function (a) {
      a.addEventListener("mouseenter", function () { clearTimeout(timer); timer = setTimeout(function () { show(a); }, 220); });
      a.addEventListener("mouseleave", hide);
      a.addEventListener("focus", function () { show(a); });
      a.addEventListener("blur", hide);
    });
    window.addEventListener("scroll", hide, { passive: true });
  }

  /* 書本專區書目：篩選時自動展開、全部展開／收合、只看已寫 */
  var btOpen = $("#bt-open"), btDone = $("#bt-done");
  if (btOpen || btDone) {
    var dets = $$(".btoc details"), allOpen = false;
    var fi = $("#nfilter");
    if (fi) fi.addEventListener("input", function () {
      if (fi.value.trim()) dets.forEach(function (d) { d.open = true; });
    });
    if (btOpen) btOpen.addEventListener("click", function () {
      allOpen = !allOpen;
      dets.forEach(function (d) { d.open = allOpen || d.parentNode.classList.contains("has"); });
      btOpen.textContent = allOpen ? "全部收合" : "全部展開";
    });
    if (btDone) btDone.addEventListener("click", function () {
      var on = document.body.classList.toggle("only-done");
      btDone.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
})();
