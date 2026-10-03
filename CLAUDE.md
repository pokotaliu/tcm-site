# tcm-site：Claude Code 工作指引（本 repo＝建置產物）

一律**中文**回覆。

## 你在哪裡

這是公開靜態站 repo，內容由私有 repo `pokotaliu/tcm` 的 Actions「部署靜態站」自動建置、
每次 **force push 整站覆蓋**。所以：

1. **不要在本 repo 修改／commit 任何內容**——會被下次部署無聲沖掉。
   要改資料→ `pokotaliu/tcm` 的 `_pipeline/`（db seed、卡片）；要改頁面→其 `_pipeline/web/templates/`；
   要改建站／消毒邏輯→其 `_pipeline/build_site.py`（改消毒必跑 `test_build_site.py`）。
2. 本 repo 的正當用途＝**查資料**（唯讀）。

## 怎麼查資料

- 頁面路徑＝URL 路徑：`zx/<證型名>/index.html`（證型詳情，含小卡與治療參考）、
  `sx/<症狀名>/index.html`（症狀詳情）、`dz/`（疾病）、`herb/`（中藥）、`db/<表名>/`（原表瀏覽）。
- 結構化資料（建議優先）：`data/diagnose.json`（診斷邊集＋字典＋常數）、`data/search.json`（搜尋索引）。
  用 `python3` + `json` 讀；別名字典刻意含簡體寫法（輸入歸一鍵），不是資料錯誤。
- 需要完整 schema 或原始資料時，去私有 repo `pokotaliu/tcm`：`_pipeline/seed.sql` 還原 sqlite 即可查。

## 引用規範

回答引用站內內容時標出處（各條目自帶出處欄：書名＋定位碼）。站上教科書內容＝部份引用已轉繁體；
古籍＝公有領域逐字原文。**引用靠站內文獻、不靠記憶；查不到就說沒有，不補。**
