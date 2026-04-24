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
        tileAssets.push('./assets/118_blockblast_w_combo.png');
        tileAssets.push('./assets/118_blockblast_w_score.png');
        tileAssets.push('./assets/118_blockblast_w_result_1.png');
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
    const vfx = graphicsPool.acquire();
    resetGraphics(vfx);
    vfx.circle(0, 0, CELL_SIZE / 2);
    vfx.fill({ color: 0xffffff });
    vfx.x = x + CELL_SIZE/2;
    vfx.y = y + CELL_SIZE/2;
    vfx.scale.set(0.5);
    vfx.alpha = 1;
    vfx.visible = true;
    vfx.zIndex = 20; 
    
    const tickerCb = () => {
        vfx.scale.set(vfx.scale.x + 0.1);
        vfx.alpha -= 0.08;
        if (vfx.alpha <= 0) {
            vfx.visible = false;
            engine.app.ticker.remove(tickerCb);
            graphicsPool.release(vfx);
        }
    };
    engine.app.ticker.add(tickerCb);
}

function spawnEvaluateVFX(x, y, level, comboCount) {
    const clampedLevel = Math.min(Math.max(level, 1), 6);
    
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
        if (elapsed < 15) {
            evalSpr.scale.set(evalSpr.scale.x + (targetScale - evalSpr.scale.x) * 0.3);
        }
        evalSpr.y -= 2 * time.deltaTime;
        if (elapsed > 45) {
            evalSpr.alpha -= 0.05 * time.deltaTime;
        }
        if (evalSpr.alpha <= 0) {
            evalSpr.visible = false;
            engine.app.ticker.remove(tickerCb);
            spritePool.release(evalSpr);
        }
    };
    engine.app.ticker.add(tickerCb);

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

function checkDeadlock() {
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
        engine.app.stage.eventMode = 'none';
        audio.playDeadlock();
        
        for(let r=0; r<GRID_SIZE; r++){
            for(let c=0; c<GRID_SIZE; c++){
                if(logicGrid[r][c] !== null) {
                    const renderable = engine.world.getComponent(logicGrid[r][c], 'renderable');
                    if(renderable && renderable.view) {
                        renderable.view.texture = PIXI.Texture.from('./assets/118_blockblast_obj_tile_grey.png');
                    }
                }
            }
        }
        
        document.getElementById('final-score').innerText = currentScore;
        document.getElementById('best-score').innerText = globalBestScore;
        document.getElementById('game-over-modal').style.display = 'flex';
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
        
        const addedScore = (lines * 100 * lines) + (comboCount > 1 ? comboCount * 50 : 0); 
        currentScore += addedScore;
        
        if (scoreTextObj) scoreTextObj.text = currentScore.toString();
        
        // 即時更新歷史最高分
        if (currentScore > globalBestScore) {
            globalBestScore = currentScore;
            localStorage.setItem('blockBlastHighScore', globalBestScore);
            if (bestScoreTextObj) bestScoreTextObj.text = globalBestScore.toString();
        }

        let level = 1; 
        if (lines === 2) level = 2; 
        if (lines === 3) level = 3; 
        if (lines === 4) level = 4; 
        if (lines >= 5) level = 5; 
        if (comboCount > 2) level = Math.min(level + 1, 6); // 連擊推高評價
        
        const textX = engine.app.screen.width / 2;
        const textY = gridStartY - 80;
        
        spawnEvaluateVFX(textX, textY, level, comboCount);
    } else {
        comboCount = 0; 
    }

    checkDeadlock();
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
        
        const transform = engine.world.getComponent(piece, 'transform');
        transform.x = e.global.x;
        transform.y = e.global.y - (maxR + 1) * CELL_SIZE - 150; 
        
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

    engine.app.stage.on('pointermove', (e) => {
        if (pointerState.isDragging && pointerState.activeEntity) {
            const transform = engine.world.getComponent(pointerState.activeEntity, 'transform');
            const renderable = engine.world.getComponent(pointerState.activeEntity, 'renderable');
            const dock = engine.world.getComponent(pointerState.activeEntity, 'dock');
            let maxR = 0;
            dock.shape.forEach(b => { if(b.r > maxR) maxR = b.r; });
            
            transform.x = e.global.x;
            transform.y = e.global.y - (maxR + 1) * CELL_SIZE - 150; 
            
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
