'use strict';
// ─── Matter.js aliases ───────────────────────────────────────
const { Engine, World, Bodies, Body, Events, Composite } = Matter;

// ─── DRINK DEFINITIONS ───────────────────────────────────────
const DRINKS = [
  { level:1,  emoji:'🥤', name:'Soda Cup',       r:22,  c1:'#ffe8a0', c2:'#d4900a', pts:10    },
  { level:2,  emoji:'🧃', name:'Juice Box',       r:30,  c1:'#ffd090', c2:'#c06a00', pts:20    },
  { level:3,  emoji:'🍋', name:'Lemonade',        r:40,  c1:'#ffe566', c2:'#a88000', pts:40    },
  { level:4,  emoji:'🥛', name:'Milkshake',       r:51,  c1:'#e8e0ff', c2:'#6040d0', pts:80    },
  { level:5,  emoji:'🍵', name:'Green Smoothie',  r:63,  c1:'#a0f0b0', c2:'#006830', pts:160   },
  { level:6,  emoji:'🧋', name:'Bubble Tea',      r:76,  c1:'#90d8ff', c2:'#004cb0', pts:320   },
  { level:7,  emoji:'🍹', name:'Tropical Punch',  r:90,  c1:'#ffb0d0', c2:'#b00050', pts:640   },
  { level:8,  emoji:'🥂', name:'Sparkling Mix',   r:105, c1:'#ffd0b0', c2:'#903000', pts:1280  },
  { level:9,  emoji:'🍸', name:'Cocktail',        r:121, c1:'#d0b0ff', c2:'#500090', pts:2560  },
  { level:10, emoji:'🫗', name:'Premium Blend',   r:138, c1:'#a0f8f0', c2:'#006060', pts:5120  },
  { level:11, emoji:'🏆', name:'Golden Nectar',   r:156, c1:'#fff0a0', c2:'#806000', pts:10240 },
  { level:12, emoji:'👑', name:'Royal Elixir',    r:170, c1:'#ffd700', c2:'#8b0000', pts:20480 },
];
const MAX_LEVEL = DRINKS.length;

// ─── CANVAS & WORLD DIMS ─────────────────────────────────────
let CW = 460, CH = 760;
const WALL = 18;
const CONT = { left: 55, right: 405, top: 155, floor: 720 };
// Shooter line Y
const SHOOT_Y = 125;

// ─── STATE ───────────────────────────────────────────────────
let canvas, ctx, engine, world;
let drinks = [];          // active Matter bodies
let mergeQueue = [];      // pending merges
let particles = [];       // visual sparks
let score = 0, best = 0;
let currentLevel = 1, nextLevel = 1;
let shooterX = CW / 2;
let canShoot = true, cooldown = 0;
let gameOver = false;
let aimLine = [];         // dashed aim preview dots
let scale = 1;            // canvas CSS scale

// Pre-rendered drink image cache
const drinkCache = {};

// ─── INIT ────────────────────────────────────────────────────
function init(restart) {
  // reset state
  score = 0;
  gameOver = false;
  canShoot = true;
  cooldown = 0;
  particles = [];
  mergeQueue = [];
  drinks = [];
  if (restart) {
    best = parseInt(localStorage.getItem('dm_best') || '0');
    document.getElementById('overlay-gameover').classList.add('hidden');
    document.getElementById('overlay-win').classList.add('hidden');
  }

  // Engine
  if (engine) World.clear(world); // clear old world
  engine = Engine.create({ gravity: { x: 0, y: 2.2 } });
  world = engine.world;
  buildWalls();

  currentLevel = randLevel();
  nextLevel    = randLevel();
  updateNextUI();
  updateHUD();
  Events.on(engine, 'collisionStart', onCollision);
}

function buildWalls() {
  const cx = (CONT.left + CONT.right) / 2;
  const ht = CONT.floor - CONT.top;
  const opts = { isStatic:true, label:'wall', friction:0.4, restitution:0.25, frictionAir:0 };
  World.add(world, [
    Bodies.rectangle(cx, CONT.floor + WALL/2, (CONT.right-CONT.left)+WALL*2, WALL, opts), // floor
    Bodies.rectangle(CONT.left  - WALL/2, CONT.top + ht/2, WALL, ht, opts),                // left
    Bodies.rectangle(CONT.right + WALL/2, CONT.top + ht/2, WALL, ht, opts),                // right
  ]);
}

function randLevel() {
  const r = Math.random();
  if (r < 0.55) return 1;
  if (r < 0.82) return 2;
  if (r < 0.94) return 3;
  return 4;
}

// ─── CANVAS SETUP ────────────────────────────────────────────
function setupCanvas() {
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  canvas.width  = CW;
  canvas.height = CH;
  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);
}

function sizeCanvas() {
  const sx = window.innerWidth / CW;
  const sy = window.innerHeight / CH;
  scale = Math.min(sx, sy, 1.4);
  canvas.style.width  = CW * scale + 'px';
  canvas.style.height = CH * scale + 'px';
}

// ─── DRINK BODY ───────────────────────────────────────────────
function makeDrink(x, y, level) {
  const d = DRINKS[level-1];
  const b = Bodies.circle(x, y, d.r, {
    restitution: 0.35, friction: 0.45,
    frictionAir: 0.007, density: 0.003,
    label: 'drink',
  });
  b.drinkLevel = level;
  b.radius = d.r;
  b.merging = false;
  b.born = Date.now();
  return b;
}

// ─── SHOOT ───────────────────────────────────────────────────
function shoot(x) {
  if (!canShoot || gameOver) return;
  const d = DRINKS[currentLevel-1];
  const cx = Math.max(CONT.left + d.r + 2, Math.min(CONT.right - d.r - 2, x));
  const b  = makeDrink(cx, SHOOT_Y, currentLevel);
  World.add(world, b);
  drinks.push(b);
  playShoot();
  canShoot = false;
  cooldown = 1100;
  currentLevel = nextLevel;
  nextLevel = randLevel();
  updateNextUI();
}

// ─── COLLISION / MERGE ────────────────────────────────────────
function onCollision(ev) {
  ev.pairs.forEach(({ bodyA, bodyB }) => {
    if (bodyA.label !== 'drink' || bodyB.label !== 'drink') return;
    if (bodyA.merging || bodyB.merging) return;
    if (bodyA.drinkLevel !== bodyB.drinkLevel) return;
    if (bodyA.drinkLevel >= MAX_LEVEL) return;
    const now = Date.now();
    if (now - bodyA.born < 250 || now - bodyB.born < 250) return;
    bodyA.merging = bodyB.merging = true;
    mergeQueue.push({ a: bodyA, b: bodyB });
  });
}

function processMerges() {
  mergeQueue.forEach(({ a, b }) => {
    const mx = (a.position.x + b.position.x) / 2;
    const my = (a.position.y + b.position.y) / 2;
    const nL = a.drinkLevel + 1;
    World.remove(world, a);
    World.remove(world, b);
    drinks = drinks.filter(d => d !== a && d !== b);
    if (nL <= MAX_LEVEL) {
      const nb = makeDrink(mx, my, nL);
      nb.born = 0; // allow immediate merges on cascade
      World.add(world, nb);
      drinks.push(nb);
      // explosion push
      const force = 0.012 * nL;
      drinks.forEach(d => {
        if (d === nb) return;
        const dx = d.position.x - mx, dy = d.position.y - my;
        const dist = Math.hypot(dx, dy) + 1;
        if (dist < 220) {
          const f = force / dist;
          Body.applyForce(d, d.position, { x: dx*f, y: dy*f });
        }
      });
      const pts = DRINKS[nL-1].pts;
      score += pts;
      if (score > best) { best = score; localStorage.setItem('dm_best', best); }
      updateHUD();
      spawnPopup(mx * scale + (window.innerWidth - CW*scale)/2, my * scale, '+'+fmtN(pts));
      spawnParticles(mx, my, DRINKS[nL-1].c1, 14);
      playMerge(nL);
      if (nL === MAX_LEVEL) setTimeout(showWin, 800);
    }
  });
  mergeQueue = [];
}

// ─── PARTICLES ───────────────────────────────────────────────
function spawnParticles(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.PI*2*i/n + Math.random()*0.5;
    const s = 2.5 + Math.random()*4;
    particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s,
      col, size: 5+Math.random()*5, life: 1, decay: 0.022+Math.random()*0.018 });
  }
}
function tickParticles() {
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => { p.x+=p.vx; p.y+=p.vy; p.vy+=0.18; p.vx*=0.95; p.life-=p.decay; p.size*=0.96; });
}

// ─── DRAW BACKGROUND ─────────────────────────────────────────
function drawBG() {
  const sk = ctx.createLinearGradient(0,0,0,CH*0.62);
  sk.addColorStop(0,'#1e9fd4'); sk.addColorStop(1,'#f9db6a');
  ctx.fillStyle = sk; ctx.fillRect(0,0,CW,CH);

  const oc = ctx.createLinearGradient(0,CH*0.62,0,CH);
  oc.addColorStop(0,'#0096c7'); oc.addColorStop(1,'#023e8a');
  ctx.fillStyle = oc; ctx.fillRect(0,CH*0.62,CW,CH*0.38);

  // sun
  const sg = ctx.createRadialGradient(390,50,4,390,50,36);
  sg.addColorStop(0,'#fff9c4'); sg.addColorStop(1,'#ffa000');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(390,50,36,0,Math.PI*2); ctx.fill();

  drawPalm(8,   CH*0.68, 1);
  drawPalm(CW-8,CH*0.68,-1);
}

function drawPalm(x, y, dir) {
  ctx.save();
  ctx.strokeStyle='#7c5c3a'; ctx.lineWidth=9; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(x,y);
  ctx.quadraticCurveTo(x+dir*22,y-80,x+dir*38,y-145); ctx.stroke();
  const tx=x+dir*38, ty=y-145;
  [['#27a44e',0,-32],[' #38b261',dir*42,-18],['#4cc070',dir*44,12],['#2d9e4f',-dir*32,-12]].forEach(([c,lx,ly])=>{
    ctx.strokeStyle=c; ctx.lineWidth=6;
    ctx.beginPath(); ctx.moveTo(tx,ty);
    ctx.quadraticCurveTo(tx+lx*.5,ty+ly*.5-10,tx+lx,ty+ly); ctx.stroke();
  });
  ctx.restore();
}

// ─── DRAW CONTAINER ──────────────────────────────────────────
function drawContainer() {
  const { left, right, top, floor } = CONT;
  const w = right - left;

  // Wood table surface
  const wood = ctx.createLinearGradient(left, floor-8, left, floor+WALL+6);
  wood.addColorStop(0,'#c8813a'); wood.addColorStop(0.4,'#a0622a'); wood.addColorStop(1,'#7a4a1e');
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.roundRect(left - WALL, floor - 6, w + WALL*2, WALL + 12, [0,0,8,8]);
  ctx.fill();

  // Left wall
  const lw = ctx.createLinearGradient(left-WALL,0,left,0);
  lw.addColorStop(0,'rgba(180,120,60,0.8)'); lw.addColorStop(1,'rgba(200,140,80,0.4)');
  ctx.fillStyle = lw;
  ctx.fillRect(left-WALL, top, WALL, floor-top);

  // Right wall
  const rw = ctx.createLinearGradient(right,0,right+WALL,0);
  rw.addColorStop(0,'rgba(200,140,80,0.4)'); rw.addColorStop(1,'rgba(180,120,60,0.8)');
  ctx.fillStyle = rw;
  ctx.fillRect(right, top, WALL, floor-top);

  // Danger line (top of container)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,80,80,0.5)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8,6]);
  ctx.beginPath(); ctx.moveTo(left, top+2); ctx.lineTo(right, top+2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ─── DRAW DRINKS ─────────────────────────────────────────────
function drawDrink(body) {
  const { x, y } = body.position;
  const lv = body.drinkLevel;
  const r  = body.radius;
  const d  = DRINKS[lv-1];

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(body.angle);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(0, r*0.85, r*0.75, r*0.22, 0, 0, Math.PI*2); ctx.fill();

  // Body gradient
  const g = ctx.createRadialGradient(-r*.3,-r*.3,r*.08, 0,0,r);
  g.addColorStop(0, d.c1); g.addColorStop(1, d.c2);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();

  // Shine
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath(); ctx.ellipse(-r*.28,-r*.3, r*.32, r*.2, -0.5, 0, Math.PI*2); ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();

  // Emoji
  ctx.font = `${Math.round(r * 1.15)}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(d.emoji, 0, 2);

  ctx.restore();
}

function drawAllDrinks() {
  drinks.forEach(drawDrink);
}

function drawParticles() {
  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

// ─── SHOOTER UI ──────────────────────────────────────────────
function drawShooter() {
  const d = DRINKS[currentLevel-1];
  const sx = Math.max(CONT.left + d.r + 2, Math.min(CONT.right - d.r - 2, shooterX));

  // Aim dashes down to container
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 10]);
  ctx.beginPath(); ctx.moveTo(sx, SHOOT_Y + d.r + 4); ctx.lineTo(sx, CONT.floor - 4);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();

  // Arrow indicator
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(sx, SHOOT_Y + d.r + 14);
  ctx.lineTo(sx - 7, SHOOT_Y + d.r + 2);
  ctx.lineTo(sx + 7, SHOOT_Y + d.r + 2);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // Current drink preview
  drawDrink({
    position: { x: sx, y: SHOOT_Y },
    angle: 0,
    drinkLevel: currentLevel,
    radius: d.r,
  });

  // Cooldown arc
  if (!canShoot) {
    const prog = 1 - cooldown / 1100;
    ctx.save();
    ctx.strokeStyle = '#ffe566';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(sx, SHOOT_Y, d.r + 6, -Math.PI/2, -Math.PI/2 + prog * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ─── HUD ─────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('score-val').textContent = fmtN(score);
  document.getElementById('best-val').textContent  = fmtN(best);
}
function updateNextUI() {
  document.getElementById('next-drink').textContent = DRINKS[nextLevel-1].emoji;
}
function fmtN(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n+'';
}

// ─── POPUP ───────────────────────────────────────────────────
function spawnPopup(screenX, screenY, text) {
  const el = document.createElement('div');
  el.className = 'popup';
  el.textContent = text;
  el.style.left = screenX + 'px';
  el.style.top  = screenY + 'px';
  document.getElementById('popups').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// ─── AUDIO (Web Audio API) ────────────────────────────────────
let actx;
function getACtx() { return actx || (actx = new (window.AudioContext||window.webkitAudioContext)()); }
function tone(freq, type, dur, vol=0.25) {
  try {
    const c=getACtx(), o=c.createOscillator(), g=c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(vol,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+dur);
    o.start(); o.stop(c.currentTime+dur);
  } catch(e){}
}
function playShoot() { tone(480,'triangle',0.1,0.2); }
function playMerge(lv) {
  const f=280+lv*70;
  tone(f,'sine',0.25,0.3);
  setTimeout(()=>tone(f*1.5,'sine',0.18,0.22),110);
}

// ─── GAME OVER / WIN ─────────────────────────────────────────
function checkGameOver() {
  for (const b of drinks) {
    if (!b.merging && b.position.y - b.radius < CONT.top + 10 && Date.now() - b.born > 2200) {
      endGame(); return;
    }
  }
}
function endGame() {
  gameOver = true;
  document.getElementById('final-score').textContent = fmtN(score);
  document.getElementById('final-best').textContent  = fmtN(best);
  setTimeout(()=>document.getElementById('overlay-gameover').classList.remove('hidden'), 800);
}
function showWin() {
  gameOver = true;
  document.getElementById('overlay-win').classList.remove('hidden');
}

// ─── INPUT ───────────────────────────────────────────────────
function setupInput() {
  function toCanvasX(cx) {
    const r = canvas.getBoundingClientRect();
    return (cx - r.left) / scale;
  }
  canvas.addEventListener('mousemove', e => { shooterX = toCanvasX(e.clientX); });
  canvas.addEventListener('click',     e => { if(!gameOver) shoot(toCanvasX(e.clientX)); });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); shooterX = toCanvasX(e.touches[0].clientX); }, {passive:false});
  canvas.addEventListener('touchend',  e => { e.preventDefault(); if(!gameOver) shoot(toCanvasX(e.changedTouches[0].clientX)); }, {passive:false});

  document.getElementById('btn-restart').addEventListener('click', () => { init(true); });
  document.getElementById('btn-win-restart').addEventListener('click', () => { init(true); });
}

// ─── MAIN LOOP ────────────────────────────────────────────────
let last = 0;
function loop(ts) {
  const dt = Math.min(ts - last, 48);
  last = ts;

  Engine.update(engine, dt || 16.67);

  if (!canShoot) { cooldown -= dt; if (cooldown <= 0) canShoot = true; }

  processMerges();
  tickParticles();
  if (!gameOver) checkGameOver();

  // Draw
  ctx.clearRect(0, 0, CW, CH);
  drawBG();
  drawContainer();
  drawAllDrinks();
  drawParticles();
  drawShooter();

  requestAnimationFrame(loop);
}

// ─── BOOT ────────────────────────────────────────────────────
window.addEventListener('load', () => {
  setupCanvas();
  best = parseInt(localStorage.getItem('dm_best') || '0');
  init(false);
  setupInput();
  requestAnimationFrame(loop);
});
