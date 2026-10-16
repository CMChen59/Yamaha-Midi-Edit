# Yamaha PSR-SX920 Multi Pad / Style Editor 開發進度查核點 (PROJECT PROGRESS CHECKPOINT)

**最後更新時間**：2026-10-16  
**當前 Git Commit**：待提交 (2,300+ 音色庫完整整合)  
**自動化測試狀態**：✅ 54 / 54 項單元與回歸測試 100% 通過  
**本地開發伺服器**：🚀 運行中於 `http://localhost:5173` (Vite)

---

## 📌 總體開發進度總覽

| 階段 (Phase) | 項目名稱 | 狀態 | 驗證標準與結果 |
| :--- | :--- | :--- | :--- |
| **Phase 1** | STY / PAD 底層二進位解析與無損重構 (Parser & Round-trip) | **已完成** | Byte-by-byte 深度重構比對 100% 一致，PSR-SX920 實體琴載入零報錯。 |
| **Phase 2.1** | Pad Studio 互動編輯介面 (屬性、名稱、開關、混音推桿) | **已完成** | Pad 1~4 即時名稱、RP 循環、CM 和弦跟隨、音色與圖標連動、二進位即時同步寫回。 |
| **Phase 2.2-A~E** | Web Audio 試聽引擎、原廠音色庫與鋼琴卷軸微調 | **已完成** | 多樂器物理諧波合成、走帶雷射指針、音符增刪移調、小節擴展/複製/順移剪除 (Ripple Delete)。 |
| **Phase 2.2-F** | Web MIDI 實體琴硬體直連與發聲 (Yamaha PSR-SX920) | **已完成** | 透過 Web MIDI API 自動識別 PSR-SX920 / Digital Workstation，實時同步 Bank/PC 音色與發聲試聽。 |
| **Phase 2.2-G** | **PSR-SX920 完整原廠 Data List (2,300+ 音色庫) 數位手冊整合** | **已完成** | 收錄官方 2,321 種全套音色（Panel、MegaVoice、Drum Kits、Legacy），支援 O(1) 毫秒級查找、多維模糊搜尋、⭐ Multi Pad 推薦與 ⚠️ OrganFlutes 避坑防呆。 |
| **Phase 2.3** | 外部標準 MIDI 匯入與切片分配精靈 (MIDI Importer & Slice Wizard) | **已完成** | 支援拖曳外部 `.mid`，自動偵測音軌與小節長度，精準切片並指派給 Pad 1~4。 |
| **Phase 2.4** | Yamaha PAD 二進位合成器與 CASM 區塊注入 (Pad Synthesizer) | **已完成** | 從零組裝標準 4-Pad 二進位結構（Section Markers、RP/CM/N/I 控制標記、CASM NTR/NTT 和弦轉調規則）。 |
| **Phase 2.5** | **PSR-SX920 實體琴端對端驗證與全功能驗收 (當前階段)** | **進行中** | 實體琴 USB-to-Host 硬體直連發聲、USB 隨身碟實體琴載入播放、和弦跟隨 (CM) 與循環模式 (RP) 測試。 |

---

## 🛠️ Phase 2.5 實測發現與已解決問題

1. **切換 Pad 聲音重疊與中斷殘響問題 (已修復 - commit `a91962e`)**：
   - 在手動切換或快速中斷 Pad 試聽時，前一個 Pad 未播放完畢的定時音符會與新 Pad 疊合。
   - **解決方案**：引入 `playbackSessionId` 會話隔離機制，取消殘留計時器，透過專屬子音軌 Gain 節點與 `MidiManager.panicAllChannels()` 即時釋放實體琴與 Web Audio 所有未結束的 Note。
2. **範例檔 Pad 3 音色更換無效問題 (已修復 - commit `7292422`)**：
   - 範例檔 `4006-1_PAD.PAD` 的 Track 3 在 Tick 3073 帶有第二組 Program Change (PC 75, Pizzicato)，原本 `setPadMixing` 僅使用 `.find()` 修改第一筆事件，導致後段音色未被置換。
   - **解決方案**：改為全軌過濾並遍歷更新所有 Program Change 與 Bank Select 控制事件。
3. **Pad 4 鋼琴音色更換後聽感不一致診斷 (已完成深入分析)**：
   - 原檔 Pad 4 採用的是 Yamaha 原廠 Live! Grand Piano (`Bank MSB: 8, Bank LSB: 34, PC: 0`)，具有多層立體聲採樣與共鳴。
   - 下拉選單選回之鋼琴寫入的是通用 GM 標準鋼琴 (`Bank MSB: 0, Bank LSB: 112, PC: 0`)，故實體琴發聲聽感較扁平。已指導使用者於混音器輸入原三聯號或透過音色庫選取旗艦 CFX Grand (`104-1-0`)。
4. **Yamaha PSR-SX920 完整 Data List 音色庫上線 (已完成 - 2026-10-16)**：
   - 全面結構化導入 2,321 款原廠音色（涵蓋 80 款伴奏專利 MegaVoice、367 款 S.Art!、267 款 Live!/Sweet!/Cool!、69 款 Drum Kits 與 GM/XG 經典全庫）。
   - 引入 Multi Pad 適用度體系（⭐ 推薦、⚠️ 避坑、一般），當套用 OrganFlutes 等琴端限制音色時自動彈出防呆警示。
   - 提供 16 大樂器分類標籤與適用度篩選藥丸按鈕，支援分頁平滑渲染與毫秒級即時搜尋。

---

## 📋 待開發功能儲備清單 (Backlog)

### 📌 【規劃中】Phase 3.0：外部標準 MIDI 轉 Yamaha 伴奏風格檔（MIDI to STY Converter）
- **需求概述**：支援匯入外部多軌 MIDI 檔案，自動識別節奏、貝斯、和弦聲部，轉換並分配至 Yamaha STY 伴奏 8 音軌（Ch 9~16），並自動建置 SFF2 CASM 和弦轉調與段落（Main A~D, Fill, Intro, Ending）。
- **功能亮點**：
  1. 8 軌伴奏聲部自動映射（Ch 9/10 Drums, Ch 11 Bass, Ch 12/13 Chords, Ch 14/15 Pads, Ch 16 Phrases）。
  2. 多小節段落切片（Intro, Main A~D, Fill In, Ending）。
  3. SFF2 CASM 與 OTS 聲部自動合成與匯出。

---

## 🎹 Phase 2.5 實體琴 (PSR-SX920) 驗收操作指引

### 1. Web MIDI USB 硬體直連即時試聽
1. 使用 USB-to-Host 線將電腦連接至 Yamaha PSR-SX920。
2. 開啟瀏覽器進入 `http://localhost:5173`。
3. 頂部工具列將自動偵測並選取 `Digital Workstation` 或 `Yamaha USB-MIDI`。
4. 在發聲路由選單切換至 **「🎹 實體琴直連」** 或 **「雙軌並行」**。
5. 點擊 **[🔔 測試連線]** 按鈕，PSR-SX920 將即時彈奏 C-E-G-C 測試和弦。
6. 點擊各 Pad 卡片上的 **[▶ 試聽]**，將直接驅動 PSR-SX920 內建高品質原廠音源與對應音色演奏。

### 2. USB 隨身碟實機檔案載入驗證
1. 於網頁中編輯 Pad 或匯入外部 MIDI 後，點擊右上角 **[匯出修改後的檔案]**。
2. 或執行根目錄下的 `export-usb.ts` 導出標準樣品檔至 `usb_test_export/`：
   ```bash
   npx.cmd tsx export-usb.ts
   ```
3. 將產出的 `.PAD` 或 `.STY` 檔案存入 USB 隨身碟並插入 PSR-SX920。
4. 於琴端 Multi Pad Control 載入該檔案，驗證：
   - [ ] 4 顆 Pad 卡片名稱（`N1~N4`）與圖標（`I1~I4`）是否正確顯示於琴端螢幕。
   - [ ] 敲擊各 Pad 按鍵，發聲、音量、Pan 是否符合設定。
   - [ ] 測試 Repeat（循環）模式是否能無縫無噪循環。
   - [ ] 左手按下不同和弦，測試開啟 Chord Match（和弦跟隨）的 Pad 是否準確轉調。

