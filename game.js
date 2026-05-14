'use strict';
// ─── Matter.js aliases ───────────────────────────────────────
const { Engine, World, Bodies, Body, Events, Composite } = Matter;

// ─── DRINK DEFINITIONS ───────────────────────────────────────
const DRINKS = [
  { level:1,  emoji:'🧃', name:'Juice Box',       r:22,  c1:'#a0f0b0', c2:'#006830', pts:10    },
  { level:2,  emoji:'🥥', name:'Coconut',         r:30,  c1:'#d2b48c', c2:'#8b4513', pts:20    },
  { level:3,  emoji:'🥤', name:'Soda Cup',        r:40,  c1:'#ffe8a0', c2:'#d4900a', pts:40    },
  { level:4,  emoji:'🥛', name:'Milkshake',       r:51,  c1:'#e8e0ff', c2:'#6040d0', pts:80    },
  { level:5,  emoji:'🍵', name:'Green Tea',       r:63,  c1:'#d0f0d0', c2:'#2ecc71', pts:160   },
  { level:6,  emoji:'🧋', name:'Bubble Tea',      r:76,  c1:'#90d8ff', c2:'#004cb0', pts:320   },
  { level:7,  emoji:'🍹', name:'Tropical Punch',  r:90,  c1:'#ffb0d0', c2:'#b00050', pts:640   },
  { level:8,  emoji:'🥂', name:'Sparkling Mix',   r:105, c1:'#ffd0b0', c2:'#903000', pts:1280  },
  { level:9,  emoji:'🍸', name:'Cocktail',        r:121, c1:'#d0b0ff', c2:'#500090', pts:2560  },
  { level:10, emoji:'🍷', name:'Fine Wine',       r:138, c1:'#ffcccc', c2:'#c0392b', pts:5120  },
  { level:11, emoji:'🏆', name:'Golden Nectar',   r:156, c1:'#fff0a0', c2:'#806000', pts:10240 },
  { level:12, emoji:'👑', name:'Royal Elixir',    r:170, c1:'#ffd700', c2:'#8b0000', pts:20480 },
];
const MAX_LEVEL = DRINKS.length;

// ─── CANVAS & WORLD DIMS ─────────────────────────────────────
let CW = 460, CH = 760;
const WALL = 50;   // thick enough to prevent tunneling by smallest drink (r=22)
const CONT = { left: 60, right: 400, top: 155, floor: 715 };
const SHOOT_Y = 118;

// ─── STATE ───────────────────────────────────────────────────
let canvas, ctx, engine, world;
let drinks = [];          // active Matter bodies
let mergeQueue = [];      // pending merges
let particles = [];       // visual sparks
let soldOutLabels = [];   // {x,y,life,scale} for SOLD OUT! overlays
let score = 0, best = 0;
let currentLevel = 1, nextLevel = 1;
let shooterX = CW / 2;
let canShoot = true, cooldown = 0;
let gameOver = false;
let scale = 1;            // canvas CSS scale
let collected = 0;        // how many royal elixirs collected
let isMuted = false;
let musicStarted = false;

// ─── INIT ────────────────────────────────────────────────────
function init(restart) {
  // reset state
  score = 0;
  collected = 0;
  gameOver = false;
  canShoot = true;
  cooldown = 0;
  particles = [];
  soldOutLabels = [];
  mergeQueue = [];
  drinks = [];
  document.getElementById('collected-val').textContent = '0';
  if (restart) {
    best = parseInt(localStorage.getItem('dm_best') || '0');
    document.getElementById('overlay-gameover').classList.add('hidden');
  }

  // Engine — higher iterations prevent tunneling of fast small bodies
  if (engine) { Events.off(engine); World.clear(world); }
  engine = Engine.create({
    gravity: { x: 0, y: 1.25 },
    positionIterations: 12,
    velocityIterations: 12,
    constraintIterations: 4,
  });
  world = engine.world;
  buildWalls();

  currentLevel = randLevel();
  nextLevel    = randLevel();
  updateNextUI();
  updateHUD();
  Events.on(engine, 'collisionStart', onCollision);
}

function buildWalls() {
  const { left, right, top, floor } = CONT;
  const cx  = (left + right) / 2;
  const innerW = right - left;
  const ht  = floor - top + WALL;

  // Default collision filter: collides with everything
  const opts = {
    isStatic: true, label: 'wall',
    friction: 0.5, restitution: 0.2,
    frictionAir: 0,
  };

  World.add(world, [
    // Floor — very thick so small fast drinks can't tunnel through
    Bodies.rectangle(cx, floor + WALL / 2, innerW + WALL * 4, WALL, opts),
    // Left wall — inner face aligns exactly with CONT.left
    Bodies.rectangle(left - WALL / 2, top + ht / 2, WALL, ht + WALL * 2, opts),
    // Right wall
    Bodies.rectangle(right + WALL / 2, top + ht / 2, WALL, ht + WALL * 2, opts),
    // Safety catch-net far below canvas — teleports any tunnellers back up
    Bodies.rectangle(cx, CH + 200, CW * 6, 80, { ...opts, label: 'catchnet' }),
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
  b.renderScale = 1.0;
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
      nb.born = 0;
      nb.renderScale = 0.3;
      World.add(world, nb);
      drinks.push(nb);
      // explosion push - slightly reduced for 'slower' feel
      const force = 0.011 * nL;
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
      spawnParticles(mx, my, DRINKS[nL-1].c1, 18);
      playMerge(nL);
      // Auto-collect max level drink after short settle delay
      if (nL === MAX_LEVEL) {
        nb.pendingCollect = true;
        setTimeout(() => collectMaxDrink(nb), 1200);
      }
    }
  });
  mergeQueue = [];
}

// ─── MAX LEVEL AUTO COLLECT ──────────────────────────────────
function collectMaxDrink(body) {
  if (!drinks.includes(body)) return;
  const x = body.position.x, y = body.position.y;
  World.remove(world, body);
  drinks = drinks.filter(d => d !== body);
  collected++;
  // Big bonus
  const bonus = DRINKS[MAX_LEVEL-1].pts * 2;
  score += bonus;
  if (score > best) { best = score; localStorage.setItem('dm_best', best); }
  updateHUD();
  document.getElementById('collected-val').textContent = collected;
  // Massive particles
  spawnParticles(x, y, '#ffd700', 30);
  spawnParticles(x, y, '#fff', 20);
  // SOLD OUT label
  soldOutLabels.push({ x, y, life: 1.0, sc: 0 });
  spawnPopup(
    x * scale + (window.innerWidth - CW*scale)/2,
    y * scale,
    '🎉 +'+fmtN(bonus)
  );
  playCollect();
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
const NOW = () => Date.now();
let _t = 0; // time for animations

function drawDrink(body) {
  const { x, y } = body.position;
  const lv = body.drinkLevel;
  const r  = body.radius * (body.renderScale || 1.0);
  const d  = DRINKS[lv-1];
  const isMax = lv === MAX_LEVEL;
  const isHigh = lv >= 8;

  ctx.save();
  ctx.translate(x, y);

  // Outer glow for high-level drinks
  if (lv >= 5) {
    const glowR = r + 6 + lv * 1.5;
    const glow = ctx.createRadialGradient(0, 0, r*0.8, 0, 0, glowR);
    glow.addColorStop(0, d.c1 + 'aa');
    glow.addColorStop(1, d.c1 + '00');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, glowR, 0, Math.PI*2); ctx.fill();
  }

  // Pulsing ring for max level
  if (isMax) {
    const pulse = 0.5 + 0.5 * Math.sin(_t * 0.006);
    ctx.strokeStyle = `rgba(255,215,0,${0.5 + pulse * 0.5})`;
    ctx.lineWidth = 4 + pulse * 4;
    ctx.beginPath(); ctx.arc(0, 0, r + 8 + pulse * 6, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + pulse * 0.3})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r + 16 + pulse * 4, 0, Math.PI*2); ctx.stroke();
  }

  ctx.rotate(body.angle);

  // Drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = r * 0.5;
  ctx.shadowOffsetY = r * 0.25;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // Main body - 3-stop radial gradient for depth
  const g = ctx.createRadialGradient(-r*.35, -r*.35, r*0.05, 0, 0, r);
  g.addColorStop(0,   lighten(d.c1, 40));
  g.addColorStop(0.5, d.c1);
  g.addColorStop(1,   d.c2);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();

  // Inner ring detail
  ctx.strokeStyle = d.c1 + '88';
  ctx.lineWidth = Math.max(1.5, r * 0.06);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, Math.PI*2); ctx.stroke();

  // Glossy top shine (teardrop)
  const sg = ctx.createRadialGradient(-r*.25, -r*.32, 0, -r*.1, -r*.2, r*.55);
  sg.addColorStop(0, 'rgba(255,255,255,0.72)');
  sg.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();

  // Bottom reflection
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath(); ctx.ellipse(0, r*.6, r*.4, r*.12, 0, 0, Math.PI*2); ctx.fill();

  // Border
  ctx.strokeStyle = isMax ? 'rgba(255,215,0,0.9)' : 'rgba(255,255,255,0.6)';
  ctx.lineWidth = isMax ? 3 : 2;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();

  // Emoji — slightly above center
  const emojiSize = Math.round(r * (lv <= 2 ? 1.05 : 1.1));
  ctx.font = `${emojiSize}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(d.emoji, 0, r * 0.05);

  // Level badge (small circle bottom-right)
  const bx = r * 0.62, by = r * 0.62, br = r * 0.26;
  ctx.fillStyle = isMax ? '#ffd700' : '#222';
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(br * 1.35)}px Nunito, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(lv, bx, by + 1);

  // Sparkle stars for high-level drinks
  if (isHigh) {
    drawSparkles(r, lv, _t);
  }

  ctx.restore();
}

function lighten(hex, amt) {
  // Parse hex and lighten each channel
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + amt);
  const g = Math.min(255, ((n >> 8) & 0xff) + amt);
  const b = Math.min(255, (n & 0xff) + amt);
  return `rgb(${r},${g},${b})`;
}

function drawSparkles(r, lv, t) {
  const count = Math.min(lv - 6, 6);
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI*2 / count) * i + t * 0.0025 * (i % 2 ? 1 : -1);
    const dist  = r * 1.1 + Math.sin(t * 0.005 + i) * r * 0.12;
    const sx = Math.cos(angle) * dist;
    const sy = Math.sin(angle) * dist;
    const ss = 2 + Math.abs(Math.sin(t * 0.007 + i * 1.3)) * 3;
    ctx.fillStyle = '#fff';
    // 4-pointed star
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(t * 0.004 + i);
    ctx.beginPath();
    for (let p = 0; p < 4; p++) {
      const a = (Math.PI/2) * p;
      ctx.lineTo(Math.cos(a)*ss, Math.sin(a)*ss);
      ctx.lineTo(Math.cos(a+Math.PI/4)*ss*0.35, Math.sin(a+Math.PI/4)*ss*0.35);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.restore();
  }
}

function drawAllDrinks() {
  drinks.forEach(drawDrink);
}

function drawParticles() {
  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    // Star-shaped particles for better look
    ctx.fillStyle = p.col;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.life * 3);
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, Math.PI*2);
    ctx.fill();
    // inner lighter circle
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = Math.max(0, p.life * 0.4);
    ctx.beginPath(); ctx.arc(0, 0, p.size * 0.4, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  });
}

// ─── SOLD OUT LABELS ─────────────────────────────────────────
function tickSoldOut() {
  soldOutLabels = soldOutLabels.filter(s => s.life > 0);
  soldOutLabels.forEach(s => { s.life -= 0.012; s.sc = Math.min(1, s.sc + 0.06); s.y -= 0.8; });
}

function drawSoldOutLabels() {
  soldOutLabels.forEach(s => {
    ctx.save();
    ctx.globalAlpha = s.life;
    ctx.translate(s.x, s.y);
    ctx.scale(s.sc, s.sc);
    // Badge background
    ctx.fillStyle = '#ff2255';
    const tw = 130, th = 44;
    ctx.beginPath();
    ctx.roundRect(-tw/2, -th/2, tw, th, 10);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px Fredoka One, cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎉 SOLD OUT!', 0, 1);
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
let actx, musicNode;

function getACtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(freq, type, dur, vol = 0.25) {
  if (isMuted) return;
  try {
    const c = getACtx(), o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.start(); o.stop(c.currentTime + dur);
  } catch (e) {}
}

// Simple tropical background loop
function startMusic() {
  if (musicStarted) return;
  musicStarted = true;
  const c = getACtx();
  const tempo = 120;
  const step = 60 / tempo / 2; // 8th notes

  function playBeat(t) {
    if (isMuted) return;
    // Bass note
    const b = c.createOscillator(), bg = c.createGain();
    b.type = 'sine'; b.frequency.value = 82.41; // E2
    b.connect(bg); bg.connect(c.destination);
    bg.gain.setValueAtTime(0.1, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    b.start(t); b.stop(t + 0.4);

    // Percussive click
    const p = c.createOscillator(), pg = c.createGain();
    p.type = 'square'; p.frequency.value = 1200;
    p.connect(pg); pg.connect(c.destination);
    pg.gain.setValueAtTime(0.02, t + step);
    pg.gain.exponentialRampToValueAtTime(0.001, t + step + 0.05);
    p.start(t + step); p.stop(t + step + 0.05);
  }

  let nextBeat = c.currentTime;
  setInterval(() => {
    while (nextBeat < c.currentTime + 0.1) {
      playBeat(nextBeat);
      nextBeat += step * 4; // every quarter note
    }
  }, 50);
}

function playShoot() { tone(480, 'triangle', 0.1, 0.15); }
function playMerge(lv) {
  const f = 280 + lv * 70;
  tone(f, 'sine', 0.25, 0.2);
  setTimeout(() => tone(f * 1.5, 'sine', 0.18, 0.15), 110);
}
function playCollect() {
  // Victory jingle
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 'sine', 0.3, 0.25), i * 100));
}

// ─── GAME OVER ───────────────────────────────────────────────
function checkGameOver() {
  for (const b of drinks) {
    if (!b.merging && !b.pendingCollect &&
        b.position.y - b.radius < CONT.top + 10 &&
        Date.now() - b.born > 2200) {
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

// ─── INPUT ───────────────────────────────────────────────────
function setupInput() {
  function toCanvasX(cx) {
    const r = canvas.getBoundingClientRect();
    return (cx - r.left) / scale;
  }
  canvas.addEventListener('mousemove', e => { shooterX = toCanvasX(e.clientX); });
  canvas.addEventListener('click',     e => { 
    startMusic();
    if(!gameOver) shoot(toCanvasX(e.clientX)); 
  });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); shooterX = toCanvasX(e.touches[0].clientX); }, {passive:false});
  canvas.addEventListener('touchend',  e => { 
    e.preventDefault(); 
    startMusic();
    if(!gameOver) shoot(toCanvasX(e.changedTouches[0].clientX)); 
  }, {passive:false});

  document.getElementById('btn-mute').addEventListener('click', () => {
    isMuted = !isMuted;
    document.getElementById('btn-mute').classList.toggle('muted', isMuted);
    getACtx(); // resume if needed
    if (!isMuted) startMusic();
  });

  document.getElementById('btn-restart').addEventListener('click', () => { init(true); });
}

// ─── MAIN LOOP ────────────────────────────────────────────────
let last = 0;

// Safety: teleport any drink that escaped the container back inside
function reclaimEscaped() {
  drinks.forEach(b => {
    if (b.merging || b.pendingCollect) return;
    const { x, y } = b.position;
    const r = b.radius;
    let nx = x, ny = y, moved = false;

    // Fell below floor
    if (y - r > CONT.floor + 5) {
      ny = CONT.floor - r - 2;
      moved = true;
    }
    // Escaped left
    if (x - r < CONT.left - 5) {
      nx = CONT.left + r + 2;
      moved = true;
    }
    // Escaped right
    if (x + r > CONT.right + 5) {
      nx = CONT.right - r - 2;
      moved = true;
    }
    if (moved) {
      Body.setPosition(b, { x: nx, y: ny });
      Body.setVelocity(b, { x: 0, y: -1 }); // small upward nudge
    }
  });
}

function loop(ts) {
  const dt = Math.min(ts - last, 48);
  last = ts;
  _t = ts; // global time for animations

  // Sub-step physics for better small-body collision accuracy
  const steps = 3;
  Engine.update(engine, (dt || 16.67) / steps);
  Engine.update(engine, (dt || 16.67) / steps);
  Engine.update(engine, (dt || 16.67) / steps);

  if (!canShoot) { cooldown -= dt; if (cooldown <= 0) canShoot = true; }

  // Update visual scale for growth animation
  drinks.forEach(b => {
    if (b.renderScale < 1.0) {
      b.renderScale += 0.04;
      if (b.renderScale > 1.0) b.renderScale = 1.0;
    }
  });

  reclaimEscaped();
  processMerges();
  tickParticles();
  tickSoldOut();
  if (!gameOver) checkGameOver();

  // Draw
  ctx.clearRect(0, 0, CW, CH);
  drawBG();
  drawContainer();
  drawAllDrinks();
  drawParticles();
  drawSoldOutLabels();
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
