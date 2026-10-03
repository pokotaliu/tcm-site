/* 靜態站前端：搜尋 ＋ 診斷器 UI。計分一律走 diagnose.js（db.py 的對譯實作），本檔只管取資料與畫面。*/
var TCMSite = (function () {
  "use strict";

  // 站台可能掛在子路徑（GitHub Pages project site）——由自身 script src 反推 base，
  // 免得 JS 內的 fetch／連結寫死根路徑而在子路徑站上全破。
  var BASE = (function () {
    var ss = document.getElementsByTagName("script");
    for (var i = 0; i < ss.length; i++) {
      var src = ss[i].getAttribute("src") || "";
      if (/\/static\/site\.js(\?.*)?$/.test(src)) return src.replace(/\/static\/site\.js(\?.*)?$/, "");
    }
    return "";
  })();

  var U = function (p) { return BASE + p; };
  var esc = function (s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  var 連結 = function (url, 文) { return '<a href="' + U(url) + encodeURI(文) + '">' + esc(文) + "</a>"; };

  function 取json(名) {
    return fetch(U("/data/" + 名)).then(function (r) {
      if (!r.ok) throw new Error(名 + " 載入失敗（" + r.status + "）");
      return r.json();
    });
  }

  function qs(名) {
    var m = new RegExp("[?&]" + encodeURIComponent(名) + "=([^&]*)").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  // ── 搜尋 ────────────────────────────────────────────────────────────────
  function bootSearch() {
    var 索引 = null;
    var q = document.getElementById("sq");
    var out = document.getElementById("sout");
    var stat = document.getElementById("sstat");
    取json("search.json").then(function (d) {
      索引 = d;
      stat.textContent = "索引 " + d.length.toLocaleString() + " 條（標準名＋別名＋方藥）";
      var 初 = qs("q");
      if (初) { q.value = 初; 跑(); }
      q.focus();
    }).catch(function (e) { stat.textContent = "✗ " + e.message; });

    function 跑() {
      var v = (q.value || "").trim();
      if (!索引 || !v) { out.innerHTML = ""; return; }
      var 精確 = [], 模糊 = {};
      for (var i = 0; i < 索引.length; i++) {
        var it = 索引[i];                       // [名, 類, url, 指向]
        if (it[0] === v) 精確.push(it);
        else if (it[0].indexOf(v) >= 0) {
          if (!模糊[it[1]]) 模糊[it[1]] = [];
          if (模糊[it[1]].length < 50) 模糊[it[1]].push(it);
        }
      }
      var h = "";
      if (精確.length) {
        h += '<section class="block"><h2>精確命中</h2><ul>';
        精確.forEach(function (it) {
          h += "<li><span class=\"badge\">" + esc(it[1]) + '</span> <a href="' + U(it[2]) + '">' + esc(it[0]) + "</a>" +
               (it[3] ? ' <span class="muted">→ ' + esc(it[3]) + "</span>" : "") + "</li>";
        });
        h += "</ul></section>";
      }
      var 類s = Object.keys(模糊).sort();
      類s.forEach(function (類) {
        h += '<section class="block"><h2>' + esc(類) + "（" + 模糊[類].length + "）</h2><ul>";
        模糊[類].forEach(function (it) {
          h += '<li><a href="' + U(it[2]) + '">' + esc(it[0]) + "</a>" +
               (it[3] ? ' <span class="muted">→ ' + esc(it[3]) + "</span>" : "") + "</li>";
        });
        h += "</ul></section>";
      });
      out.innerHTML = h || '<p class="muted">查無</p>';
    }
    q.addEventListener("input", 跑);
  }

  // ── 診斷器 ──────────────────────────────────────────────────────────────
  function 表格(表頭, 列s) {
    return '<div class="tablewrap"><table><thead><tr>' +
      表頭.map(function (h) { return "<th>" + h + "</th>"; }).join("") +
      "</tr></thead><tbody>" + 列s.join("") + "</tbody></table></div>";
  }

  function 畫結果(r) {
    if (!r) return "";
    var h = "";
    h += '<section class="block"><h2>主榜（' + r.主榜.length + "）</h2>";
    h += 表格(["#", "證型", "覆蓋度", "命中", "招牌", "邊數", "治療數", "⚠", "狀態"],
      r.主榜.map(function (x, i) {
        return "<tr><td class=\"r\">" + (i + 1) + "</td><td>" + 連結("/zx/", x.證型) + "</td>" +
          '<td class="r">' + x.覆蓋度 + "</td><td>" + esc(x.命中.join("、")) + "</td>" +
          "<td>" + esc((x.招牌 || []).join("、")) + "</td>" +
          '<td class="r">' + x.邊數 + '</td><td class="r">' + x.治療數 + "</td>" +
          '<td class="r">' + (x.治禁數 ? '<a class="badge warn" href="' + U("/zx/") + encodeURI(x.證型) +
            '" title="治療欄含 ' + x.治禁數 + ' 條 ⚠治禁／誤治戒 註記，點入讀醫家原話">⚠' + x.治禁數 + "</a>" : "") + "</td>" +
          '<td><span class="badge">' + esc(x.狀態) + "</span></td></tr>";
      }));
    h += "</section>";

    if (r.資料不全.length) {
      h += "<details><summary>資料不全副帶（" + r.資料不全.length + "）</summary>" +
        表格(["證型", "覆蓋度", "命中", "邊數", "治療數"], r.資料不全.map(function (x) {
          return "<tr><td>" + 連結("/zx/", x.證型) + '</td><td class="r">' + x.覆蓋度 + "</td><td>" +
            esc(x.命中.join("、")) + '</td><td class="r">' + x.邊數 + '</td><td class="r">' + x.治療數 + "</td></tr>";
        })) + "</details>";
    }
    if (r.未識別.length) {
      h += '<section class="block"><h2>未識別（' + r.未識別.length + "）</h2>";
      r.未識別.forEach(function (n) {
        var 近 = (r._建議 && r._建議[n]) || [];
        h += "<p>「" + esc(n) + "」" + (近.length ? "——相近：" + 近.map(function (x) {
          return '<a href="' + U(x.url) + '">' + esc(x.名) + "</a>";
        }).join("、") : "") + "</p>";
      });
      h += "</section>";
    }
    var 程度鍵 = Object.keys(r.程度讀數 || {});
    if (程度鍵.length) {
      h += '<section class="block"><h2>程度讀數</h2><table>';
      程度鍵.forEach(function (詞) {
        var v = r.程度讀數[詞];
        h += "<tr><td>" + esc(詞) + "</td><td>→ " + 連結("/sx/", v.節點) + '</td><td class="r">' +
          v.程度[0] + " – " + v.程度[1] + "</td></tr>";
      });
      h += "</table></section>";
    }
    if (r.無邊症狀.length) {
      h += '<p class="muted">無邊症狀（字典有名、引擎無據）：' +
        r.無邊症狀.map(function (s) { return 連結("/sx/", s); }).join("、") + "</p>";
    }
    if (r.追問.length) {
      h += '<section class="block"><h2>追問建議（前二膠著）</h2>' +
        表格(["再問症狀", "歸屬", "向反", "說明"], r.追問.map(function (x) {
          return "<tr><td>" + 連結("/sx/", x.症) + "</td><td>" + esc(x.歸屬) + "</td><td>" +
            (x.向反 ? "⇄" : "") + "</td><td>" + esc(x.說明 || "") + "</td></tr>";
        })) + "</section>";
    }
    if (r.鑑別提示.length) {
      h += '<section class="block"><h2>鑑別提示</h2>' +
        表格(["輸入症", "型", "鄰症", "關係", "提示"], r.鑑別提示.map(function (x) {
          return "<tr><td>" + esc(x.輸入症) + '</td><td><span class="badge">' + esc(x.型) + "</span></td><td>" +
            連結("/sx/", x.鄰症) + "</td><td>" + esc(x.關係) + "</td><td>" + esc(x.提示) + "</td></tr>";
        })) + "</section>";
    }
    return h;
  }

  function bootDiagnose() {
    var D = null;
    var 索引 = null;
    var stat = document.getElementById("dxstat");
    var out = document.getElementById("dxout");
    var f = document.getElementById("dxform");
    var 分隔 = /[、,，;；/／\s]+/;

    function 模式值() {
      var rs = f.querySelectorAll("input[name=模式]");
      for (var i = 0; i < rs.length; i++) if (rs[i].checked) return rs[i].value;
      return "off";
    }
    function sync() { document.getElementById("in醫家").disabled = (模式值() === "off"); }
    f.querySelectorAll("input[name=模式]").forEach(function (x) { x.addEventListener("change", sync); });
    sync();

    Promise.all([取json("diagnose.json"), 取json("search.json")]).then(function (rs) {
      D = rs[0]; 索引 = rs[1];
      stat.textContent = "引擎就緒：證型 " + Object.keys(D.證型).length +
        "／症狀 " + Object.keys(D.症狀).length + "／邊 " + D.邊.length.toLocaleString();
      var 初 = qs("症狀");
      if (初) {
        document.getElementById("in症狀").value = 初;
        if (qs("模式")) {
          var rs2 = f.querySelectorAll("input[name=模式]");
          for (var i = 0; i < rs2.length; i++) rs2[i].checked = (rs2[i].value === qs("模式"));
        }
        if (qs("醫家")) document.getElementById("in醫家").value = qs("醫家");
        if (qs("topn")) document.getElementById("intopn").value = qs("topn");
        sync(); 跑();
      }
    }).catch(function (e) { stat.textContent = "✗ " + e.message; });

    function 建議(名) {
      if (!索引) return [];
      var out2 = [];
      for (var i = 0; i < 索引.length && out2.length < 8; i++) {
        var it = 索引[i];
        if ((it[1] === "症狀" || it[1] === "症狀別名" || it[1] === "證型" || it[1] === "證型別名") &&
            it[0].indexOf(名) >= 0) out2.push({ 名: it[0], url: it[2] });
      }
      return out2;
    }

    function 跑() {
      if (!D) return;
      var raw = document.getElementById("in症狀").value || "";
      var names = raw.split(分隔).filter(function (x) { return x; });
      if (!names.length) { out.innerHTML = ""; return; }
      var 模式 = 模式值();
      var 醫家 = document.getElementById("in醫家").value || null;
      var topn = Math.max(1, Math.min(parseInt(document.getElementById("intopn").value, 10) || 10, 50));
      var r;
      try {
        r = TCM.diagnose(D, names, { 模式: 模式, 醫家: 醫家, topn: topn });
      } catch (e) {
        out.innerHTML = '<p class="badge" style="background: var(--miss); color:#fff">' + esc(e.message) + "</p>";
        return;
      }
      r._建議 = {};
      r.未識別.forEach(function (n) { r._建議[n] = 建議(n); });
      out.innerHTML = 畫結果(r);
      // 網址帶查詢＝可存書籤／傳給同事重現同一次查詢
      var p = "?症狀=" + encodeURIComponent(raw) + "&模式=" + 模式 +
        (醫家 ? "&醫家=" + encodeURIComponent(醫家) : "") + "&topn=" + topn;
      history.replaceState(null, "", p);
    }

    document.getElementById("dxgo").addEventListener("click", 跑);
    document.getElementById("in症狀").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) 跑();
    });
  }

  return { bootSearch: bootSearch, bootDiagnose: bootDiagnose };
})();
