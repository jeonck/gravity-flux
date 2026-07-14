/* ============================================================
   GRAVITY FLUX — 중력 시프트 테트리스
   12×12 정사각 보드: 스택을 90° 회전시켜 연쇄 클리어를 만든다
   ============================================================ */
'use strict';

/* ── 상수 ─────────────────────────────────────────── */
const COLS = 12, ROWS = 12, CELL = 37;
const HIDDEN_SPAWN_Y = -2;
const MAX_CHARGES = 3;
const LINES_PER_CHARGE = 3;
const FEVER_MAX = 100;
const FEVER_DURATION = 10000; // ms

const COLORS = {
  I: '#00e5ff', O: '#ffd54a', T: '#c56bff',
  S: '#5aff8a', Z: '#ff5a6e', J: '#5a8dff', L: '#ff9d3a',
};

const SHAPES = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, -2], [2, 0], [-2, 0]];

/* ── DOM ──────────────────────────────────────────── */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const el = {
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  level: document.getElementById('level'),
  lines: document.getElementById('lines'),
  maxChain: document.getElementById('max-chain'),
  charges: document.getElementById('charges'),
  feverBar: document.getElementById('fever-bar'),
  boardWrap: document.getElementById('board-wrap'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayMsg: document.getElementById('overlay-msg'),
  startBtn: document.getElementById('start-btn'),
};

/* ── 사운드 (WebAudio 신디사이저) ─────────────────── */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 미지원 */ }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function beep(freq, dur = 0.08, type = 'square', vol = 0.06, slideTo = null) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, audioCtx.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, audioCtx.currentTime + dur);
  g.gain.setValueAtTime(vol, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + dur + 0.02);
}
const SFX = {
  move: () => beep(220, 0.03, 'square', 0.025),
  rotate: () => beep(330, 0.05, 'square', 0.04),
  lock: () => beep(150, 0.06, 'triangle', 0.06),
  hard: () => beep(110, 0.1, 'sawtooth', 0.07, 60),
  clear: n => beep(440 + n * 110, 0.15, 'square', 0.07, 660 + n * 110),
  shift: () => beep(90, 0.4, 'sawtooth', 0.09, 500),
  chain: d => beep(500 + d * 150, 0.2, 'square', 0.08, 900 + d * 200),
  fever: () => beep(660, 0.5, 'sawtooth', 0.08, 1320),
  hold: () => beep(280, 0.05, 'triangle', 0.05),
  over: () => beep(300, 0.8, 'sawtooth', 0.09, 60),
  charge: () => beep(880, 0.12, 'sine', 0.07, 1760),
};

/* ── 게임 상태 ────────────────────────────────────── */
const G = {
  phase: 'menu', // menu | play | rotating | falling | clearing | paused | gameover
  grid: [],
  bag: [],
  queue: [],
  piece: null,
  hold: null,
  holdUsed: false,
  score: 0, best: 0, level: 1, lines: 0,
  combo: -1,
  chain: 0, maxChain: 0,
  charges: 1, chargeProgress: 0,
  pidSeq: 0,
  fever: { gauge: 0, active: false, until: 0 },
  dropTimer: 0, dropInterval: 800,
  lockTimer: 0, lockDelay: 450, grounded: false, lockResets: 0,
  shake: 0,
  particles: [],
  popups: [],
  anim: null, // 진행 중인 애니메이션 상태
  cascadeMode: false, // 시프트 이후 연쇄 판정 모드
  lastTime: 0,
};

function emptyGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

/* ── 7-bag 랜덤 ───────────────────────────────────── */
function refillBag() {
  const types = Object.keys(SHAPES);
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  G.bag.push(...types);
}
function nextType() {
  if (G.bag.length < 4) refillBag();
  return G.bag.shift();
}

/* ── 피스 ─────────────────────────────────────────── */
function rotateCells(cells, size, dir) {
  return cells.map(([x, y]) => dir > 0 ? [size - 1 - y, x] : [y, size - 1 - x]);
}
function makePiece(type) {
  const s = SHAPES[type];
  return { type, size: s.size, cells: s.cells.map(c => [...c]), x: Math.floor((COLS - s.size) / 2), y: HIDDEN_SPAWN_Y };
}
function pieceCells(p, dx = 0, dy = 0, cells = null) {
  return (cells || p.cells).map(([cx, cy]) => [p.x + cx + dx, p.y + cy + dy]);
}
function collides(p, dx = 0, dy = 0, cells = null) {
  for (const [x, y] of pieceCells(p, dx, dy, cells)) {
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && G.grid[y][x]) return true;
  }
  return false;
}
function ghostY(p) {
  let dy = 0;
  while (!collides(p, 0, dy + 1)) dy++;
  return p.y + dy;
}

/* ── 스폰/홀드 ────────────────────────────────────── */
function spawnPiece(type = null) {
  G.piece = makePiece(type || G.queue.shift());
  while (G.queue.length < 3) G.queue.push(nextType());
  G.holdUsed = false;
  G.grounded = false;
  G.lockTimer = 0;
  G.lockResets = 0;
  G.dropTimer = 0;
  if (collides(G.piece)) return gameOver();
  renderSidePanels();
}
function doHold() {
  if (G.phase !== 'play' || G.holdUsed || !G.piece) return;
  ensureAudio(); SFX.hold();
  const cur = G.piece.type;
  if (G.hold) { spawnPiece(G.hold); } else { spawnPiece(); }
  G.hold = cur;
  G.holdUsed = true;
  renderSidePanels();
}

/* ── 이동/회전 ────────────────────────────────────── */
function tryMove(dx, dy) {
  if (!G.piece || G.phase !== 'play') return false;
  if (!collides(G.piece, dx, dy)) {
    G.piece.x += dx; G.piece.y += dy;
    if (dx !== 0) SFX.move();
    resetLockOnMove();
    return true;
  }
  return false;
}
function tryRotate(dir) {
  if (!G.piece || G.phase !== 'play') return;
  const p = G.piece;
  if (p.type === 'O') return;
  const rotated = rotateCells(p.cells, p.size, dir);
  for (const [kx, ky] of KICKS) {
    if (!collides(p, kx, ky, rotated)) {
      p.cells = rotated; p.x += kx; p.y += ky;
      SFX.rotate();
      resetLockOnMove();
      return;
    }
  }
}
function resetLockOnMove() {
  if (G.grounded && G.lockResets < 12) { G.lockTimer = 0; G.lockResets++; }
}
function hardDrop() {
  if (!G.piece || G.phase !== 'play') return;
  let dist = 0;
  while (!collides(G.piece, 0, 1)) { G.piece.y++; dist++; }
  addScore(dist * 2);
  G.shake = Math.min(G.shake + 5, 9);
  SFX.hard();
  lockPiece();
}

/* ── 락 & 일반 라인 클리어 ────────────────────────── */
function lockPiece() {
  const p = G.piece;
  const pid = ++G.pidSeq;
  let above = false;
  for (const [x, y] of pieceCells(p)) {
    if (y < 0) { above = true; continue; }
    G.grid[y][x] = { c: COLORS[p.type], p: pid };
  }
  G.piece = null;
  SFX.lock();
  if (above) return gameOver();

  const rows = fullRows();
  if (rows.length > 0) {
    G.combo++;
    G.cascadeMode = false;
    startClearing(rows, 0);
  } else {
    G.combo = -1;
    spawnPiece();
  }
}
function fullRows() {
  const rows = [];
  for (let y = 0; y < ROWS; y++) {
    if (G.grid[y].every(c => c)) rows.push(y);
  }
  return rows;
}

/* ── 클리어 연출 → 제거 → 낙하 ────────────────────── */
function startClearing(rows, chainDepth) {
  G.phase = 'clearing';
  G.anim = { kind: 'clearing', rows, t: 0, dur: 260, chainDepth };
  scoreClear(rows.length, chainDepth);
  spawnClearParticles(rows);
  if (chainDepth > 0) {
    SFX.chain(chainDepth);
    popup(`${chainDepth + 1} CHAIN!`, canvas.width / 2, ROWS * CELL * 0.35, '#ff2e88', 30);
    G.shake = Math.min(G.shake + 4 + chainDepth * 2, 14);
  } else if (G.cascadeMode) {
    SFX.chain(0);
    popup('GRAVITY CLEAR!', canvas.width / 2, ROWS * CELL * 0.35, '#00e5ff', 28);
  } else {
    SFX.clear(rows.length);
    if (rows.length === 4) popup('QUAD!', canvas.width / 2, ROWS * CELL * 0.35, '#ffd54a', 30);
    else if (G.combo > 0) popup(`${G.combo} COMBO`, canvas.width / 2, ROWS * CELL * 0.3, '#00e5ff', 22);
  }
}
function finishClearing(a) {
  const { rows, chainDepth } = a;
  addLines(rows.length);
  for (const y of rows) G.grid[y] = Array(COLS).fill(null);

  if (G.cascadeMode) {
    // 시프트 연쇄: 모든 블록이 개별 낙하 → 새 클리어 검사
    startFalling(computeCascade(), () => afterCascadeSettle(chainDepth + 1));
  } else {
    // 클래식: 지워진 행 위 블록이 통째로 내려옴
    startFalling(computeRowCollapse(rows), () => { G.phase = 'play'; spawnPiece(); });
  }
}

/* 클래식 붕괴: 각 셀이 (아래에 있는 클리어된 행 수)만큼 낙하 */
function computeRowCollapse(clearedRows) {
  const moves = [];
  const newGrid = emptyGrid();
  for (let y = 0; y < ROWS; y++) {
    if (!G.grid[y].some(c => c)) continue;
    const shift = clearedRows.filter(r => r > y).length;
    for (let x = 0; x < COLS; x++) {
      if (G.grid[y][x]) {
        newGrid[y + shift][x] = G.grid[y][x];
        if (shift > 0) moves.push({ x, fromY: y, toY: y + shift, color: G.grid[y][x].c });
      }
    }
  }
  G.grid = newGrid;
  return moves;
}

/* 캐스케이드: 테트로미노 강체(rigid group) 단위 낙하
   같은 피스(pid)의 연결된 셀들은 한 덩어리로 떨어진다.
   구멍이 유지되므로 클리어 → 지지대 붕괴 → 재낙하 → 체인이 성립한다. */
function buildGroups() {
  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const groups = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!G.grid[y][x] || seen[y][x]) continue;
      const pid = G.grid[y][x].p;
      const cells = [];
      const stack = [[x, y]];
      seen[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push({ x: cx, y: cy, cell: G.grid[cy][cx] });
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
          if (seen[ny][nx] || !G.grid[ny][nx] || G.grid[ny][nx].p !== pid) continue;
          seen[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      groups.push({ cells, fall: 0 });
    }
  }
  return groups;
}
function computeCascade() {
  const groups = buildGroups();
  // 점유 맵: 셀 → 그룹 인덱스
  const occ = Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
  groups.forEach((g, i) => g.cells.forEach(c => { occ[c.y][c.x] = i; }));

  const canFall = i => groups[i].cells.every(c => {
    const ny = c.y + 1;
    return ny < ROWS && (occ[ny][c.x] === -1 || occ[ny][c.x] === i);
  });
  const dropOne = i => {
    for (const c of groups[i].cells) occ[c.y][c.x] = -1;
    for (const c of groups[i].cells) { c.y++; occ[c.y][c.x] = i; }
    groups[i].fall++;
  };

  let moved = true;
  let guard = 0;
  while (moved && guard++ < ROWS * ROWS) {
    moved = false;
    // 아래쪽 그룹부터 처리해야 위 그룹이 연달아 떨어질 수 있음
    const order = groups.map((_, i) => i)
      .sort((a, b) => Math.max(...groups[b].cells.map(c => c.y)) - Math.max(...groups[a].cells.map(c => c.y)));
    for (const i of order) {
      while (canFall(i)) { dropOne(i); moved = true; }
    }
  }

  // 그리드 재작성 + 이동 목록
  const moves = [];
  G.grid = emptyGrid();
  for (const g of groups) {
    for (const c of g.cells) {
      G.grid[c.y][c.x] = c.cell;
      if (g.fall > 0) moves.push({ x: c.x, fromY: c.y - g.fall, toY: c.y, color: c.cell.c });
    }
  }
  return moves;
}

/* ── 낙하 애니메이션 ──────────────────────────────── */
function startFalling(moves, onDone) {
  if (moves.length === 0) { onDone(); return; }
  const maxDist = Math.max(...moves.map(m => m.toY - m.fromY));
  G.phase = 'falling';
  G.anim = { kind: 'falling', moves, t: 0, dur: Math.min(120 + maxDist * 40, 480), onDone };
}

/* ── 중력 시프트 (핵심 메커니즘!) ─────────────────── */
function gravityShift(dir) {
  if (G.phase !== 'play') return;
  if (G.charges <= 0) { popup('NO CHARGE!', canvas.width / 2, ROWS * CELL * 0.4, '#8888bb', 18); return; }
  if (!G.grid.some(row => row.some(c => c))) { popup('보드가 비어있음', canvas.width / 2, ROWS * CELL * 0.4, '#8888bb', 16); return; }

  G.charges--;
  ensureAudio(); SFX.shift();
  G.shake = Math.min(G.shake + 6, 12);
  popup(dir > 0 ? 'GRAVITY SHIFT ↻' : 'GRAVITY SHIFT ↺', canvas.width / 2, ROWS * CELL * 0.25, '#00e5ff', 24);

  // 회전된 그리드 계산 (CW: nx=N-1-y, ny=x / CCW: nx=y, ny=N-1-x)
  const rotated = emptyGrid();
  const snapshot = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!G.grid[y][x]) continue;
      snapshot.push({ x, y, color: G.grid[y][x].c });
      const nx = dir > 0 ? ROWS - 1 - y : y;
      const ny = dir > 0 ? x : COLS - 1 - x;
      rotated[ny][nx] = G.grid[y][x];
    }
  }
  G.phase = 'rotating';
  G.anim = { kind: 'rotating', dir, t: 0, dur: 420, snapshot, rotated };
  updateHUD();
}
function finishRotating(a) {
  G.grid = a.rotated;
  startFalling(computeCascade(), () => afterCascadeSettle(0));
}
function afterCascadeSettle(chainDepth) {
  const rows = fullRows();
  if (rows.length > 0) {
    G.cascadeMode = true;
    if (chainDepth + 1 > G.maxChain) G.maxChain = chainDepth + 1;
    startClearing(rows, chainDepth);
  } else {
    G.cascadeMode = false;
    G.chain = 0;
    // 얼려둔 현재 피스가 새 지형과 겹치면 위로 밀어냄
    if (G.piece) {
      let guard = 0;
      while (collides(G.piece) && guard++ < ROWS + 4) G.piece.y--;
    }
    G.phase = 'play';
    updateHUD();
  }
}

/* ── 점수/레벨/차지/피버 ──────────────────────────── */
function addScore(n) {
  G.score += G.fever.active ? n * 2 : n;
  updateHUD();
}
function scoreClear(numLines, chainDepth) {
  const base = [0, 100, 300, 500, 800][Math.min(numLines, 4)] * G.level;
  const chainMult = Math.min(Math.pow(2, chainDepth), 8);
  const comboBonus = chainDepth === 0 && G.combo > 0 ? 50 * G.combo * G.level : 0;
  addScore(Math.round(base * chainMult + comboBonus));
  addFever(numLines * 9 + chainDepth * 22 + (G.combo > 0 ? G.combo * 6 : 0));
}
function addLines(n) {
  G.lines += n;
  const newLevel = Math.floor(G.lines / 10) + 1;
  if (newLevel > G.level) {
    G.level = newLevel;
    G.dropInterval = Math.max(90, 800 - (G.level - 1) * 60);
    popup(`LEVEL ${G.level}`, canvas.width / 2, ROWS * CELL * 0.5, '#5aff8a', 24);
  }
  G.chargeProgress += n;
  while (G.chargeProgress >= LINES_PER_CHARGE) {
    G.chargeProgress -= LINES_PER_CHARGE;
    if (G.charges < MAX_CHARGES) {
      G.charges++;
      SFX.charge();
      popup('+1 SHIFT CHARGE', canvas.width / 2, ROWS * CELL * 0.6, '#00e5ff', 18);
    }
  }
  updateHUD();
}
function addFever(n) {
  if (G.fever.active) return;
  G.fever.gauge = Math.min(FEVER_MAX, G.fever.gauge + n);
  if (G.fever.gauge >= FEVER_MAX) {
    G.fever.active = true;
    G.fever.until = performance.now() + FEVER_DURATION;
    el.boardWrap.classList.add('fever');
    SFX.fever();
    popup('★ FEVER TIME ★', canvas.width / 2, ROWS * CELL * 0.45, '#ff9d00', 32);
    G.shake = 10;
  }
  updateHUD();
}
function tickFever(now) {
  if (G.fever.active && now >= G.fever.until) {
    G.fever.active = false;
    G.fever.gauge = 0;
    el.boardWrap.classList.remove('fever');
    updateHUD();
  }
}

/* ── 파티클/팝업 ──────────────────────────────────── */
function spawnClearParticles(rows) {
  for (const y of rows) {
    for (let x = 0; x < COLS; x++) {
      const color = G.grid[y][x] ? G.grid[y][x].c : '#fff';
      for (let i = 0; i < 3; i++) {
        G.particles.push({
          x: (x + 0.5) * CELL, y: (y + 0.5) * CELL,
          vx: (Math.random() - 0.5) * 260,
          vy: (Math.random() - 0.8) * 260,
          life: 1, decay: 1.6 + Math.random(), size: 3 + Math.random() * 4, color,
        });
      }
    }
  }
}
function popup(text, x, y, color, size) {
  G.popups.push({ text, x, y, color, size, life: 1 });
}
function updateEffects(dt) {
  G.shake = Math.max(0, G.shake - dt * 22);
  for (const p of G.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 620 * dt;
    p.life -= p.decay * dt;
  }
  G.particles = G.particles.filter(p => p.life > 0);
  for (const t of G.popups) { t.y -= 34 * dt; t.life -= 0.85 * dt; }
  G.popups = G.popups.filter(t => t.life > 0);
}

/* ── 게임 흐름 ────────────────────────────────────── */
function startGame() {
  G.grid = emptyGrid();
  G.bag = []; G.queue = [];
  G.hold = null; G.holdUsed = false;
  G.score = 0; G.level = 1; G.lines = 0;
  G.combo = -1; G.chain = 0; G.maxChain = 0;
  G.charges = 1; G.chargeProgress = 0; G.pidSeq = 0;
  G.fever = { gauge: 0, active: false, until: 0 };
  G.dropInterval = 800;
  G.particles = []; G.popups = [];
  G.shake = 0; G.anim = null; G.cascadeMode = false;
  el.boardWrap.classList.remove('fever');
  while (G.queue.length < 3) G.queue.push(nextType());
  ensureAudio();
  el.overlay.classList.add('hidden');
  G.phase = 'play';
  spawnPiece();
  updateHUD();
}
function gameOver() {
  G.phase = 'gameover';
  G.piece = null;
  SFX.over();
  if (G.score > G.best) {
    G.best = G.score;
    try { localStorage.setItem('gflux-best', String(G.best)); } catch (e) { /* 프라이빗 모드 */ }
  }
  el.overlayTitle.textContent = 'GAME OVER';
  el.overlayMsg.innerHTML = `SCORE <b>${G.score.toLocaleString()}</b> · MAX CHAIN <b>${G.maxChain}</b><br>중력을 더 과감하게 뒤집어 보세요!`;
  el.startBtn.innerHTML = '다시 시작 <span class="key-hint">Enter</span>';
  el.overlay.classList.remove('hidden');
  updateHUD();
}
function togglePause() {
  if (G.phase === 'play') {
    G.phase = 'paused';
    el.overlayTitle.textContent = 'PAUSED';
    el.overlayMsg.innerHTML = '<b>P</b> 키로 계속하기';
    el.startBtn.innerHTML = '계속하기 <span class="key-hint">P</span>';
    el.overlay.classList.remove('hidden');
  } else if (G.phase === 'paused') {
    G.phase = 'play';
    el.overlay.classList.add('hidden');
    G.lastTime = performance.now();
  }
}

/* ── 메인 루프 ────────────────────────────────────── */
function tick(now) {
  const dt = Math.min((now - G.lastTime) / 1000, 0.05);
  G.lastTime = now;
  update(dt, now);
  render();
}
let lastRafTime = 0;
function loop(now) {
  lastRafTime = now;
  tick(now);
  requestAnimationFrame(loop);
}

function update(dt, now) {
  tickFever(now);
  updateEffects(dt);

  if (G.phase === 'play' && G.piece) {
    G.dropTimer += dt * 1000;
    const interval = keys.down ? Math.min(45, G.dropInterval) : G.dropInterval;
    while (G.dropTimer >= interval) {
      G.dropTimer -= interval;
      if (!collides(G.piece, 0, 1)) {
        G.piece.y++;
        if (keys.down) addScore(1);
        G.grounded = false;
      } else {
        G.grounded = true;
        break;
      }
    }
    if (G.grounded) {
      G.lockTimer += dt * 1000;
      if (collides(G.piece, 0, 1) && G.lockTimer >= G.lockDelay) lockPiece();
      else if (!collides(G.piece, 0, 1)) G.grounded = false;
    }
  } else if (G.anim) {
    G.anim.t += dt * 1000;
    if (G.anim.t >= G.anim.dur) {
      const a = G.anim;
      G.anim = null;
      if (a.kind === 'rotating') finishRotating(a);
      else if (a.kind === 'falling') a.onDone();
      else if (a.kind === 'clearing') finishClearing(a);
    }
  }
}

/* ── 렌더링 ───────────────────────────────────────── */
function drawCell(c, px, py, color, size = CELL, alpha = 1) {
  const pad = size * 0.06;
  const r = size * 0.18;
  c.save();
  c.globalAlpha = alpha;
  c.beginPath();
  c.roundRect(px + pad, py + pad, size - pad * 2, size - pad * 2, r);
  const grad = c.createLinearGradient(px, py, px, py + size);
  grad.addColorStop(0, color);
  grad.addColorStop(1, shade(color, -0.35));
  c.fillStyle = grad;
  c.fill();
  c.beginPath();
  c.roundRect(px + pad + size * 0.1, py + pad + size * 0.08, size * 0.55, size * 0.22, r * 0.6);
  c.fillStyle = 'rgba(255,255,255,0.28)';
  c.fill();
  c.restore();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + Math.round(255 * amt), g = ((n >> 8) & 255) + Math.round(255 * amt), b = (n & 255) + Math.round(255 * amt);
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}
function easeOutBack(t) { const c1 = 1.4; return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
function easeInQuad(t) { return t * t; }

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (G.shake > 0) {
    ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
  }

  // 그리드 라인
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for (let i = 1; i < COLS; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke();
  }
  for (let i = 1; i < ROWS; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke();
  }

  // 위험 경고 (상단 2줄에 블록)
  let danger = false;
  for (let y = 0; y < 2 && !danger; y++) danger = G.grid[y] && G.grid[y].some(c => c);
  if (danger && (G.phase === 'play')) {
    const g = ctx.createLinearGradient(0, 0, 0, CELL * 3);
    g.addColorStop(0, 'rgba(255,46,110,0.22)'); g.addColorStop(1, 'rgba(255,46,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, CELL * 3);
  }

  const a = G.anim;

  if (a && a.kind === 'rotating') {
    // 스택 전체가 보드 중심을 축으로 회전
    const t = Math.min(a.t / a.dur, 1);
    const ang = easeOutBack(t) * (Math.PI / 2) * a.dir;
    const cx = W / 2, cy = H / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.translate(-cx, -cy);
    for (const s of a.snapshot) drawCell(ctx, s.x * CELL, s.y * CELL, s.color);
    ctx.restore();
  } else if (a && a.kind === 'falling') {
    const t = easeInQuad(Math.min(a.t / a.dur, 1));
    const movingTargets = new Set(a.moves.map(m => m.x + ',' + m.toY));
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (G.grid[y][x] && !movingTargets.has(x + ',' + y)) drawCell(ctx, x * CELL, y * CELL, G.grid[y][x].c);
      }
    }
    for (const m of a.moves) {
      const py = (m.fromY + (m.toY - m.fromY) * t) * CELL;
      drawCell(ctx, m.x * CELL, py, m.color);
    }
  } else {
    // 일반 그리드
    const clearingRows = a && a.kind === 'clearing' ? new Set(a.rows) : null;
    const flash = clearingRows ? (Math.floor(a.t / 65) % 2 === 0) : false;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!G.grid[y][x]) continue;
        if (clearingRows && clearingRows.has(y)) {
          drawCell(ctx, x * CELL, y * CELL, flash ? '#ffffff' : G.grid[y][x].c, CELL, flash ? 1 : 0.75);
        } else {
          drawCell(ctx, x * CELL, y * CELL, G.grid[y][x].c);
        }
      }
    }
  }

  // 고스트 + 현재 피스
  if (G.piece && (G.phase === 'play' || G.phase === 'paused')) {
    const gy = ghostY(G.piece);
    for (const [x, y] of pieceCells(G.piece, 0, gy - G.piece.y)) {
      if (y >= 0) {
        ctx.save();
        ctx.strokeStyle = COLORS[G.piece.type];
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2;
        ctx.strokeRect(x * CELL + 4, y * CELL + 4, CELL - 8, CELL - 8);
        ctx.restore();
      }
    }
    for (const [x, y] of pieceCells(G.piece)) {
      if (y >= -1) drawCell(ctx, x * CELL, y * CELL, COLORS[G.piece.type]);
    }
  }

  // 파티클
  for (const p of G.particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
  }

  // 팝업 텍스트
  for (const t of G.popups) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, t.life * 1.4));
    ctx.font = `900 ${t.size}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = t.color;
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 14;
    ctx.fillText(t.text, t.x, t.y);
    ctx.restore();
  }

  ctx.restore();
}

/* ── 사이드 패널 ──────────────────────────────────── */
function drawMini(c, type, cx, cy, cell = 20) {
  const s = SHAPES[type];
  const minX = Math.min(...s.cells.map(p => p[0])), maxX = Math.max(...s.cells.map(p => p[0]));
  const minY = Math.min(...s.cells.map(p => p[1])), maxY = Math.max(...s.cells.map(p => p[1]));
  const w = (maxX - minX + 1) * cell, h = (maxY - minY + 1) * cell;
  for (const [px, py] of s.cells) {
    drawCell(c, cx - w / 2 + (px - minX) * cell, cy - h / 2 + (py - minY) * cell, COLORS[type], cell);
  }
}
function renderSidePanels() {
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  if (G.hold) drawMini(holdCtx, G.hold, holdCanvas.width / 2, holdCanvas.height / 2);
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  G.queue.slice(0, 3).forEach((t, i) => {
    drawMini(nextCtx, t, nextCanvas.width / 2, 40 + i * 75);
  });
}

/* ── HUD ──────────────────────────────────────────── */
function updateHUD() {
  el.score.textContent = G.score.toLocaleString();
  el.best.textContent = Math.max(G.best, G.score).toLocaleString();
  el.level.textContent = G.level;
  el.lines.textContent = G.lines;
  el.maxChain.textContent = G.maxChain;
  el.charges.innerHTML = Array.from({ length: MAX_CHARGES },
    (_, i) => `<div class="charge-orb${i < G.charges ? ' full' : ''}"></div>`).join('');
  if (G.fever.active) {
    const remain = Math.max(0, G.fever.until - performance.now()) / FEVER_DURATION;
    el.feverBar.style.width = (remain * 100) + '%';
  } else {
    el.feverBar.style.width = G.fever.gauge + '%';
  }
}
// 피버 잔여시간 게이지는 매 프레임 갱신 필요
setInterval(() => { if (G.fever.active) updateHUD(); }, 120);

/* ── 입력 ─────────────────────────────────────────── */
const keys = { down: false };
document.addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(e.key)) e.preventDefault();

  if (G.phase === 'menu' || G.phase === 'gameover') {
    if (e.key === 'Enter') startGame();
    return;
  }
  if (e.key === 'p' || e.key === 'P') { togglePause(); return; }
  if (G.phase === 'paused') return;

  switch (e.key) {
    case 'ArrowLeft': tryMove(-1, 0); break;
    case 'ArrowRight': tryMove(1, 0); break;
    case 'ArrowDown': keys.down = true; break;
    case 'ArrowUp': case 'x': case 'X': if (!e.repeat) tryRotate(1); break;
    case 'z': case 'Z': if (!e.repeat) tryRotate(-1); break;
    case ' ': if (!e.repeat) hardDrop(); break;
    case 'c': case 'C': if (!e.repeat) doHold(); break;
    case 'q': case 'Q': if (!e.repeat) gravityShift(-1); break;
    case 'e': case 'E': if (!e.repeat) gravityShift(1); break;
    case 'r': case 'R': if (!e.repeat) startGame(); break;
  }
});
document.addEventListener('keyup', e => {
  if (e.key === 'ArrowDown') keys.down = false;
});

el.startBtn.addEventListener('click', () => {
  if (G.phase === 'paused') togglePause();
  else startGame();
});

/* 터치 컨트롤 */
document.querySelectorAll('.tc-btn').forEach(btn => {
  const act = btn.dataset.act;
  const fire = ev => {
    ev.preventDefault();
    ensureAudio();
    if (G.phase === 'menu' || G.phase === 'gameover') { startGame(); return; }
    switch (act) {
      case 'left': tryMove(-1, 0); break;
      case 'right': tryMove(1, 0); break;
      case 'down': tryMove(0, 1); break;
      case 'drop': hardDrop(); break;
      case 'rotL': tryRotate(-1); break;
      case 'rotR': tryRotate(1); break;
      case 'hold': doHold(); break;
      case 'shiftL': gravityShift(-1); break;
      case 'shiftR': gravityShift(1); break;
    }
  };
  btn.addEventListener('touchstart', fire, { passive: false });
  btn.addEventListener('mousedown', fire);
});

/* 보드 스와이프 제스처 (모바일)
   좌우 드래그: 이동 · 아래 드래그: 소프트 드롭 · 빠른 아래 플릭: 하드 드롭
   탭: 회전 · 위로 스와이프: 홀드 · 두 손가락 좌우: 중력 시프트 */
const swipe = { active: false, x0: 0, y0: 0, t0: 0, lastX: 0, lastY: 0, axis: null, moved: false, twoFinger: false, tfX0: 0 };
const SWIPE_STEP = 26; // 1칸 이동당 드래그 픽셀

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  ensureAudio();
  if (G.phase !== 'play') return;
  if (e.touches.length >= 2) {
    swipe.active = false;
    swipe.twoFinger = true;
    swipe.tfX0 = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    return;
  }
  const t = e.touches[0];
  Object.assign(swipe, {
    active: true, twoFinger: false, axis: null, moved: false,
    x0: t.clientX, y0: t.clientY, lastX: t.clientX, lastY: t.clientY, t0: performance.now(),
  });
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (swipe.twoFinger || !swipe.active) return;
  const t = e.touches[0];
  const dxTotal = t.clientX - swipe.x0, dyTotal = t.clientY - swipe.y0;
  if (!swipe.axis && (Math.abs(dxTotal) > 14 || Math.abs(dyTotal) > 14)) {
    swipe.axis = Math.abs(dxTotal) > Math.abs(dyTotal) ? 'h' : 'v';
  }
  if (swipe.axis === 'h') {
    let dx = t.clientX - swipe.lastX;
    while (dx >= SWIPE_STEP) { tryMove(1, 0); swipe.lastX += SWIPE_STEP; dx -= SWIPE_STEP; swipe.moved = true; }
    while (dx <= -SWIPE_STEP) { tryMove(-1, 0); swipe.lastX -= SWIPE_STEP; dx += SWIPE_STEP; swipe.moved = true; }
  } else if (swipe.axis === 'v') {
    let dy = t.clientY - swipe.lastY;
    while (dy >= SWIPE_STEP) { tryMove(0, 1); swipe.lastY += SWIPE_STEP; dy -= SWIPE_STEP; swipe.moved = true; }
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (swipe.twoFinger) {
    const dx = e.changedTouches[0].clientX - swipe.tfX0;
    if (dx > 40) gravityShift(1);
    else if (dx < -40) gravityShift(-1);
    swipe.twoFinger = false;
    return;
  }
  if (!swipe.active) return;
  swipe.active = false;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x0, dy = t.clientY - swipe.y0;
  const dur = performance.now() - swipe.t0;
  if (Math.hypot(dx, dy) < 12 && dur < 300 && !swipe.moved) { tryRotate(1); return; } // 탭 = 회전
  if (dy > 60 && dy / dur > 0.45 && Math.abs(dy) > Math.abs(dx)) { hardDrop(); return; } // 아래로 플릭 = 하드 드롭
  if (dy < -40 && Math.abs(dy) > Math.abs(dx)) doHold(); // 위로 = 홀드
}, { passive: false });

/* ── 초기화 ───────────────────────────────────────── */
try { G.best = parseInt(localStorage.getItem('gflux-best') || '0', 10) || 0; } catch (e) { G.best = 0; }
updateHUD();
G.lastTime = performance.now();
requestAnimationFrame(loop);

// rAF가 멈추는 환경(백그라운드 탭, 임베디드 웹뷰 등)을 위한 폴백 드라이버.
// rAF가 200ms 이상 발화하지 않으면 setInterval이 게임을 대신 구동한다.
setInterval(() => {
  const now = performance.now();
  if (now - lastRafTime > 200) tick(now);
}, 50);
// 탭이 다시 보일 때 시간 점프로 인한 프레임 폭주 방지
document.addEventListener('visibilitychange', () => { G.lastTime = performance.now(); });

/* 루프 엔지니어링용 디버그 훅 */
window.__game = {
  G, gravityShift, startGame, hardDrop, tryMove, tryRotate,
  setGrid(rows) { G.grid = rows; },
  emptyGrid, fullRows, computeCascade,
  // 회전 없이 캐스케이드→체인 판정만 실행 (테스트용)
  resolve() { startFalling(computeCascade(), () => afterCascadeSettle(0)); },
  // 헤드리스 검증용: rAF가 멈춰 있어도 게임 시간을 강제로 진행
  step(ms = 16) {
    const steps = Math.ceil(ms / 16);
    for (let i = 0; i < steps; i++) update(0.016, performance.now());
    render();
  },
  render,
};
