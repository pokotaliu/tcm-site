/* 診斷引擎（前端移植版）——db.py diagnose() 的逐行對譯。
 *
 * 鐵律：這支不是「另一套演算法」，是同一套演算法的第二個實作。任何計分規則的修改
 * 都必須先改 db.py（真相源）再同步本檔，並由 parity 測試（test_parity.js）驗證
 * 兩邊排名與分數完全一致；parity 不過＝不准上站（build 會擋）。
 *
 * 資料來源＝build_site.py 匯出的 data/diagnose.json（欄位與 db 表一一對應）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TCM = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── 名稱正規化（db.py normalize／_name_candidates） ───────────────────────
  function normalize(名, 異體) {
    let out = "";
    for (const ch of 名) out += (異體[ch] !== undefined ? 異體[ch] : ch);
    return out;
  }

  function nameCandidates(名, 異體) {
    const base = normalize(名, 異體);
    const cands = [名, base,
      base.replace(/裡/g, "里"), base.replace(/里/g, "裡"),
      base.replace(/氾/g, "泛"), base.replace(/泛/g, "氾")];
    const seen = new Set(), out = [];
    for (const c of cands) if (!seen.has(c)) { seen.add(c); out.push(c); }
    return out;
  }

  // ── 索引（載入一次） ──────────────────────────────────────────────────────
  function 建索引(D) {
    if (D._ix) return D._ix;
    const 名到id = new Map(), 子表 = new Map(), 類別map = new Map();
    for (const sid in D.症狀) {
      const [名, 父, 類別] = D.症狀[sid];
      const id = +sid;
      名到id.set(名, id);
      if (類別 && 類別 !== "症狀") 類別map.set(id, 類別);
      if (父 !== null && 父 !== undefined) {
        if (!子表.has(父)) 子表.set(父, []);
        子表.get(父).push(id);
      }
    }
    const 次父_由次父 = new Map(), 次父_由子 = new Map();
    for (const [sid, 次父id] of D.次父) {
      if (!次父_由次父.has(次父id)) 次父_由次父.set(次父id, []);
      次父_由次父.get(次父id).push(sid);
      if (!次父_由子.has(sid)) 次父_由子.set(sid, []);
      次父_由子.get(sid).push(次父id);
    }
    const 成分_由成分 = new Map(), 成分_由複合 = new Map();
    for (const row of D.成分) {
      const [複, 成] = row;
      if (!成分_由成分.has(成)) 成分_由成分.set(成, []);
      成分_由成分.get(成).push(row);
      if (!成分_由複合.has(複)) 成分_由複合.set(複, []);
      成分_由複合.get(複).push(row);
    }
    const 鄰居表 = new Map();
    for (const [a, b, 關係, 辨眼] of D.鄰居) {
      if (!鄰居表.has(a)) 鄰居表.set(a, []);
      鄰居表.get(a).push([b, 關係, 辨眼]);
      if (!鄰居表.has(b)) 鄰居表.set(b, []);
      鄰居表.get(b).push([a, 關係, 辨眼]);
    }
    D._ix = { 名到id, 子表, 類別map, 次父_由次父, 次父_由子, 成分_由成分, 成分_由複合, 鄰居表 };
    return D._ix;
  }

  function resolveSymptom(D, 名) {
    const ix = 建索引(D);
    for (const cand of nameCandidates(名, D.異體)) {
      if (ix.名到id.has(cand)) return ix.名到id.get(cand);
      if (D.別名[cand] !== undefined) return D.別名[cand];
    }
    return null;
  }

  function resolveDegree(D, 名) {
    for (const cand of nameCandidates(名, D.異體)) {
      if (D.程度[cand] !== undefined) return D.程度[cand];
    }
    return null;
  }

  // ── 層級召回（db.py _sx_expand）：自身1.0／祖先0.9／子樹0.7／次父·成分各一跳 ──
  function sxExpand(D, sid) {
    const ix = 建索引(D), 折 = D.常數.父子折算;
    const hits = new Map([[sid, 折.exact]]);
    const keep = (k, v) => { if (!hits.has(k) || hits.get(k) < v) hits.set(k, v); };
    let cur = sid;
    while (true) {
      const rec = D.症狀[cur];
      const 父 = rec ? rec[1] : null;
      if (父 === null || 父 === undefined) break;
      keep(父, 折["子中父"]);
      cur = 父;
    }
    const stack = [sid];
    while (stack.length) {
      for (const kid of (ix.子表.get(stack.pop()) || [])) {
        if (!hits.has(kid) || hits.get(kid) < 折["父中子"]) {
          hits.set(kid, 折["父中子"]);
          stack.push(kid);
        }
      }
    }
    for (const k of (ix.次父_由次父.get(sid) || [])) keep(k, 折["父中子"]);
    for (const k of (ix.次父_由子.get(sid) || [])) keep(k, 折["子中父"]);
    for (const row of (ix.成分_由成分.get(sid) || [])) keep(row[0], 折["父中子"]);
    for (const row of (ix.成分_由複合.get(sid) || [])) keep(row[1], 折["子中父"]);
    return hits;
  }

  function 鄰居(D, sid) {
    // db.py get_sx_neighbors：雙向 UNION（去重）＋ ORDER BY 對方標準名
    const ix = 建索引(D), seen = new Set(), out = [];
    for (const [對方, 關係, 辨眼] of (ix.鄰居表.get(sid) || [])) {
      const 名 = D.症狀[對方] ? D.症狀[對方][0] : null;
      if (名 === null) continue;
      const key = JSON.stringify([名, 關係, 辨眼]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([名, 關係, 辨眼]);
    }
    // ORDER BY 1,2,3（同 db.py）：同名多列時要靠 關係／辨眼 定序
    const s = (v) => (v === null || v === undefined ? "" : v);
    out.sort((a, b) => 中文序(a[0], b[0]) || 中文序(s(a[1]), s(b[1])) || 中文序(s(a[2]), s(b[2])));
    return out;
  }

  // Python round(x,1) 看「雙精度的精確值」：真正落在 .x5 的平手才五成雙，其餘照精確值進位。
  // 舊版先 x*10 再判 .5＝0.35（精確值 0.3499…）被當平手進成 0.4，Python 是 0.3（2026-10-01 健檢實測 706/212004 值不一致）。
  // 精確平手＝x 為 (2k+1)/20 且可二進位有限表示 ⇒ 只可能是 .25/.75 這類「奇數個 1/4」：此時 x*10 精確，走五成雙；
  // 其餘交給 toFixed（規格保證以精確值取最近者）。
  function py1(x) {
    if (Number.isInteger(x * 4) && !Number.isInteger(x * 2)) {
      const f = Math.floor(x * 10);
      return ((f % 2 === 0) ? f : f + 1) / 10;
    }
    return Number(x.toFixed(1));
  }

  const 中文序 = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // ── 主體（db.py diagnose） ────────────────────────────────────────────────
  function diagnose(D, 症狀names, opts) {
    opts = opts || {};
    const 模式 = opts.模式 || "off";
    const 醫家 = opts.醫家 || null;
    const topn = opts.topn || 10;
    const K = D.常數;
    if (["off", "mix", "only", "boost"].indexOf(模式) < 0) throw new Error("模式須 off/mix/only/boost：" + 模式);
    if (模式 !== "off" && !醫家) throw new Error("mix/only/boost 模式須指定 醫家");
    const ix = 建索引(D);

    // ① 輸入解析（別名→標準名；程度映射 fallback；未識別＝字典擴充桶）
    const sids = new Map(), 未識別 = [], 程度讀數 = {};
    for (const n of 症狀names) {
      let sid = resolveSymptom(D, n);
      if (sid === null) {
        const deg = resolveDegree(D, n);
        if (deg) {
          sid = deg[0];
          程度讀數[n] = { 節點: D.症狀[sid][0], 程度: [deg[1], deg[2]] };
        }
      }
      if (sid === null) 未識別.push(n);
      else if (!sids.has(sid)) sids.set(sid, n);
    }
    const expand = new Map();
    for (const sid of sids.keys()) expand.set(sid, sxExpand(D, sid));
    // 模態感知分母：不問脈就不罰無脈
    const 輸入模態 = new Set();
    for (const s of sids.keys()) if (ix.類別map.has(s)) 輸入模態.add(ix.類別map.get(s));

    // ② 邊集（按模式取）：mix/boost 醫家邊覆寫同對 base
    const edges = new Map(), zinfo = new Map();
    for (const [zid, sid, 角色, 關鍵, 視角] of D.邊) {
      const z = D.證型[zid];
      zinfo.set(zid, [z[0], z[1], z[2]]);
      if (視角 === null || 視角 === undefined) {
        if (z[1] && (模式 === "off" || (z[5] != null && z[5] !== 醫家))) continue;   // 他家 delta 排除（db.py 同步·2026-10-01）
        if (!edges.has(zid)) edges.set(zid, new Map());
        const cur = edges.get(zid).get(sid);
        if (cur === undefined || cur[2] === null) edges.get(zid).set(sid, [角色, 關鍵, null]);
      } else {
        if (模式 === "off" || 視角 !== 醫家) continue;
        if (!edges.has(zid)) edges.set(zid, new Map());
        edges.get(zid).set(sid, [角色, 關鍵, 視角]);
      }
    }
    if (模式 === "only") {
      for (const [zid, es] of Array.from(edges)) {
        let 有醫家 = false;
        for (const v of es.values()) if (v[2] === 醫家) { 有醫家 = true; break; }
        if (!zinfo.get(zid)[1] && !有醫家) edges.delete(zid);
      }
    }

    // ③ IDF 現算（只在 base 邊上算，統計量不落表）
    const df = new Map(), zset = new Set(), df醫家 = new Map();
    const seenPair = new Set(), seenPair醫 = new Set();
    for (const [zid, sid, , , 視角] of D.邊) {
      if (視角 === null || 視角 === undefined) {
        const k = zid + "|" + sid;
        if (!seenPair.has(k)) { seenPair.add(k); df.set(sid, (df.get(sid) || 0) + 1); }
        zset.add(zid);
      } else if (模式 !== "off" && 視角 === 醫家) {
        const k = zid + "|" + sid;
        if (!seenPair醫.has(k)) { seenPair醫.add(k); df醫家.set(sid, (df醫家.get(sid) || 0) + 1); }
      }
    }
    const N = zset.size || 1;
    const idf = (s) => Math.log(1 + N / Math.max(df.get(s) || 1, 1));
    const 無邊症狀 = [];
    for (const sid of sids.keys()) if (!df.get(sid) && !df醫家.get(sid)) 無邊症狀.push(sid);

    // ④ 逐候選計分
    const out = [];
    const w = (角色) => {
      const t = K.角色權重;
      const key = (角色 === null || 角色 === undefined) ? "" : 角色;
      return t[key] !== undefined ? t[key] : 1.0;
    };
    let 分母_輸入 = 0;
    for (const s of sids.keys()) 分母_輸入 += idf(s);

    for (const [zid, es] of edges) {
      const [zname, is_delta, z狀態] = zinfo.get(zid);
      const matched = new Map();                 // 輸入sid → [折算, e_sid, 角色, 關鍵]
      for (const [in_sid, hitmap] of expand) {
        let best = null;
        for (const [e_sid, v] of es) {
          if (hitmap.has(e_sid)) {
            const cand = [hitmap.get(e_sid), e_sid, v[0], v[1]];
            if (best === null || cand[0] > best[0]) best = cand;
          }
        }
        if (best) matched.set(in_sid, best);
      }
      if (!matched.size) continue;

      let 分母_證 = 0;
      for (const [s, v] of es) {
        if (ix.類別map.has(s) && !輸入模態.has(ix.類別map.get(s))) continue;   // 模態感知
        分母_證 += w(v[0]) * idf(s);
      }
      let 分子 = 0;
      for (const [折算, e_sid, 角色, 關鍵] of matched.values()) {
        分子 += w(角色) * idf(e_sid) * 折算 * (關鍵 ? K.關鍵乘數 : 1.0);
      }
      const 驗證 = 分母_證 ? Math.min(分子 / 分母_證, 1.0) : 0.0;
      let 溯因 = 0;
      if (分母_輸入) {
        let acc = 0;
        for (const [s, m] of matched) acc += idf(s) * m[0];
        溯因 = acc / 分母_輸入;
      }
      let score = Math.sqrt(Math.max(驗證, 0) * Math.max(溯因, 0));

      // 主症cap（家族去重：同族只算一次，防父子雙計誤殺）
      const 主症邊 = [];
      for (const [s, v] of es) {
        if (ix.類別map.has(s) && !輸入模態.has(ix.類別map.get(s))) continue;   // 模態感知同分母（db.py 同步·2026-10-01 健檢）
        if (v[0] === "主症") 主症邊.push(s);
      }
      if (主症邊.length) {
        const 主症set = new Set(主症邊), fam = new Map();
        for (const s of 主症邊) {
          let root = s, cur = s;
          while (true) {
            const rec = D.症狀[cur];
            const 父 = rec ? rec[1] : null;
            if (父 === null || 父 === undefined) break;
            cur = 父;
            if (主症set.has(cur)) root = cur;
          }
          fam.set(s, root);
        }
        const 家族數 = new Set(fam.values()).size;
        const 命中家族 = new Set();
        for (const m of matched.values()) if (m[2] === "主症" && fam.has(m[1])) 命中家族.add(fam.get(m[1]));
        if (命中家族.size / 家族數 < K.主症cap[0]) score = Math.min(score, K.主症cap[1]);
      }
      if (模式 === "boost") {
        let 有醫家 = false;
        for (const v of es.values()) if (v[2] === 醫家) { 有醫家 = true; break; }
        if (is_delta || 有醫家) score *= K.BOOST;
      }
      // 症狀臟腑歸屬先驗微加成（軟先驗，只輔助排序）
      if (Object.keys(D.歸屬).length) {
        const 位s = new Set(D.位[zid] || []);
        let 加成w = 0;
        for (const in_sid of matched.keys()) {
          const g = D.歸屬[in_sid];
          if (!g) continue;
          for (const 臟 in g) if (位s.has(臟)) 加成w += g[臟];
        }
        if (加成w) score = Math.min(score * (1 + 加成w * K.歸屬係數), 1.0);
      }
      const z = D.證型[zid], 治療n = z[3], 治禁n = z[4];
      const 完備 = es.size >= 3 && 治療n >= 1;
      const 命中 = Array.from(new Set(Array.from(matched.keys()).map((s) => sids.get(s)))).sort(中文序);
      out.push({
        證型: zname, 覆蓋度: py1(Math.min(score, 1.0) * 100), 命中: 命中,
        邊數: es.size, 治療數: 治療n, 治禁數: 治禁n, 狀態: z狀態,
        帶: 完備 ? "主榜" : "資料不全", _zid: zid,
      });
    }

    // ④b 招牌指向 floor pass：命中招牌症／招牌組合 → 分數短路到指向強度（繞過覆蓋度稀釋）
    const hit_sids = new Set();
    for (const hm of expand.values()) {
      for (const [s, 折] of hm) if (折 >= K.父子折算["子中父"]) hit_sids.add(s);
    }
    const 單症簽 = new Map(), 組合簽 = new Map();
    for (const [zid, sid, grp, 強度, 簽視角] of D.招牌) {
      if (簽視角 !== null && 簽視角 !== undefined && (模式 === "off" || 簽視角 !== 醫家)) continue;
      if (grp === null || grp === undefined) {
        if (!單症簽.has(zid)) 單症簽.set(zid, []);
        單症簽.get(zid).push([sid, 強度]);
      } else {
        if (!組合簽.has(zid)) 組合簽.set(zid, new Map());
        const g = 組合簽.get(zid);
        if (!g.has(grp)) g.set(grp, []);
        g.get(grp).push([sid, 強度]);
      }
    }
    const out_ix = new Map();
    for (const r of out) out_ix.set(r._zid, r);
    function sigFloor(zid, 強度, 觸發sids) {
      if (!zinfo.has(zid)) return;
      const [zname, is_delta, z狀態] = zinfo.get(zid);
      const 醫家欄 = D.證型[zid][5];
      if (is_delta && (模式 === "off" || (醫家欄 != null && 醫家欄 !== 醫家))) return;   // 他家 delta 不觸發招牌（db.py 同步）
      if (模式 === "only" && !edges.has(zid)) return;   // only 候選池＝上方已濾的 edges（db.py 同步·2026-10-01 健檢）
      let r = out_ix.get(zid);
      if (r === undefined) {
        const z = D.證型[zid];
        const 邊n = edges.has(zid) ? edges.get(zid).size : 0;
        r = {
          證型: zname, 覆蓋度: 0.0, 命中: [], 邊數: 邊n, 治療數: z[3], 治禁數: z[4],
          狀態: z狀態, 帶: (邊n >= 3 && z[3] >= 1) ? "主榜" : "資料不全", _zid: zid,
        };
        out.push(r); out_ix.set(zid, r);
      }
      if (強度 * 100 > r.覆蓋度) r.覆蓋度 = py1(強度 * 100);
      const 名s = 觸發sids.map((s) => (sids.has(s) ? sids.get(s) : D.症狀[s][0]));
      r.招牌 = Array.from(new Set((r.招牌 || []).concat(名s))).sort(中文序);
      r.命中 = Array.from(new Set(r.命中.concat(名s))).sort(中文序);
    }
    for (const [zid, lst] of 單症簽) {
      for (const [sid, 強度] of lst) if (hit_sids.has(sid)) sigFloor(zid, 強度, [sid]);
    }
    for (const [zid, groups] of 組合簽) {
      for (const members of groups.values()) {
        const m_sids = members.map((x) => x[0]);
        if (m_sids.every((s) => hit_sids.has(s))) {
          sigFloor(zid, Math.max.apply(null, members.map((x) => x[1])), m_sids);
        }
      }
    }

    out.sort((a, b) => (b.覆蓋度 - a.覆蓋度) || (b.邊數 - a.邊數) || 中文序(a.證型, b.證型));
    const 主榜 = out.filter((r) => r.帶 === "主榜").slice(0, topn);
    const 副帶 = out.filter((r) => r.帶 === "資料不全").slice(0, topn);

    // ⑤ 追問建議：主榜前二膠著（差距<15）→ 反查邊界表「再問哪一症最能拉開」
    let 追問 = [];
    if (主榜.length >= 2 && 主榜[0].覆蓋度 - 主榜[1].覆蓋度 < 15) {
      const a = 主榜[0]._zid, b = 主榜[1]._zid;
      for (const [za, zb, sid, 歸屬, 向反, 說明] of D.邊界) {
        if ((za === a && zb === b) || (za === b && zb === a)) {
          追問.push({ 症: D.症狀[sid][0], 歸屬: 歸屬, 向反: !!向反, 說明: 說明 });
        }
      }
      // ORDER BY s.標準名, bd.歸屬, IFNULL(bd.說明,'')（同 db.py）
      const s2 = (v) => (v === null || v === undefined ? "" : v);
      追問.sort((x, y) => 中文序(x.症, y.症) || 中文序(s2(x.歸屬), s2(y.歸屬)) ||
                          中文序(s2(x.說明), s2(y.說明)));
    }
    for (const r of out) delete r._zid;

    // ⑤b 鑑別提示（只提示不計分）：易混鄰居辨眼 ＋ 複合症時序缺口
    const 鑑別提示 = [];
    for (const [in_sid, in_name] of sids) {
      for (const [鄰名, 關係, 辨眼] of 鄰居(D, in_sid)) {
        鑑別提示.push({ 輸入症: in_name, 型: "易混鄰居", 鄰症: 鄰名, 關係: 關係, 提示: 辨眼 || "" });
      }
      for (const [複id, , 邏輯, 時序] of (ix.成分_由成分.get(in_sid) || [])) {
        if (邏輯 === "全部" && (時序 === "交替" || 時序 === "先後")) {
          const others = [];
          for (const [, 成id] of (ix.成分_由複合.get(複id) || [])) {
            if (成id !== in_sid) others.push(D.症狀[成id][0]);
          }
          鑑別提示.push({
            輸入症: in_name, 型: "時序缺口", 鄰症: D.症狀[複id][0], 關係: "全部＋" + 時序,
            提示: "是否與" + others.join("、") + (時序 === "交替" ? "交替出現" : "先後相繼") +
                  "？是→複合症" + D.症狀[複id][0],
          });
        }
      }
    }

    return {
      主榜: 主榜, 資料不全: 副帶, 未識別: 未識別, 程度讀數: 程度讀數,
      無邊症狀: 無邊症狀.map((s) => D.症狀[s][0]),
      追問: 追問, 鑑別提示: 鑑別提示,
    };
  }

  return { diagnose: diagnose, resolveSymptom: resolveSymptom, sxExpand: sxExpand, normalize: normalize };
});
