import { World, ObjectPool } from './ecs.js';

class Engine {
    constructor() {
        this.app = new PIXI.Application();
        this.world = new World();
        this.clock = { delta: 0 };
        this.shakeFrames = 0;
        this.shakeIntensity = 0;
    }

    async init(containerId) {
        await this.app.init({ 
            width: 1080,
            height: 2340,
            backgroundAlpha: 0, 
            antialias: true
        });
        
        const container = document.getElementById(containerId);
        container.insertBefore(this.app.canvas, container.firstChild);
        
        this.app.stage.eventMode = 'static';
        this.app.stage.hitArea = new PIXI.Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
        this.app.stage.sortableChildren = true; 

        const tileAssets = Array.from({length: 10}, (_, i) => `./assets/118_blockblast_obj_tile_${i}.png`);
        tileAssets.push('./assets/118_blockblast_obj_tile_grey.png');
        tileAssets.push('./assets/118_blockblast_bg_gradient.png');
        for (let i = 1; i <= 6; i++) tileAssets.push(`./assets/118_blockblast_w_evaluate_${i}.png`);
        for (let i = 1; i <= 8; i++) tileAssets.push(`./assets/rainbow/${i}.png`);
        tileAssets.push('./assets/118_blockblast_w_combo.png');
        tileAssets.push('./assets/118_blockblast_w_score.png');
        tileAssets.push('./assets/118_blockblast_w_result_1.png');
        tileAssets.push('./assets/118_blockblast_fx_tile_glow.png');
        tileAssets.push('./assets/118_shar_light_white.png');
        await PIXI.Assets.load(tileAssets);

        this.app.ticker.add((time) => {
            this.clock.delta = time.deltaTime;
            this.update();
            this.world.flush();
        });
    }

    update() {
        if (this.shakeFrames > 0) {
            const dx = (Math.random() - 0.5) * this.shakeIntensity;
            const dy = (Math.random() - 0.5) * this.shakeIntensity;
            this.app.stage.x = dx;
            this.app.stage.y = dy;
            this.shakeIntensity *= 0.85;
            this.shakeFrames--;
            if (this.shakeFrames <= 0) {
                this.app.stage.x = 0;
                this.app.stage.y = 0;
            }
        }

        for (const [entity, transform] of this.world.getEntries('transform')) {
            const renderable = this.world.getComponent(entity, 'renderable');
            if (renderable && renderable.view) {
                const dx = transform.x - renderable.view.x;
                const dy = transform.y - renderable.view.y;
                if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
                    renderable.view.x = transform.x;
                    renderable.view.y = transform.y;
                } else {
                    renderable.view.x += dx * 0.4;
                    renderable.view.y += dy * 0.4;
                }
                renderable.view.visible = (renderable.view.y > -200 && renderable.view.y < this.app.screen.height + 200);
            }
        }
    }
}

class AudioSynth {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.connect(this.ctx.destination);
        this.masterGain.gain.value = 0.3; 
        this.isMuted = false;
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        this.masterGain.gain.value = this.isMuted ? 0 : 0.3;
        return this.isMuted;
    }

    playTone(freq, type, duration, vol=1) {
        if (this.isMuted) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playPickUp() { this.playTone(300, 'sine', 0.1, 0.5); setTimeout(() => this.playTone(450, 'sine', 0.15, 0.5), 50); }
    playDrop() { this.playTone(200, 'triangle', 0.1, 0.8); }
    playClear(lines) {
        const baseFreq = 300 + lines * 100;
        this.playTone(baseFreq, 'square', 0.2, 0.5);
        setTimeout(() => this.playTone(baseFreq * 1.25, 'square', 0.3, 0.5), 100);
        setTimeout(() => this.playTone(baseFreq * 1.5, 'square', 0.4, 0.5), 200);
    }
    playDeadlock() {
        this.playTone(150, 'sawtooth', 0.5, 0.8);
        setTimeout(() => this.playTone(100, 'sawtooth', 0.8, 0.8), 200);
    }
}

const engine = new Engine();
const audio = new AudioSynth();
const CELL_SIZE = 115; 
const GRID_SIZE = 8;
const logicGrid = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(null)); 

let gridStartX = 0;
let gridStartY = 0;
let graphicsPool = null;
let spritePool = null;
let containerPool = null;
let scoreTextObj = null; 
let bestScoreTextObj = null;

let currentScore = 0;
let globalBestScore = 0;
let comboCount = 0;
let usedPiecesCount = 0;
let isGameOver = false;
const dockedPieces = new Map();

const pointerState = { isDragging: false, activeEntity: null, startX: 0, startY: 0 };

const SHAPE_1x1 = [{r:0,c:0}];
const SHAPE_1x2_H = [{r:0,c:0},{r:0,c:1}];
const SHAPE_1x2_V = [{r:0,c:0},{r:1,c:0}];
const SHAPE_2x2 = [{r:0,c:0},{r:0,c:1},{r:1,c:0},{r:1,c:1}];
const SHAPE_1x3_H = [{r:0,c:0},{r:0,c:1},{r:0,c:2}];
const SHAPE_1x3_V = [{r:0,c:0},{r:1,c:0},{r:2,c:0}];
const SHAPE_L_SMALL = [{r:0,c:0},{r:1,c:0},{r:1,c:1}];
const SHAPE_L_BIG = [{r:0,c:0},{r:0,c:1},{r:0,c:2},{r:1,c:0},{r:2,c:0}];

const SHAPES_SMALL = [SHAPE_1x1, SHAPE_1x2_H, SHAPE_1x2_V];
const SHAPES_MEDIUM = [SHAPE_1x3_H, SHAPE_1x3_V, SHAPE_L_SMALL];
const SHAPES_LARGE = [SHAPE_2x2, SHAPE_L_BIG];

function getEmptyCellsRatio() {
    let empty = 0;
    for(let r=0; r<GRID_SIZE; r++) {
        for(let c=0; c<GRID_SIZE; c++) {
            if(logicGrid[r][c] === null) empty++;
        }
    }
    return empty / (GRID_SIZE * GRID_SIZE);
}

function resetGraphics(gfx) {
    gfx.clear();
    gfx.scale.set(1.0);
    gfx.pivot.set(0, 0);
    gfx.alpha = 1.0;
    gfx.tint = 0xffffff;
    gfx.visible = false;
    gfx.eventMode = 'none';
    gfx.zIndex = 0; 
    gfx.removeAllListeners();
}

function resetSprite(spr) {
    spr.texture = PIXI.Texture.EMPTY;
    spr.scale.set(1.0);
    spr.pivot.set(0, 0);
    spr.anchor.set(0, 0); // 確保歸零
    spr.alpha = 1.0;
    spr.tint = 0xffffff;
    spr.rotation = 0; // 重置旋轉，避免被特效污染
    spr.blendMode = 'normal'; // 重置混合模式
    spr.visible = false;
    spr.eventMode = 'none';
    spr.zIndex = 0;
    spr.removeAllListeners();
    if (spr.parent !== engine.app.stage) {
        engine.app.stage.addChild(spr);
    }
}

function resetContainer(cont) {
    while(cont.children.length > 0) {
        const child = cont.getChildAt(0);
        cont.removeChild(child);
        resetSprite(child);
        spritePool.release(child);
    }
    cont.scale.set(1.0);
    cont.pivot.set(0, 0);
    cont.hitArea = null;
    cont.alpha = 1.0;
    cont.visible = false;
    cont.eventMode = 'none';
    cont.zIndex = 0;
    cont.removeAllListeners();
}

function spawnVFX(x, y) {
    // 1. 爆破震波 (Shockwave)
    const shockwave = spritePool.acquire();
    resetSprite(shockwave);
    shockwave.texture = PIXI.Texture.from('./assets/118_blockblast_fx_tile_glow.png');
    shockwave.anchor.set(0.5);
    shockwave.x = x + CELL_SIZE/2;
    shockwave.y = y + CELL_SIZE/2;
    shockwave.scale.set(0.2);
    shockwave.alpha = 1.0;
    shockwave.blendMode = 'add';
    shockwave.visible = true;
    shockwave.zIndex = 20;

    // 2. 核心星光 (Core Flash)
    const flash = spritePool.acquire();
    resetSprite(flash);
    flash.texture = PIXI.Texture.from('./assets/118_shar_light_white.png');
    flash.anchor.set(0.5);
    flash.x = x + CELL_SIZE/2;
    flash.y = y + CELL_SIZE/2;
    flash.scale.set(0.1);
    flash.alpha = 1.0;
    flash.blendMode = 'add';
    flash.rotation = Math.random() * Math.PI * 2;
    flash.visible = true;
    flash.zIndex = 21;

    // 3. 碎裂粒子 (Particles)
    const particles = [];
    for(let i=0; i<8; i++) {
        const p = spritePool.acquire();
        resetSprite(p);
        p.texture = PIXI.Texture.from('./assets/118_shar_light_white.png');
        p.anchor.set(0.5);
        p.x = x + CELL_SIZE/2;
        p.y = y + CELL_SIZE/2;
        p.scale.set(0.02 + Math.random() * 0.04);
        p.alpha = 1.0;
        p.blendMode = 'add';
        p.visible = true;
        p.zIndex = 22;
        
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 12;
        particles.push({
            sprite: p,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            rot: (Math.random() - 0.5) * 0.4
        });
    }

    let elapsed = 0;
    const tickerCb = (time) => {
        elapsed += time.deltaTime;
        
        // 震波快速放大並消散
        shockwave.scale.set(shockwave.scale.x + 0.15 * time.deltaTime);
        shockwave.alpha -= 0.06 * time.deltaTime;
        
        // 星光旋轉並放大縮小
        flash.rotation += 0.1 * time.deltaTime;
        flash.scale.set(flash.scale.x + 0.12 * time.deltaTime);
        flash.alpha -= 0.08 * time.deltaTime;

        // 粒子噴發與重力下墜
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            if (p.sprite.visible) {
                p.sprite.x += p.vx * time.deltaTime;
                p.sprite.y += p.vy * time.deltaTime;
                p.vy += 0.5 * time.deltaTime; // 重力
                p.sprite.rotation += p.rot * time.deltaTime;
                p.sprite.alpha -= 0.03 * time.deltaTime;
                if (p.sprite.alpha <= 0) {
                    p.sprite.visible = false;
                    spritePool.release(p.sprite);
                }
            }
        }

        // 檢查是否全部結束
        const anyParticleVisible = particles.some(p => p.sprite.visible);
        if (shockwave.alpha <= 0 && flash.alpha <= 0 && !anyParticleVisible) {
            if (shockwave.visible) {
                shockwave.visible = false;
                spritePool.release(shockwave);
            }
            if (flash.visible) {
                flash.visible = false;
                spritePool.release(flash);
            }
            engine.app.ticker.remove(tickerCb);
        }
    };
    engine.app.ticker.add(tickerCb);
}

function spawnEvaluateVFX(x, y, level, comboCount) {
    // 若 level > 0 才顯示評價字樣 (預設2排=1, 3排=2...)
    if (level > 0) {
        const clampedLevel = Math.min(Math.max(level, 1), 6);
        
        // 背部發光特效
        const backLight = spritePool.acquire();
        resetSprite(backLight);
        backLight.texture = PIXI.Texture.from('./assets/118_blockblast_fx_tile_glow.png');
        backLight.anchor.set(0.5);
        backLight.x = x;
        backLight.y = y;
        backLight.scale.set(0.5);
        backLight.alpha = 0.8;
        backLight.blendMode = 'add';
        backLight.visible = true;
        backLight.zIndex = 29;

        const evalSpr = spritePool.acquire();
        resetSprite(evalSpr);
        evalSpr.texture = PIXI.Texture.from(`./assets/118_blockblast_w_evaluate_${clampedLevel}.png`);
        evalSpr.anchor.set(0.5);
        evalSpr.x = x;
        evalSpr.y = y;
        evalSpr.scale.set(0.1);
        evalSpr.alpha = 1;
        evalSpr.visible = true;
        evalSpr.zIndex = 30;

        const targetScale = 0.8 + (clampedLevel * 0.1);

        let elapsed = 0;
        const tickerCb = (time) => {
            elapsed += time.deltaTime;
            
            // 彈性放大 (overshoot)
            if (elapsed < 20) {
                const progress = elapsed / 20;
                // 模擬彈簧效果
                const scale = targetScale * (1 + Math.sin(progress * Math.PI) * 0.3);
                evalSpr.scale.set(scale);
                backLight.scale.set(scale * 1.5);
            } else {
                evalSpr.scale.set(evalSpr.scale.x + (targetScale - evalSpr.scale.x) * 0.2);
            }
            
            // 緩慢向上飄
            evalSpr.y -= 1.5 * time.deltaTime;
            backLight.y -= 1.5 * time.deltaTime;
            backLight.rotation += 0.05 * time.deltaTime;

            if (elapsed > 45) {
                evalSpr.alpha -= 0.05 * time.deltaTime;
                backLight.alpha -= 0.08 * time.deltaTime;
            }
            if (evalSpr.alpha <= 0) {
                evalSpr.visible = false;
                backLight.visible = false;
                engine.app.ticker.remove(tickerCb);
                spritePool.release(evalSpr);
                spritePool.release(backLight);
            }
        };
        engine.app.ticker.add(tickerCb);
    }

    if (comboCount > 1) {
        const comboSpr = spritePool.acquire();
        resetSprite(comboSpr);
        comboSpr.texture = PIXI.Texture.from('./assets/118_blockblast_w_combo.png');
        comboSpr.anchor.set(0.5);
        comboSpr.x = x;
        comboSpr.y = y + 100; // 在評價字眼下方
        comboSpr.scale.set(0.1);
        comboSpr.alpha = 1;
        comboSpr.visible = true;
        comboSpr.zIndex = 29;

        const comboTargetScale = 0.6 + (comboCount * 0.05);

        let comboElapsed = 0;
        const comboTickerCb = (time) => {
            comboElapsed += time.deltaTime;
            if (comboElapsed < 15) {
                comboSpr.scale.set(comboSpr.scale.x + (comboTargetScale - comboSpr.scale.x) * 0.3);
            }
            comboSpr.y -= 1 * time.deltaTime;
            if (comboElapsed > 45) {
                comboSpr.alpha -= 0.05 * time.deltaTime;
            }
            if (comboSpr.alpha <= 0) {
                comboSpr.visible = false;
                engine.app.ticker.remove(comboTickerCb);
                spritePool.release(comboSpr);
            }
        };
        engine.app.ticker.add(comboTickerCb);
    }
}

function triggerGameOverWave() {
    if (isGameOver) return;
    isGameOver = true;
    engine.app.stage.eventMode = 'none';
    audio.playDeadlock();
    
    // 隱藏目前 Dock 上的方塊
    for (const [slotIndex, piece] of dockedPieces.entries()) {
        if (piece) {
            const renderable = engine.world.getComponent(piece, 'renderable');
            if (renderable && renderable.view) renderable.view.visible = false;
        }
    }
    
    // Phase 1: 找出所有空格，進行由下往上、彩虹與常規磚塊交錯的波浪填補
    let newlySpawned = [];
    let allBlocks = [];
    let maxFillDelay = 0;
    
    for (let r = GRID_SIZE - 1; r >= 0; r--) {
        for (let c = 0; c < GRID_SIZE; c++) {
            let entity = logicGrid[r][c];
            let spr;
            let isNew = false;
            
            if (entity === null) {
                isNew = true;
                entity = engine.world.spawn();
                spr = spritePool.acquire();
                resetSprite(spr);
                
                // 僅使用常規磚塊 1~7 (不使用 rainbow)
                const color = ((r + c) % 7) + 1;
                const texPath = `./assets/118_blockblast_obj_tile_${color}.png`;
                
                spr.texture = PIXI.Texture.from(texPath);
                spr.width = CELL_SIZE;
                spr.height = CELL_SIZE;
                spr.x = c * CELL_SIZE + gridStartX;
                spr.y = r * CELL_SIZE + gridStartY;
                spr.visible = false;
                
                engine.world.addComponent(entity, 'transform', { x: spr.x, y: spr.y });
                engine.world.addComponent(entity, 'renderable', { view: spr });
                logicGrid[r][c] = entity;
                
                const rowFromBottom = GRID_SIZE - 1 - r;
                // 由下往上的平滑波浪
                const delay = rowFromBottom * 4; 
                if (delay > maxFillDelay) maxFillDelay = delay;
                
                newlySpawned.push({ spr, delay });
            } else {
                const renderable = engine.world.getComponent(entity, 'renderable');
                spr = renderable.view;
            }
            
            allBlocks.push({ spr, r, c });
        }
    }
    
    // 執行 Phase 1 填補動畫
    newlySpawned.forEach(block => {
        const targetScaleX = block.spr.scale.x;
        const targetScaleY = block.spr.scale.y;
        block.spr.scale.set(0.01);
        
        let sElapsed = 0;
        const scaleTicker = (t) => {
            sElapsed += t.deltaTime;
            if (sElapsed > block.delay) {
                block.spr.visible = true;
                const popProgress = sElapsed - block.delay;
                if (popProgress < 10) {
                    block.spr.scale.x += (targetScaleX - block.spr.scale.x) * 0.4;
                    block.spr.scale.y += (targetScaleY - block.spr.scale.y) * 0.4;
                } else {
                    block.spr.scale.set(targetScaleX, targetScaleY);
                    engine.app.ticker.remove(scaleTicker);
                }
            }
        };
        engine.app.ticker.add(scaleTicker);
    });
    
    // Phase 2: 填補完成後，所有方塊向上炸飛 (優化為絲滑的物理起飛感)
    let phase2Delay = maxFillDelay + 15; 
    let flyElapsed = 0;
    
    // 預先為每個方塊分配飛行物理屬性
    allBlocks.forEach(block => {
        block.vy = 0; // 初始速度為 0，創造 Ease-In 的絲滑起步
        block.vx = (Math.random() - 0.5) * 8; // 水平炸散力道
        block.vr = (Math.random() - 0.5) * 0.4; // 旋轉力道
        // 極短的階梯起飛延遲：上方先動，下方跟上 (創造連動波浪感)
        block.flyDelay = block.r * 1.5; 
    });
    
    const flyTicker = (t) => {
        flyElapsed += t.deltaTime;
        if (flyElapsed > phase2Delay) {
            allBlocks.forEach(block => {
                const activeTime = flyElapsed - phase2Delay;
                if (activeTime > block.flyDelay) {
                    // 平滑加速起飛 (重力反轉)
                    block.vy -= 1.0 * t.deltaTime; 
                    block.spr.y += block.vy * t.deltaTime;
                    
                    // 當方塊飛超過原始盤面的最頂端時，才觸發「散開」與「漸隱」
                    // 這樣能維持原本整塊方塊向上推的視覺，直到頂部才如碎片般炸散
                    if (block.spr.y < gridStartY) {
                        block.spr.x += block.vx * t.deltaTime;
                        block.spr.rotation += block.vr * t.deltaTime;
                        block.spr.alpha = Math.max(0, block.spr.alpha - 0.03 * t.deltaTime);
                    }
                }
            });
            
            // 飛行一段時間後顯示結算畫面並清理
            if (flyElapsed > phase2Delay + 60) {
                engine.app.ticker.remove(flyTicker);
                document.getElementById('final-score').innerText = currentScore;
                document.getElementById('best-score').innerText = globalBestScore;
                document.getElementById('game-over-modal').style.display = 'flex';
                
                allBlocks.forEach(b => {
                    const e = logicGrid[b.r][b.c];
                    if (e) {
                        resetSprite(b.spr);
                        spritePool.release(b.spr);
                        engine.world.components.get('renderable').delete(e);
                        engine.world.destroy(e);
                        logicGrid[b.r][b.c] = null;
                    }
                });
            }
        }
    };
    engine.app.ticker.add(flyTicker);
}

function checkDeadlock() {
    if (isGameOver) return;
    let canFitAny = false;
    let totalPieces = 0;
    
    for (const [slotIndex, piece] of dockedPieces.entries()) {
        if (!piece) continue; 
        totalPieces++;
        const dock = engine.world.getComponent(piece, 'dock');
        const viewInfo = engine.world.getComponent(piece, 'renderable');
        
        let canFitThisPiece = false;
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                let fit = true;
                for (const b of dock.shape) {
                    const checkR = r + b.r;
                    const checkC = c + b.c;
                    if (checkR < 0 || checkR >= GRID_SIZE || checkC < 0 || checkC >= GRID_SIZE || logicGrid[checkR][checkC] !== null) {
                        fit = false;
                        break;
                    }
                }
                if (fit) { canFitThisPiece = true; break; }
            }
            if (canFitThisPiece) break;
        }
        
        if (canFitThisPiece) canFitAny = true;
        
        // 即時預警：如果這個方塊無處可放，將其變為 tile_9 以提示玩家
        const targetTile = canFitThisPiece ? dock.tileIndex : 9;
        if (viewInfo && viewInfo.view) {
            const container = viewInfo.view;
            for (let i = 0; i < container.children.length; i++) {
                container.children[i].texture = PIXI.Texture.from(`./assets/118_blockblast_obj_tile_${targetTile}.png`);
            }
        }
    }
    
    if (totalPieces > 0 && !canFitAny) {
        triggerGameOverWave();
    }
}

function checkElimination() {
    const rowsToClear = [];
    const colsToClear = [];
    
    for (let r = 0; r < GRID_SIZE; r++) {
        let full = true;
        for (let c = 0; c < GRID_SIZE; c++) { if (logicGrid[r][c] === null) full = false; }
        if (full) rowsToClear.push(r);
    }
    for (let c = 0; c < GRID_SIZE; c++) {
        let full = true;
        for (let r = 0; r < GRID_SIZE; r++) { if (logicGrid[r][c] === null) full = false; }
        if (full) colsToClear.push(c);
    }
    
    const clearEntity = (r, c) => {
        const e = logicGrid[r][c];
        if (e !== null) {
            const renderable = engine.world.getComponent(e, 'renderable');
            if (renderable) {
                spawnVFX(renderable.view.x, renderable.view.y);
                resetSprite(renderable.view);
                spritePool.release(renderable.view); 
                engine.world.components.get('renderable').delete(e);
            }
            engine.world.destroy(e); 
            logicGrid[r][c] = null;
        }
    };

    rowsToClear.forEach(r => { for (let c = 0; c < GRID_SIZE; c++) clearEntity(r, c); });
    colsToClear.forEach(c => { for (let r = 0; r < GRID_SIZE; r++) clearEntity(r, c); });

    const lines = rowsToClear.length + colsToClear.length;
    if (lines > 0) {
        comboCount++;
        audio.playClear(lines);
        
        engine.shakeIntensity = lines * 15 + (comboCount > 1 ? 10 : 0);
        engine.shakeFrames = 15;
        
        // 分數指數成長：1排=100, 2排=200, 3排=400, 4排=800, 5排=1600 ... 
        const addedScore = 100 * Math.pow(2, lines - 1) + (comboCount > 1 ? comboCount * 50 : 0); 
        currentScore += addedScore;
        
        if (scoreTextObj) scoreTextObj.text = currentScore.toString();
        
        // 即時更新歷史最高分
        if (currentScore > globalBestScore) {
            globalBestScore = currentScore;
            localStorage.setItem('blockBlastHighScore', globalBestScore);
            if (bestScoreTextObj) bestScoreTextObj.text = globalBestScore.toString();
        }

        // 預設二排才開始顯示 Evaluate 圖示 (1到6)
        let level = 0; 
        if (lines >= 2) {
            level = lines - 1; // 2排=1, 3排=2, 4排=3, 5排=4, 6排=5
            if (comboCount > 2) level += 1; // 連擊推高一階評價
        }
        
        const textX = engine.app.screen.width / 2;
        const textY = gridStartY + 350; // 移至網格中間偏上的位置，避免與上方分數遮擋
        
        if (level > 0 || comboCount > 1) {
            spawnEvaluateVFX(textX, textY, level, comboCount);
        }
    } else {
        comboCount = 0; 
    }

    checkDeadlock();
}

function getDynamicOffsetY(fingerY) {
    // Dock 區約在螢幕底部 400px，網格區約在底部 900px 以上
    const dockY = engine.app.screen.height - 400; 
    const gridY = engine.app.screen.height - 900; 
    
    // 在下方 Dock 區時，距離游標 80px (保持抓取的實體感)
    if (fingerY >= dockY) return 80;
    // 在上方網格區時，距離游標拉開到 280px (確保手指絕對不會擋住視線)
    if (fingerY <= gridY) return 280;
    
    // 兩者之間進行平滑過渡 (Lerp)
    const t = (dockY - fingerY) / (dockY - gridY); 
    return 80 + t * 200;
}

function spawnPiece(slotIndex) {
    const ratio = getEmptyCellsRatio();
    let pool = [];
    
    if (ratio > 0.7) {
        pool = [...SHAPES_LARGE, ...SHAPES_LARGE, ...SHAPES_MEDIUM, ...SHAPES_SMALL];
    } else if (ratio < 0.35) {
        pool = [...SHAPES_SMALL, ...SHAPES_SMALL, ...SHAPES_MEDIUM, SHAPE_1x1]; 
    } else {
        pool = [...SHAPES_SMALL, ...SHAPES_MEDIUM, ...SHAPES_LARGE];
    }
    
    const shape = pool[Math.floor(Math.random() * pool.length)];
    const tileIndex = Math.floor(Math.random() * 8) + 1; // 1~8 (排除 0 與 9)
    const piece = engine.world.spawn();
    
    const container = containerPool.acquire();
    resetContainer(container);
    
    let maxR = 0, maxC = 0;
    shape.forEach(b => {
        const spr = spritePool.acquire();
        resetSprite(spr);
        spr.texture = PIXI.Texture.from(`./assets/118_blockblast_obj_tile_${tileIndex}.png`);
        spr.width = CELL_SIZE;
        spr.height = CELL_SIZE;
        spr.x = b.c * CELL_SIZE;
        spr.y = b.r * CELL_SIZE;
        spr.visible = true;
        container.addChild(spr);
        
        if(b.r > maxR) maxR = b.r;
        if(b.c > maxC) maxC = b.c;
    });
    
    container.alpha = 0.9;
    container.visible = true;
    container.scale.set(0.7); 
    container.zIndex = 5; 
    
    const pivotX = (maxC * CELL_SIZE + CELL_SIZE) / 2;
    const pivotY = (maxR * CELL_SIZE + CELL_SIZE) / 2;
    container.pivot.set(pivotX, pivotY);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.hitArea = new PIXI.Rectangle(0, 0, (maxC + 1) * CELL_SIZE, (maxR + 1) * CELL_SIZE);

    const sectionWidth = engine.app.screen.width / 3;
    const startX = (slotIndex * sectionWidth) + (sectionWidth / 2);
    const startY = engine.app.screen.height - 350; 

    container.on('pointerdown', (e) => {
        audio.playPickUp();
        pointerState.isDragging = true;
        pointerState.activeEntity = piece;
        pointerState.startX = startX;
        pointerState.startY = startY;
        
        container.scale.set(1.0); 
        container.zIndex = 10; 
        
        const dock = engine.world.getComponent(piece, 'dock');
        const transform = engine.world.getComponent(piece, 'transform');
        
        transform.x = e.global.x;
        // 導入動態 Y 軸位移：越往上拖曳，方塊會浮得越高，拉開與手指的空間
        const dynamicOffset = getDynamicOffsetY(e.global.y);
        transform.y = e.global.y - dynamicOffset - dock.pivotY; 
        
        // 點擊瞬間直接鎖定座標，消除初始吸附的延遲感
        container.x = transform.x;
        container.y = transform.y;
    });

    container.x = startX;
    container.y = startY;
    
    engine.world.addComponent(piece, 'transform', { x: startX, y: startY });
    engine.world.addComponent(piece, 'renderable', { view: container });
    engine.world.addComponent(piece, 'dock', { slotIndex, shape, tileIndex, pivotX, pivotY });
    
    dockedPieces.set(slotIndex, piece);
}

async function startGame() {
    await engine.init('game-container');

    // 載入全局最高分
    globalBestScore = parseInt(localStorage.getItem('blockBlastHighScore') || 0);

    // 加上底層華麗漸層背景
    const bg = new PIXI.Sprite(PIXI.Texture.from('./assets/118_blockblast_bg_gradient.png'));
    bg.width = engine.app.screen.width;
    bg.height = engine.app.screen.height;
    bg.zIndex = -100;
    engine.app.stage.addChild(bg);

    document.getElementById('restart-btn').addEventListener('click', () => {
        window.location.reload();
    });

    document.getElementById('mute-btn').addEventListener('click', (e) => {
        const isMuted = audio.toggleMute();
        e.target.innerText = isMuted ? '🔇' : '🔊';
    });
    
    // 綁定測試波浪動畫按鈕
    const testBtn = document.getElementById('test-deadlock-btn');
    if(testBtn) {
        testBtn.addEventListener('click', () => {
            triggerGameOverWave();
        });
    }

    engine.app.stage.on('pointermove', (e) => {
        if (pointerState.isDragging && pointerState.activeEntity) {
            const transform = engine.world.getComponent(pointerState.activeEntity, 'transform');
            const renderable = engine.world.getComponent(pointerState.activeEntity, 'renderable');
            const dock = engine.world.getComponent(pointerState.activeEntity, 'dock');
            
            transform.x = e.global.x;
            // 套用動態 Y 軸位移：拖進網格區時自動拉大空間
            const dynamicOffset = getDynamicOffsetY(e.global.y);
            transform.y = e.global.y - dynamicOffset - dock.pivotY; 
            
            // 拖曳時強制同步視覺座標，完全繞過 update() 中的 lerp (補間動畫)
            // 這樣方塊會 100% 黏著滑鼠/手指，達到極致滑順的跟手感
            if (renderable && renderable.view) {
                renderable.view.x = transform.x;
                renderable.view.y = transform.y;
            }
        }
    });

    engine.app.stage.on('pointerup', (e) => {
        if (pointerState.isDragging && pointerState.activeEntity) {
            const piece = pointerState.activeEntity;
            const transform = engine.world.getComponent(piece, 'transform');
            const viewInfo = engine.world.getComponent(piece, 'renderable');
            const dock = engine.world.getComponent(piece, 'dock');
            
            viewInfo.view.scale.set(0.7);
            viewInfo.view.zIndex = 5;
            
            const baseRelativeX = transform.x - dock.pivotX - gridStartX; 
            const baseRelativeY = transform.y - dock.pivotY - gridStartY;
            const baseCol = Math.round(baseRelativeX / CELL_SIZE);
            const baseRow = Math.round(baseRelativeY / CELL_SIZE);
            
            let canPlace = true;
            for (const b of dock.shape) {
                const r = baseRow + b.r;
                const c = baseCol + b.c;
                if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE || logicGrid[r][c] !== null) {
                    canPlace = false;
                    break;
                }
            }
            
            if (canPlace) {
                audio.playDrop();
                for (const b of dock.shape) {
                    const r = baseRow + b.r;
                    const c = baseCol + b.c;
                    
                    const cellEntity = engine.world.spawn();
                    const cellSprite = spritePool.acquire();
                    resetSprite(cellSprite);
                    
                    cellSprite.texture = PIXI.Texture.from(`./assets/118_blockblast_obj_tile_${dock.tileIndex}.png`);
                    cellSprite.width = CELL_SIZE;
                    cellSprite.height = CELL_SIZE;
                    cellSprite.x = gridStartX + c * CELL_SIZE;
                    cellSprite.y = gridStartY + r * CELL_SIZE;
                    cellSprite.visible = true;
                    cellSprite.zIndex = 1; 
                    
                    engine.world.addComponent(cellEntity, 'transform', { x: cellSprite.x, y: cellSprite.y });
                    engine.world.addComponent(cellEntity, 'renderable', { view: cellSprite });
                    logicGrid[r][c] = cellEntity;
                }
                
                resetContainer(viewInfo.view);
                containerPool.release(viewInfo.view);
                engine.world.components.get('renderable').delete(piece);
                engine.world.destroy(piece);
                
                dockedPieces.set(dock.slotIndex, null);
                usedPiecesCount++;
                
                if (usedPiecesCount === 3) {
                    usedPiecesCount = 0;
                    spawnPiece(0);
                    spawnPiece(1);
                    spawnPiece(2);
                }
                
                checkElimination();
            } else {
                transform.x = pointerState.startX;
                transform.y = pointerState.startY;
            }
            
            pointerState.isDragging = false;
            pointerState.activeEntity = null;
        }
    });
    engine.app.stage.on('pointerupoutside', (e) => engine.app.stage.emit('pointerup', e));

    graphicsPool = new ObjectPool(() => {
        const gfx = new PIXI.Graphics();
        engine.app.stage.addChild(gfx);
        return gfx;
    }, 100);

    spritePool = new ObjectPool(() => {
        const spr = new PIXI.Sprite();
        engine.app.stage.addChild(spr);
        return spr;
    }, 200);

    containerPool = new ObjectPool(() => {
        const cont = new PIXI.Container();
        engine.app.stage.addChild(cont);
        return cont;
    }, 10);

    gridStartX = engine.app.screen.width / 2 - (GRID_SIZE * CELL_SIZE) / 2;
    gridStartY = engine.app.screen.height / 2 - (GRID_SIZE * CELL_SIZE) / 2 - 150;

    // 加上 Score 的背景面板 (使用 w_score)
    const scoreBg = new PIXI.Sprite(PIXI.Texture.from('./assets/118_blockblast_w_score.png'));
    scoreBg.anchor.set(0.5);
    scoreBg.x = engine.app.screen.width / 2;
    scoreBg.y = gridStartY - 230;
    scoreBg.scale.set(0.7);
    scoreBg.zIndex = 4;
    engine.app.stage.addChild(scoreBg);

    scoreTextObj = new PIXI.Text({
        text: '0',
        style: {
            fontFamily: 'Impact, sans-serif',
            fontSize: 160, 
            fill: '#ffffff',
            stroke: { color: '#1e3c72', width: 12 },
            dropShadow: { color: '#000000', alpha: 0.2, blur: 10, distance: 10 }
        }
    });
    scoreTextObj.anchor.set(0.5);
    scoreTextObj.x = engine.app.screen.width / 2;
    scoreTextObj.y = gridStartY - 120; // 放在 SCORE 字樣下方
    scoreTextObj.zIndex = 5; 
    engine.app.stage.addChild(scoreTextObj);

    // 加上左上角歷史最高分 (Best Score) UI
    const bestScoreIcon = new PIXI.Sprite(PIXI.Texture.from('./assets/118_blockblast_w_result_1.png'));
    bestScoreIcon.anchor.set(0.5, 0.5); // 改為中心對齊
    bestScoreIcon.scale.set(0.6); 
    bestScoreIcon.x = 160; // 絕對 X 軸
    bestScoreIcon.y = 80;
    bestScoreIcon.zIndex = 4;
    engine.app.stage.addChild(bestScoreIcon);

    bestScoreTextObj = new PIXI.Text({
        text: globalBestScore.toString(),
        style: {
            fontFamily: 'Impact, sans-serif',
            fontSize: 70, 
            fill: '#ffd15b', 
            stroke: { color: '#1e3c72', width: 8 },
            dropShadow: { color: '#000000', alpha: 0.3, blur: 5, distance: 5 }
        }
    });
    bestScoreTextObj.anchor.set(0.5, 0.5); // 改為中心對齊，確保數字增長時向兩側延伸
    bestScoreTextObj.x = 160; // 與 Icon 相同的絕對 X 軸
    bestScoreTextObj.y = 150; 
    bestScoreTextObj.zIndex = 5; 
    engine.app.stage.addChild(bestScoreTextObj);

    for(let r=0; r<GRID_SIZE; r++){
        for(let c=0; c<GRID_SIZE; c++){
            const cell = engine.world.spawn();
            const view = graphicsPool.acquire();
            resetGraphics(view);
            view.roundRect(2, 2, CELL_SIZE - 4, CELL_SIZE - 4, 15);
            view.fill({ color: 0xffffff });
            view.tint = 0x1f2687;
            view.alpha = 0.2;
            view.visible = true;
            view.zIndex = 0; 
            
            engine.world.addComponent(cell, 'transform', { x: gridStartX + c * CELL_SIZE, y: gridStartY + r * CELL_SIZE });
            engine.world.addComponent(cell, 'renderable', { view });
        }
    }

    for(let i=0; i<3; i++){
        spawnPiece(i);
    }
}

startGame();
