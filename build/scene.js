/* Bonsai — a voxel tree that grows while you're away. three.js r147.
   Voxel size VS = 0.5 world units (same as the Floating Pagoda base).
   The sim itself lives in logic.js (window.BonsaiSim); this file renders it. */
(function () {
'use strict';

/* ---------------- utils (static-decor rng, separate from the sim) ---------------- */
let _s = 20261017;
function rnd() {
  _s |= 0; _s = _s + 0x6D2B79F5 | 0;
  let t = Math.imul(_s ^ _s >>> 15, 1 | _s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function pick(a) { return a[(rnd() * a.length) | 0]; }
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/* ---------------- renderer / scene ---------------- */
const VS = 0.5;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xdd8f66, 90, 380);
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1500);

/* ---------------- sky: same golden-hour gradient as the pagoda base ---------------- */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  vertexShader: 'varying vec3 vP; void main(){ vP = position; ' +
    'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: [
    'varying vec3 vP;',
    'void main(){',
    '  float h = normalize(vP).y;',
    '  vec3 zen = vec3(0.42, 0.17, 0.31);',
    '  vec3 mid = vec3(0.87, 0.44, 0.36);',
    '  vec3 hor = vec3(0.97, 0.66, 0.44);',
    '  vec3 bel = vec3(0.23, 0.13, 0.25);',
    '  vec3 c = h > 0.12 ? mix(mid, zen, smoothstep(0.12, 0.75, h))',
    '    : (h > -0.08 ? mix(hor, mid, smoothstep(-0.08, 0.12, h))',
    '    : mix(bel, hor, smoothstep(-0.6, -0.08, h)));',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n')
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), skyMat));

const sunDir = new THREE.Vector3(0.62, 0.15, 0.38).normalize();
const sun = new THREE.Mesh(new THREE.CircleGeometry(30, 32),
  new THREE.MeshBasicMaterial({ color: 0xffeec8, fog: false, transparent: true, opacity: 0.95 }));
sun.position.copy(sunDir).multiplyScalar(520);
sun.lookAt(0, 0, 0);
scene.add(sun);
const halo = new THREE.Mesh(new THREE.CircleGeometry(72, 32),
  new THREE.MeshBasicMaterial({ color: 0xffd09a, fog: false, transparent: true, opacity: 0.28 }));
halo.position.copy(sunDir).multiplyScalar(518);
halo.lookAt(0, 0, 0);
scene.add(halo);

/* ---------------- lights ---------------- */
scene.add(new THREE.HemisphereLight(0xd99a70, 0x3d2c44, 0.3));
const dl = new THREE.DirectionalLight(0xffb268, 1.45);
dl.position.copy(sunDir).multiplyScalar(90);
dl.castShadow = true;
dl.shadow.mapSize.set(4096, 4096);
dl.shadow.camera.left = -42; dl.shadow.camera.right = 42;
dl.shadow.camera.top = 55; dl.shadow.camera.bottom = -30;
dl.shadow.camera.near = 20; dl.shadow.camera.far = 280;
dl.shadow.bias = -0.0004;
dl.shadow.normalBias = 0.4;
scene.add(dl); scene.add(dl.target);
const fill = new THREE.DirectionalLight(0x6a5bb8, 0.1);
fill.position.set(-45, 30, -30);
scene.add(fill);

/* ---------------- static voxel helpers ---------------- */
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function VoxSet() { this.items = []; this.seen = {}; this.pos = {}; }
VoxSet.prototype.V = function (x, y, z, c, sx, sy, sz) {
  sx = sx || 1; sy = sy || 1; sz = sz || 1;
  const pk = x + '|' + y + '|' + z;
  if (this.pos[pk]) return;
  this.pos[pk] = 1;
  const k = pk + '|' + c + '|' + sx + '|' + sy + '|' + sz;
  if (this.seen[k]) return;
  this.seen[k] = 1;
  this.items.push({ x: x, y: y, z: z, c: c, sx: sx, sy: sy, sz: sz });
};
const dummy = new THREE.Object3D();
function buildSet(set, group) {
  const byColor = {};
  for (const v of set.items) (byColor[v.c] = byColor[v.c] || []).push(v);
  for (const c in byColor) {
    const arr = byColor[c];
    const mat = new THREE.MeshLambertMaterial({ color: +c });
    const m = new THREE.InstancedMesh(boxGeo, mat, arr.length);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      dummy.position.set(v.x * VS, v.y * VS, v.z * VS);
      dummy.scale.set(v.sx * VS, v.sy * VS, v.sz * VS);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
}

/* ---------------- the island: ground only ---------------- */
const grassC = [0x4a8039, 0x528a40, 0x407433, 0x599145];
const dirtC = [0x5c422c, 0x533826];
const stoneC = [0x5f5f66, 0x585862, 0x66666e];
(function island() {
  const vox = new VoxSet();
  for (let x = -60; x <= 60; x++) for (let z = -60; z <= 60; z++) {
    const d = Math.hypot(x, z);
    if (d > 60) continue;
    const gy = d > 52 ? -2 : 0; // rim drop
    vox.V(x, gy, z, gy < 0 ? 0x3c6e30 : pick(grassC));
    vox.V(x, gy - 1, z, pick(dirtC));
    vox.V(x, gy - 2, z, pick(dirtC));
    vox.V(x, gy - 3, z, pick(stoneC));
  }
  // soil mound at the center: the planting spot (root voxel sits at y=3)
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
    const d = Math.hypot(x, z);
    if (d <= 6) vox.V(x, 1, z, pick(dirtC));
    if (d <= 4) vox.V(x, 2, z, pick(dirtC));
  }
  // rocky underside
  for (let y = -4; y >= -40; y--) {
    const r = y >= -12 ? 60 : 60 * Math.pow(Math.max(0, 1 - (-y - 12) / 28), 0.85);
    if (r < 1) continue;
    for (let x = -60; x <= 60; x++) for (let z = -60; z <= 60; z++) {
      const d = Math.hypot(x, z);
      const rr = r - 2.4 + hash3(x, y, z) * 4.4;
      if (d < rr && d > rr - 6 - hash3(x * 7, y * 3, z * 11) * 3)
        vox.V(x, y, z, hash3(x * 3, y, z * 5) < 0.25 ? pick(dirtC) : pick(stoneC));
    }
  }
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++)
    for (let y = -44; y <= -40; y++) vox.V(x, y, z, 0x6e6e76); // plug the tip
  for (let i = 0; i < 10; i++) { // dangling root spikes
    const x = Math.round((rnd() * 2 - 1) * 16), z = Math.round((rnd() * 2 - 1) * 16);
    const len = 4 + ((rnd() * 6) | 0);
    for (let k = 0; k < len; k++) vox.V(x, -40 - k, z, pick(stoneC));
  }
  for (let a = 0; a < 70; a++) { // moss on the cliff, just under the rim
    const t = rnd() * Math.PI * 2, rr = 59 + rnd() * 2.5;
    const x = Math.round(Math.cos(t) * rr), z = Math.round(Math.sin(t) * rr);
    if (Math.hypot(x, z) > 62) continue;
    vox.V(x, -4 - ((rnd() * 2) | 0), z, 0x3c6e30, 1.4, 1.8, 1.4);
  }
  const g = new THREE.Group();
  buildSet(vox, g);
  scene.add(g);
})();

/* ---------------- the tree: one dynamic instanced mesh ---------------- */
const TREE_CAP = 8192;
const treeMesh = new THREE.InstancedMesh(boxGeo,
  new THREE.MeshLambertMaterial({ color: 0xffffff }), TREE_CAP);
treeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
treeMesh.castShadow = true;
treeMesh.receiveShadow = true;
treeMesh.frustumCulled = false;
scene.add(treeMesh);
const idMap = []; // instanceId -> sim node id
const nodeToInst = new Map(); // sim node id -> instanceId (for the trim glow)
let treeDirty = true;
let revealCount = 1e15; // catch-up replay draws only the first N live nodes
const _col = new THREE.Color();
function nodeColor(n) {
  if (n.tier === 4) _col.setHSL(0.26 + n.col * 0.05, 0.52, 0.23 + n.col * 0.15);
  else _col.setHSL(0.07, 0.42, 0.185 + n.tier * 0.028 + n.col * 0.085);
  return _col;
}
function rebuildTree() {
  const nodes = sim.nodes;
  let i = 0;
  idMap.length = 0;
  nodeToInst.clear();
  for (let id = 0; id < nodes.length && i < TREE_CAP; id++) {
    const n = nodes[id];
    if (!n || n.dead) continue;
    if (i >= revealCount) break;
    dummy.position.set(n.x * VS, n.y * VS, n.z * VS);
    dummy.scale.set(VS, VS, VS);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    treeMesh.setMatrixAt(i, dummy.matrix);
    treeMesh.setColorAt(i, nodeColor(n));
    idMap[i] = id;
    nodeToInst.set(id, i);
    i++;
  }
  treeMesh.count = i;
  treeMesh.instanceMatrix.needsUpdate = true;
  if (treeMesh.instanceColor) treeMesh.instanceColor.needsUpdate = true;
  treeDirty = false;
  // a trim preview in progress survives the rebuild
  if (holdSub) setGlow(holdSub);
}

/* ---------------- falling cuttings: debris ---------------- */
const DEB_CAP = 512;
const debrisMesh = new THREE.InstancedMesh(boxGeo,
  new THREE.MeshLambertMaterial({ color: 0xffffff }), DEB_CAP);
debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
debrisMesh.frustumCulled = false;
scene.add(debrisMesh);
// Allocate the instanceColor buffer BEFORE the first render: three.js bakes
// USE_INSTANCING_COLOR into the compiled program, and a mesh first rendered
// without instanceColor can keep rendering white after colors are added.
debrisMesh.setColorAt(0, new THREE.Color(0xffffff));
debrisMesh.count = 0;
const debris = []; // {x,y,z,vx,vy,vz,rx,rz,vr,tier,col,rest,shrink}
function groundY(wx, wz) {
  const r = Math.hypot(wx, wz) / VS;
  if (r <= 4) return 1.5;
  if (r <= 6) return 1.0;
  if (r <= 60) return 0.5;
  return -1e9;
}
function spawnDebris(list) {
  for (const v of list) {
    if (debris.length >= DEB_CAP) debris.shift();
    debris.push({
      x: v.x * VS, y: v.y * VS, z: v.z * VS,
      vx: (Math.random() - 0.5) * 1.6, vy: Math.random() * 0.8, vz: (Math.random() - 0.5) * 1.6,
      rx: Math.random() * 6.28, rz: Math.random() * 6.28, vr: (Math.random() - 0.5) * 6,
      tier: v.tier, col: v.col, rest: false, shrink: 0
    });
  }
}
function updateDebris(dt) {
  if (!debris.length) { debrisMesh.count = 0; return; }
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    if (!d.rest) {
      d.vy -= 14 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.rx += d.vr * dt; d.rz += d.vr * 0.7 * dt;
      const gy = groundY(d.x, d.z);
      if (d.y <= gy) { d.y = gy; d.rest = true; d.vx = d.vy = d.vz = 0; }
      else if (d.y < -25) { debris.splice(i, 1); continue; }
    } else {
      d.shrink += dt / 2.5;
      if (d.shrink >= 1) { debris.splice(i, 1); continue; }
    }
  }
  for (let i = 0; i < debris.length; i++) {
    const d = debris[i];
    const s = VS * Math.max(0.001, 1 - d.shrink);
    dummy.position.set(d.x, d.y + s * 0.28, d.z);
    dummy.rotation.set(d.rx, 0, d.rz);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    debrisMesh.setMatrixAt(i, dummy.matrix);
    debrisMesh.setColorAt(i, nodeColor(d));
  }
  debrisMesh.count = debris.length;
  debrisMesh.instanceMatrix.needsUpdate = true;
  if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
}

/* ---------------- cut feedback ring ---------------- */
const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 40),
  new THREE.MeshBasicMaterial({ color: 0xfff2dd, transparent: true, opacity: 0,
    side: THREE.DoubleSide, depthWrite: false }));
ring.visible = false;
scene.add(ring);
let ringT = 1e9;
function cutFlash(p) {
  ring.position.copy(p);
  ring.lookAt(camera.position);
  ringT = 0;
  ring.visible = true;
}
function updateRing(dt) {
  if (!ring.visible) return;
  ringT += dt;
  const k = ringT / 0.6;
  if (k >= 1) { ring.visible = false; return; }
  const s = 1 + k * 7;
  ring.scale.set(s, s, s);
  ring.material.opacity = 0.9 * (1 - k);
}

/* ---------------- sim boot / persistence / catch-up ---------------- */
const SAVE_KEY = 'bonsai.v1';
let sim = null;
let replay = null; // {t, dur, from, to}
const catchupPill = document.getElementById('catchup');
function showCatchup(v) { catchupPill.style.display = v ? 'block' : 'none'; }

function saveNow() {
  if (!sim) return;
  try {
    const d = sim.save();
    d.lastTime = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(d));
  } catch (e) { /* storage full/blocked: the tree just won't persist */ }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return (d && d.v === 1) ? d : null;
  } catch (e) { return null; }
}
/* Fast-forward the sim for `minutes` of absence; if anything grew, replay it
   visibly before resuming live growth. */
function catchUp(minutes) {
  if (!sim || replay || minutes <= 0.5) return;
  const baseLive = sim.voxels;
  const ff = sim.fastForward(minutes, true);
  if (ff.events.length > 4) {
    replay = {
      t: 0,
      dur: Math.min(10, Math.max(4, 4 + ff.events.length / 300)),
      from: baseLive, to: sim.voxels
    };
    revealCount = baseLive;
    showCatchup(true);
  } else {
    revealCount = 1e15;
  }
  treeDirty = true;
  saveNow();
}
function boot() {
  const d = loadSave();
  if (d) {
    sim = new BonsaiSim.Sim(1);
    sim.load(d);
    sim.rate = d.rate || 0.2;
    rateSlider.value = String(rateToSlider(sim.rate));
    updateRateWord();
    const elapsedMin = ((Date.now() - (d.lastTime || Date.now())) / 60000);
    catchUp(elapsedMin);
    if (!replay) revealCount = 1e15;
  } else {
    sim = new BonsaiSim.Sim((Date.now() % 2147483647) >>> 0);
    sim.rate = sliderToRate(parseFloat(rateSlider.value));
    revealCount = 1e15;
  }
  treeDirty = true;
}

/* ---------------- UI ---------------- */
const statusEl = document.getElementById('status');
const rateSlider = document.getElementById('rate');
const rateWord = document.getElementById('rateWord');
function sliderToRate(v) { return 0.2 * Math.pow(3000, v / 1000); } // 0.2 .. 600 vox/min
function rateToSlider(r) {
  return Math.round(1000 * Math.log(r / 0.2) / Math.log(3000));
}
function updateRateWord() {
  const r = sim ? sim.rate : 3;
  rateWord.textContent = r < 1 ? 'slow' : r < 8 ? 'steady' : r < 80 ? 'brisk' : 'wild';
}
rateSlider.addEventListener('input', function () {
  if (!sim) return;
  sim.rate = sliderToRate(parseFloat(rateSlider.value));
  updateRateWord();
});
rateSlider.addEventListener('change', saveNow);

const newTreeBtn = document.getElementById('newTree');
let armTimer = null;
newTreeBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  if (!newTreeBtn.dataset.armed) {
    newTreeBtn.dataset.armed = '1';
    statusEl.textContent = 'tap \u{1F331} again to start over';
    armTimer = setTimeout(function () {
      delete newTreeBtn.dataset.armed;
      updateStatus(true);
    }, 4000);
  } else {
    clearTimeout(armTimer);
    delete newTreeBtn.dataset.armed;
    sim = new BonsaiSim.Sim((Date.now() % 2147483647) >>> 0);
    sim.rate = sliderToRate(parseFloat(rateSlider.value));
    debris.length = 0;
    replay = null;
    showCatchup(false);
    revealCount = 1e15;
    treeDirty = true;
    saveNow();
    updateStatus(true);
  }
});
const helpEl = document.getElementById('help');
document.getElementById('helpBtn').addEventListener('click', function (e) {
  e.stopPropagation();
  helpEl.style.display = helpEl.style.display === 'block' ? 'none' : 'block';
});

/* ---------------- menu: the top-left button opens it, everything lives inside ---------------- */
const menuBtn = document.getElementById('menuBtn');
const menuEl = document.getElementById('menu');
function closeMenu() {
  menuEl.classList.remove('open');
  helpEl.style.display = 'none';
}
menuBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  menuEl.classList.toggle('open');
  if (!menuEl.classList.contains('open')) helpEl.style.display = 'none';
});

let lastStatus = '';
function updateStatus(force) {
  let s;
  if (replay) s = 'catching up\u2026';
  else if (!sim) s = 'waking up\u2026';
  else if (newTreeBtn.dataset.armed) return; // keep the confirm prompt
  else s = sim.dormant ? 'resting \u2014 prune to wake it' : 'growing\u2026';
  if (force || s !== lastStatus) { statusEl.textContent = s; lastStatus = s; }
}

/* ---------------- ambient audio: your music/ folder, else a generative hum ---------------- */
let AC = null, master = null, soundOn = false, pluckTimer = null;
let musicAudio = null, musicOrder = [], musicIdx = 0, generativeOn = false;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  master = AC.createGain(); master.gain.value = 0; master.connect(AC.destination);
  // Drop audio files in music/ and they play in random order instead of the hum.
  // no-store: never serve a stale cached playlist after new tracks are added.
  fetch('music/playlist.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (pl) {
      if (pl && pl.tracks && pl.tracks.length) startFileMusic(pl.tracks);
      else startGenerative();
    }).catch(startGenerative);
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0, t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function playTrack() {
  if (!musicAudio) return;
  musicAudio.src = 'music/' + musicOrder[musicIdx];
  const p = musicAudio.play();
  if (p && p.catch) p.catch(function () {});
}
function startFileMusic(tracks) {
  if (generativeOn || musicAudio) return;
  musicOrder = shuffle(tracks.slice()); musicIdx = 0;
  musicAudio = new Audio();
  musicAudio.preload = 'auto';
  musicAudio.addEventListener('ended', function () {
    musicIdx++;
    if (musicIdx >= musicOrder.length) { musicOrder = shuffle(tracks.slice()); musicIdx = 0; }
    playTrack();
  });
  if (soundOn) playTrack();
}
function startGenerative() {
  if (generativeOn || musicAudio) return;
  generativeOn = true;
  const o1 = AC.createOscillator(); o1.type = 'sine'; o1.frequency.value = 110;
  const o2 = AC.createOscillator(); o2.type = 'sine'; o2.frequency.value = 164.81; o2.detune.value = 5;
  const o3 = AC.createOscillator(); o3.type = 'sine'; o3.frequency.value = 220; o3.detune.value = -4;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  const g = AC.createGain(); g.gain.value = 0.4;
  o1.connect(f); o2.connect(f); o3.connect(f); f.connect(g); g.connect(master);
  o1.start(); o2.start(); o3.start();
  const lfo = AC.createOscillator(); lfo.frequency.value = 0.07;
  const lg = AC.createGain(); lg.gain.value = 0.15;
  lfo.connect(lg); lg.connect(g.gain); lfo.start();
  if (soundOn) master.gain.linearRampToValueAtTime(0.16, AC.currentTime + 3);
  schedulePluck();
}
function schedulePluck() {
  clearTimeout(pluckTimer);
  pluckTimer = setTimeout(function () {
    if (AC && soundOn) {
      const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      const fr = scale[(Math.random() * scale.length) | 0];
      const o = AC.createOscillator(); o.type = 'triangle'; o.frequency.value = fr;
      const g = AC.createGain(), t0 = AC.currentTime;
      g.gain.setValueAtTime(0.22, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.8);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 3);
    }
    schedulePluck();
  }, 6000 + Math.random() * 9000);
}
function snip() {
  if (!AC || !soundOn) return;
  try {
    const len = Math.floor(AC.sampleRate * 0.09);
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = AC.createBufferSource(); src.buffer = buf;
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2300; f.Q.value = 1.1;
    const g = AC.createGain(); g.gain.value = 0.45;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  } catch (e) {}
}
const sndBtn = document.getElementById('snd');
sndBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  soundOn = !soundOn;
  sndBtn.textContent = soundOn ? '\u{1F50A}' : '\u{1F507}';
  initAudio();
  if (musicAudio) {
    if (soundOn) {
      if (!musicAudio.src) playTrack();
      else { const p = musicAudio.play(); if (p && p.catch) p.catch(function () {}); }
    } else musicAudio.pause();
  }
  if (AC) {
    if (soundOn) {
      AC.resume();
      master.gain.cancelScheduledValues(AC.currentTime);
      master.gain.linearRampToValueAtTime(0.16, AC.currentTime + 2);
    } else {
      master.gain.linearRampToValueAtTime(0, AC.currentTime + 0.5);
    }
  }
});

/* ---------------- hold-to-trim: 1s press, charging dial, glow preview ---------------- */
const HOLD_TIME = 1.0, HOLD_R = 10;
let holdPid = -1, holdX = 0, holdY = 0, holdT = 0, holdNode = -1, holdSub = null;
const holdDial = document.getElementById('holdDial');
const holdDialFg = document.getElementById('holdDialFg');
const DIAL_C = 2 * Math.PI * 26;
const glowInst = new Map(); // instanceId -> nodeId currently glowing

function pickNode(cx, cy) {
  if (!sim || !treeMesh) return -1;
  pointerNDC.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObject(treeMesh);
  if (!hits.length) return -1;
  const nodeId = idMap[hits[0].instanceId];
  return nodeId == null ? -1 : nodeId;
}
function setGlow(ids) {
  clearGlow();
  if (!treeMesh.instanceColor) return;
  for (const nid of ids) {
    const inst = nodeToInst.get(nid);
    if (inst === undefined) continue;
    treeMesh.setColorAt(inst, _col.setRGB(2.2, 2.2, 2.2)); // overbright = glow
    glowInst.set(inst, nid);
  }
  treeMesh.instanceColor.needsUpdate = true;
}
function clearGlow() {
  if (!glowInst.size) return;
  if (treeMesh.instanceColor) {
    for (const [inst, nid] of glowInst) {
      const n = sim.nodes[nid];
      if (n && !n.dead) treeMesh.setColorAt(inst, nodeColor(n));
    }
    treeMesh.instanceColor.needsUpdate = true;
  }
  glowInst.clear();
}
function startHold(e) {
  if (replay || !sim || holdPid !== -1) return;
  const id = pickNode(e.clientX, e.clientY);
  if (id < 0) return;
  const prev = sim.previewCut(id);
  if (!prev || !prev.sub.length) return;
  holdPid = e.pointerId;
  holdX = e.clientX; holdY = e.clientY; holdT = 0;
  holdNode = id; holdSub = prev.sub;
  setGlow(holdSub);
  holdDial.style.left = holdX + 'px';
  holdDial.style.top = holdY + 'px';
  holdDial.style.display = 'block';
  holdDialFg.style.strokeDashoffset = DIAL_C;
}
function cancelHold() {
  if (holdPid === -1) return;
  holdPid = -1; holdNode = -1; holdSub = null; holdT = 0;
  clearGlow();
  holdDial.style.display = 'none';
}
function finishHold() {
  const id = holdNode;
  cancelHold();
  if (id >= 0 && !replay) pruneAtNode(id);
}

/* ---------------- orbit camera + hold-to-trim ---------------- */
const target = new THREE.Vector3(0, 15, 0);
let theta = 0.7, tTheta = 0.7, phi = 1.02, tPhi = 1.02, radius = 62, tRadius = 62;
let lastTouch = 0, prevPinch = 0;
const pointers = new Map();
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

canvas.addEventListener('pointerdown', function (e) {
  if (menuEl.classList.contains('open')) { closeMenu(); return; } // tap outside dismisses the menu
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  lastTouch = performance.now();
  initAudio();
  if (holdPid !== -1) { cancelHold(); return; } // second finger: it's a gesture, not a trim
  startHold(e);
});
canvas.addEventListener('pointermove', function (e) {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  lastTouch = performance.now();
  if (e.pointerId === holdPid && Math.hypot(e.clientX - holdX, e.clientY - holdY) > HOLD_R) {
    cancelHold(); // dragged: it was an orbit, not a trim
  }
  if (pointers.size === 1) {
    tTheta -= (e.clientX - prev[0]) * 0.005;
    tPhi -= (e.clientY - prev[1]) * 0.005;
    tPhi = Math.max(0.35, Math.min(1.62, tPhi));
  } else if (pointers.size === 2) {
    const pts = Array.from(pointers.values());
    const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
    if (prevPinch > 0 && d > 0) tRadius = Math.max(24, Math.min(150, tRadius * prevPinch / d));
    prevPinch = d;
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId); prevPinch = 0;
  if (e.pointerId === holdPid) cancelHold(); // released early: no trim
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', function (e) { pointers.delete(e.pointerId); prevPinch = 0; cancelHold(); });
canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  tRadius = Math.max(24, Math.min(150, tRadius * (1 + e.deltaY * 0.001)));
  lastTouch = performance.now();
}, { passive: false });
/* ---------------- main loop ---------------- */
const clock = new THREE.Clock();
let lastTick = Date.now();
let statusTimer = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

  // background-tab catch-up: if rAF was suspended, treat it like an absence
  const nowMs = Date.now();
  const gapMin = (nowMs - lastTick) / 60000;
  lastTick = nowMs;
  if (gapMin > 1 && !replay) catchUp(gapMin);

  if (performance.now() - lastTouch > 6000) tTheta += dt * 0.04; // idle drift
  theta += (tTheta - theta) * Math.min(1, dt * 5);
  phi += (tPhi - phi) * Math.min(1, dt * 5);
  radius += (tRadius - radius) * Math.min(1, dt * 5);
  camera.position.set(
    target.x + radius * Math.sin(phi) * Math.cos(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.sin(theta));
  camera.lookAt(target);

  if (sim) {
    if (replay) {
      replay.t += dt;
      const k = Math.min(1, replay.t / replay.dur);
      const e = k * k * (3 - 2 * k);
      revealCount = Math.round(replay.from + (replay.to - replay.from) * e);
      treeDirty = true;
      if (k >= 1) {
        replay = null;
        revealCount = 1e15;
        showCatchup(false);
        treeDirty = true;
      }
    } else {
      if (sim.advance(dt / 60) > 0) { treeDirty = true; revealCount = 1e15; }
    }
  }
  if (treeDirty) rebuildTree();
  updateDebris(dt);
  updateRing(dt);

  // hold-to-trim: charge the dial; a full second executes the trim
  if (holdPid !== -1 && holdNode >= 0) {
    holdT += dt;
    const p = Math.min(1, holdT / HOLD_TIME);
    holdDialFg.style.strokeDashoffset = DIAL_C * (1 - p);
    if (p >= 1) finishHold();
  }

  statusTimer += dt;
  if (statusTimer > 1) { statusTimer = 0; updateStatus(false); }

  renderer.render(scene, camera);
}

window.addEventListener('resize', function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- persistence hooks ---------------- */
setInterval(saveNow, 5000);
window.addEventListener('beforeunload', saveNow);
document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });

/* ---------------- debug hooks (headless verification) ---------------- */
window.__bonsai = {
  get sim() { return sim; },
  get replay() { return replay; },
  get debris() { return debris; },
  stats: function () { return sim ? sim.stats() : null; },
  cutAt: function (nodeId) { return pruneAtNode(nodeId); },
  debugDebris: function () {
    const arr = debrisMesh.instanceColor ? Array.from(debrisMesh.instanceColor.array.slice(0, 12)) : null;
    return {
      count: debrisMesh.count, length: debris.length,
      colors0_3: arr,
      first: debris[0] ? { x: debris[0].x, y: debris[0].y, z: debris[0].z,
        vy: debris[0].vy, tier: debris[0].tier, col: debris[0].col, rest: debris[0].rest } : null
    };
  },
  nodeScreenXY: function (nodeId) {
    const n = sim.nodes[nodeId];
    if (!n || n.dead) return null;
    _v3.set(n.x * VS, n.y * VS, n.z * VS).project(camera);
    return { x: (_v3.x + 1) / 2 * window.innerWidth, y: (1 - _v3.y) / 2 * window.innerHeight };
  },
  syncTree: function () { rebuildTree(); },
  holdState: function () {
    return { pid: holdPid, node: holdNode, t: Math.round(holdT * 100) / 100,
             sub: holdSub ? holdSub.length : 0,
             dial: holdDial.style.display };
  },
  audio: function () {
    return { generative: generativeOn, fileMusic: !!musicAudio,
             tracks: musicOrder.length, soundOn: soundOn };
  },
  step: function (n) { for (let i = 0; i < (n || 1); i++) sim.growOne(); revealCount = 1e15; treeDirty = true; },
  setRate: function (r) { sim.rate = r; updateRateWord(); },
  newTree: function (seed) {
    sim = new BonsaiSim.Sim(seed == null ? ((Date.now() % 2147483647) >>> 0) : seed);
    sim.rate = sliderToRate(parseFloat(rateSlider.value));
    debris.length = 0; replay = null; showCatchup(false);
    revealCount = 1e15; treeDirty = true; saveNow();
  },
  saveNow: saveNow,
  revealAll: function () { revealCount = 1e15; treeDirty = true; },
  fastForward: function (minutes) { catchUp(minutes); }
};
function pruneAtNode(nodeId) {
  if (!sim) return null;
  const n = sim.nodes[nodeId];
  if (n) {
    _v3.set(n.x * VS, n.y * VS, n.z * VS);
    cutFlash(_v3);
  }
  const res = sim.cut(nodeId);
  if (!res || res.rejected) return res;
  spawnDebris(res.debris);
  snip();
  revealCount = 1e15;
  treeDirty = true;
  updateStatus(true);
  return res;
}
const _v3 = new THREE.Vector3();

boot();
updateStatus(true);
animate();
})();

