# Yamaha PSR-SX920 STY / PAD 編輯器系統開發計畫書 (PROJECT PLAN)

## 1. 專案願景與目標
本專案旨在為 Yamaha PSR-SX920（及相容型號）打造一套現代化、直觀且易於操作的電腦端 STY（伴奏）與 PAD（多功能打擊墊）編輯與製作軟體。
解決傳統老舊工具介面繁瑣、操作不直觀的問題，並確保所有建立與修改後的檔案均能 100% 在實體琴上正常載入與演奏。

---

## 2. 核心架構與技術選型
* **平台形式**：桌面應用程式（Desktop App）或現代 Web 應用。
* **技術棧**：TypeScript + Vite / Vue 3（或 React）+ Web MIDI API + Web Audio API。
* **核心模組**：
  * **SMF/Yamaha Binary Engine**：專門處理 MIDI 檔案結構、MIDI Markers、Yamaha CASM（和弦轉換規則）與 OTS（面板音色設定）區塊。
  * **Interactive UI Layer**：現代化矩陣視圖、Pad 卡片視圖、混音推桿、鋼琴卷軸。
  * **Regression Test Suite**：自動化回歸測試框架，確保每一次程式更新都不影響現有功能的二進位相容性。

---

## 3. 四階段實施計畫 (Phase Breakdown)

### 階段 1：基礎解析與透視引擎 (Parser & Viewer)
* **目標**：實現二進位結構讀取與無失真重建，提供檔案資訊視覺化檢視面板。
* **具體工作內容**：
  1. 解析 SMF Type 0/1 結構與 Yamaha MIDI Markers（Main A~D, Fill, Intro 等）。
  2. 提取與封裝專屬 CASM (Chord Accompaniment Style Maker) 與 OTS 資料區塊。
  3. 建立無失真重構器（Round-trip Packager）：讀取原檔 ➔ 記憶體物件 ➔ 寫出新檔。
  4. 視覺化面板：展示段落列表、8 音軌聲部配置（Voice, Bank, Volume, Pan）。
* **功能驗證標準 (Acceptance Criteria)**：
  - [ ] 單元測試：重構前後二進位結構與關鍵區塊偏移一致。
  - [ ] 實琴測試：重構後的 `.sty` / `.pad` 放入 PSR-SX920 能正常載入且無報錯。

---

### 階段 2：Multi Pad 編輯模組 (Pad Studio)
* **目標**：打造輕量直觀的 4-Pad 編輯器，打通和弦跟隨與打擊樂設定。
* **具體工作內容**：
  1. 設計 Pad 1~4 卡片式操作介面（支援播放、音量、音色選擇、和弦跟隨開關）。
  2. 支援匯入外部 1~4 小節的標準 `.mid` 檔案，自動切片並分配至指定 Pad。
  3. 自動生成 Yamaha PAD CASM 區塊（固定音高 Drums / 隨和弦轉調 Chord Match）。
  4. 匯出標準 `.pad` 檔案。
* **功能驗證標準 (Acceptance Criteria)**：
  - [ ] 實琴測試：生成的 Pad 檔在 SX-920 敲擊時正常發聲。
  - [ ] 實琴測試：彈奏不同和弦時，設定為 Chord Match 的 Pad 正確轉換調性。
  - [ ] 回歸測試：階段 1 的 STY 解析功能完全不受影響。

---

### 階段 3：Style 拼貼組裝與混音器 (Style Assembler & Mixer)
* **目標**：提供最實用的伴奏重組功能——跨檔案聲部替換與音色調整。
* **具體工作內容**：
  1. 矩陣式工作台（15 段落 × 8 聲部）：可直觀拖曳或複製段落軌道（例如替換 Drum 或 Bass）。
  2. PSR-SX920 專屬音色庫對應（Voice Map JSON）：以直觀名稱替換音色，自動填入 MSB/LSB/PC。
  3. 混音控制台（Mixer View）：圖形化推桿調整各聲部音量、Pan、Reverb 等參數。
* **功能驗證標準 (Acceptance Criteria)**：
  - [ ] 實琴測試：組裝後的 Style 在 SX-920 上切換段落（Main A ➔ Fill ➔ Main B）平順無雜音或中斷。
  - [ ] 回歸測試：Pad 模組與基礎解析模組功能完全不受影響。

---

### 階段 4：和弦跟隨可視化與高級編輯 (Advanced Audition & Piano Roll)
* **目標**：提供直觀的即時轉調試聽與細部音符編輯。
* **具體工作內容**：
  1. 輕量級鋼琴卷軸：單軌音符新增、刪除、長度縮放與力度（Velocity）修改。
  2. 和弦測試條（Chord Audition Bar）：畫面提供 C, Am, F, G7 等按鈕，即時模擬 CASM NTR/NTT 演算變形後的音符並發聲。
  3. OTS (One Touch Setting) 面板音色編輯。
* **功能驗證標準 (Acceptance Criteria)**：
  - [ ] 模擬試聽結果與 SX-920 實際彈奏和弦變形一致。
  - [ ] 通過全系統綜合回歸測試。

---

## 4. 品質保證與無破壞性開發原則 (Non-Regression Policy)
為符合「每完成一個功能需經由驗證且不能影響已完成功能」之嚴格要求：
1. **獨立模組化架構**：各核心模組（Parser, Engine, UI, Exporter）解耦設計。
2. **自動化回歸測試**：每次新增功能後，必須自動執行既有測試案例集。
3. **階段驗收里程碑**：每個階段必須完成實琴（PSR-SX920）驗證記錄後，方可推進至下一階段。

---

## 5. 開發日誌與版本進度紀錄
| 日期 | 版本/階段 | 完成項目 | 驗證狀態 | 備註 |
| :--- | :--- | :--- | :--- | :--- |
| 2026-10-12 | Phase 0 | 專案規格確定與開發計畫建檔 | 完成 | 產出 PROJECT_PLAN.md 與 PHASE_1_PLAN.md |
| 2026-10-12 | Phase 1.1 | 專案工程基底與測試框架建置 | **已驗收通過** | TypeScript + Vite + Vitest 單元測試 100% 通過 |
| 2026-10-12 | Phase 1.2 | Yamaha 二進位核心解析器 (Parser) | **已驗收通過** | 真實 SX900/SX920 STY/PAD 檔案解析 100% 成功 |
| 2026-10-12 | Phase 1.3 | 無損重構器與二進位驗證 (Round-trip) | **已驗收通過** | 真實檔案 Byte-by-byte 深度比對 100% 一致無損 |
| 2026-10-12 | Phase 1.4 | 視覺化檢視面板 (UI v0.1 Preview) | **已完成上線** | 現代深色 DAW 風格，支援拖曳即時透視與重新導出 |
| 2026-10-12 | Phase 1.4+ | Pad 點擊透視與迷你音符卷軸 (Note Roll Preview) | **已驗收通過** | 點擊 Pad 卡片動態展開音符總數、音域與 Canvas 節奏長條圖 |
| 2026-10-13 | Phase 1.5 | 實琴載入與回歸測試驗收 (SX-920 Verification) | **待實機測試** | 測試檔已產生於 usb_test_export/，待實體琴驗證 |
| 2026-10-13 | Phase 2.0 | Multi Pad 編輯模組計畫建檔 (Pad Studio) | **計畫已建立** | 產出 PHASE_2_PLAN.md，包含 2.1~2.5 細部計畫 |
| 2026-10-13 | Phase 2.1 | Pad Studio 互動編輯介面與二進位同步 | **已驗收通過** | 名稱、CM、RP、圖示、音量推桿、Pan、混響、音色即時修改與二進位同步匯出 |
