# Block Blast 量產規格：特效與動畫 (Art Pro VFX & Anim)

## 一、 Spine 動畫原則 (Spine Animation)
* 由於是方塊消除，方塊本身主要透過 PixiJS 的 Tween (縮放/位移) 處理。
* **角色/吉祥物 (可選)**：若有 Q版吉祥物在畫面上方，需使用 Spine 2D (預計 3.8)。需具備 `idle`、`happy` (Combo 觸發)、`sad` (死局觸發) 等基本狀態。

## 二、 粒子與序列圖特效 (Particles & Sprite Sheets)
* **消除特效 (`vfx_pop_color.png`)**：
  - 必須是序列圖 (Sprite Sheet)，格式為 5x5 的格狀排列或匯出成 JSON Atlas。
  - 效果要求：方塊爆開成 4-6 個果凍小碎塊往四周擴散並淡出。每種顏色都要有對應特效。
* **Combo 特效 (`vfx_combo_glow`)**：
  - 連擊時網格四周的流光效果。可以使用 Additive Blend Mode，圖檔需為純黑底或去背白圖由程式染色。

## 三、 物理原則與效能限制 (Physics & Perf)
* **Squash & Stretch (擠壓與拉伸)**：方塊落地嵌入網格時，PixiJS 端應寫入微幅的 Y 軸壓縮、X 軸膨脹的彈性回饋。
* **效能限制**：所有特效貼圖不可超過 1024x1024。透明區域必須完全裁切。

## 四、 關鍵演出規格 (Key Sequences)
* **死局波浪與炸散特效 (Deadlock Wave & Scatter)**：
  - **資源依賴**：填補空格階段，必須隨機提取 `118_blockblast_obj_tile_1` 至 `118_blockblast_obj_tile_7` 貼圖。
  - **視覺防呆**：炸散階段因採用程式碼控制 (Code-driven physics)，不使用額外的 Sprite Sheet。但需確保所有方塊的 `vr` (角速度) 與 `vx` (橫向力道) 不超過模糊閾值。
