# Block Blast 專業開發規格 (GDD Pro)

## 一、 狀態機與生命週期 (State Machine)
* **INIT**：載入資源、初始化 PixiJS Object Pool (方塊、特效)。
* **MENU**：主畫面，顯示關卡地圖、資源列。
* **PLAYING**：玩家正在拖放方塊。包含子狀態：`WAITING_FOR_INPUT`、`DRAGGING`、`ANIMATING_CLEAR`。
* **PAUSED**：遊戲暫停。
* **GAME_OVER**：無法放置新方塊或步數耗盡。觸發失敗結算。
* **RESULT**：達成目標，觸發勝利動畫與獎勵結算。

## 二、 邊界條件與防呆 (Edge Cases & Failsafes)
* **防連點機制**：方塊拖放至格子上觸發 `ANIMATING_CLEAR` 狀態時，封鎖下方的方塊拖曳輸入，直到消除動畫結束 (約 0.4s)。
* **死局判定 (Deadlock)**：每次玩家放置方塊後（或產生新一輪三個方塊時），系統需在背景遍歷 8x8 網格，若剩餘的任一方塊皆無法放進網格的空白處，則判定死局進入 `GAME_OVER`。
* **效能預算 (Perf Budget)**：同畫面特效實體上限 100 個，方塊實體池預熱 150 個。特效必須使用 Deferred Destruction。

## 三、 實體數值矩陣 (Entity Data Matrix)
| 物件 ID (嚴格依據命名規範) | 物件名稱 | 行為特性 | 觸發特效與音效 |
|---|---|---|---|
| `prop_block_blue` | 藍色方塊 | 基本構成單元，1x1，可組成不同形狀 | `vfx_pop_blue` / `sfx_pop_1` |
| `prop_block_red` | 紅色方塊 | 同上 | `vfx_pop_red` / `sfx_pop_1` |
| `prop_item_bomb` | 炸彈道具 | 單點觸發，清除 3x3 範圍 | `vfx_explosion` / `sfx_bomb` |
| `prop_item_hammer` | 槌子道具 | 單點觸發，清除單格方塊 | `vfx_hammer_smash` / `sfx_smash` |

## 四、 難度與經濟曲線 (Difficulty & Economy)
* **難度推演邏輯**：
  - 前 10 關：出現簡單形狀 (1x1, 1x2, 2x2, L型小)。
  - 第 11 關起：加入大形狀 (3x3, L型大, 1x5) 增加死局機率。目標需求數量呈線性遞增。
* **虛擬幣產銷模型**：每關預期獲得 50-100 金幣。使用道具單次消耗 300 金幣。

## 五、 商業化與留存 (Monetization & Retention)
* **激勵影片點位 (Rewarded Ads)**：死局時看廣告可獲得「清空 3x3」或「換牌」以接關。
* **插頁廣告點位 (Interstitial Ads)**：每通關 3 次強制觀看一次跳過型廣告。
