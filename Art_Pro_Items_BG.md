# Block Blast 量產規格：原畫與場景 (Art Pro Items & BG)

## 一、 背景規格 (Background)
* **命名規範**：`bg_main_purple.png`, `bg_grid_board.png`
* **尺寸格式**：1080 x 1920 (滿版底圖)，保留安全框。JPG 格式，可適度壓縮。
* **設計要點**：
  - 網格板 `bg_grid_board.png` 需要有清晰的 8x8 九宮格凹槽質感，顏色為深色半透明（如 Alpha 40% 的深藍），邊緣需帶有圓角與微光。

## 二、 遊戲內物件規格 (Props)
* **命名規範**：`prop_block_red.png`, `prop_block_blue.png`, `prop_item_bomb.png`
* **尺寸格式**：
  - 基礎 1x1 方塊：單格尺寸 100x100 px。PNG-24 透明去背。
  - 組合方塊需由程式拼接，美術僅需提供單格圖資，邊界必須 100% 吻合不可有半像素黑邊。
* **設計要點**：
  - 方塊外觀必須是 Q 版圓潤邊角。內部帶有高光反射，看起來像果凍或水晶彈珠。
  - 道具需設計為 150x150 px 的精緻圖標，帶有發光外暈。
