# Yamaha PSR-SX920 Multi Pad / Style Editor 開發進度查核點 (PROJECT PROGRESS CHECKPOINT)

**最後更新時間**：2026-10-15  
**當前 Git Commit**：`a4bd543` (main 分支最新代碼)  
**自動化測試狀態**：✅ 50 / 50 項單元與回歸測試 100% 通過  
**本地開發伺服器**：🚀 運行中於 `http://localhost:5173` (Vite)

---

## 📌 總體開發進度總覽

| 階段 (Phase) | 項目名稱 | 狀態 | 驗證標準與結果 |
| :--- | :--- | :--- | :--- |
| **Phase 1** | STY / PAD 底層二進位解析與無損重構 (Parser & Round-trip) | **已完成** | Byte-by-byte 深度重構比對 100% 一致，PSR-SX920 實體琴載入零報錯。 |
| **Phase 2.1** | Pad Studio 互動編輯介面 (屬性、名稱、開關、混音推桿) | **已完成** | Pad 1~4 即時名稱、RP 循環、CM 和弦跟隨、音色與圖標連動、二進位即時同步寫回。 |
| **Phase 2.2-A~E** | Web Audio 試聽引擎、Yamaha 原廠音色庫與鋼琴卷軸微調 | **已完成** | 多樂器物理諧波合成、走帶雷射指針、音符增刪移調、小節擴展/複製/順移剪除 (Ripple Delete)。 |
| **Phase 2.2-F** | Web MIDI 實體琴硬體直連與發聲 (Yamaha PSR-SX920) | **已完成** | 透過 Web MIDI API 自動識別 PSR-SX920 / Digital Workstation，實時同步 Bank/PC 音色與發聲試聽。 |
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

---

## 📋 待開發功能儲備清單 (Backlog)

### 📌 【規劃中】Yamaha PSR-SX920 原廠完整 Data List (1,500+ 音色資料庫) 數位手冊整合
- **需求概述**：將 Yamaha 官方 Data List 的 1,500+ 種音色（含 Panel Voices、MegaVoices、Drum Kits、XG/GM）全面結構化導入系統供隨時檢索。
- **功能亮點**：
  1. **免翻 PDF 字典**：支援中文、英文、樂器分類、MSB/LSB/PC 代碼即時模糊搜尋。
  2. **實體琴一鍵試聽 (Audition)**：透過 Web MIDI 點擊直接讓 PSR-SX920 發出該音色示範音。
  3. **一鍵套用至 Pad 1~4**：自動同步三聯號、圖標至對應音軌與混音器。
  4. **Multi Pad 友善度與避坑標記**：
     - ⭐ **推薦標記**：MegaVoice、Live!、Sweet! 等 Multi Pad 最佳拍檔。
     - ⚠️ **避坑警示**：標記 Organ Flutes（實體琴僅支援右手即時彈奏，Pad 不支援）、S.Art!（播放時缺乏手彈即時技巧）。
- **當前狀態**：已完整記錄需求與架構設計，暫不執行，待後續排程啟動。

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

