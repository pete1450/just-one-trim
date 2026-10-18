/* Bonsai growth simulation — pure logic, no DOM, no THREE.
   Deterministic given (seed, rngState). Node/testable in node.
   Voxel units are integers; the tree is a parent-pointer graph so a cut
   removes exactly the subtree "away from the trunk". */
'use strict';

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return {
    next() {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get() { return s | 0; },
    set(v) { s = v | 0; }
  };
}

/* Per-tier growth parameters. One table, everything tunable. */
const TIER = {
  // minClimb: phototropism as a floor — a tip never droops below this climb.
  // arcDeg: per-step pitch toward horizontal — branches flatten as they
  // extend (applied as a true rotation, so it persists). Trunk: 0.
  1: { lenMin: 52, lenMax: 58, forkP: 0.004, girthMax: 3, cutBudget: 16, minClimb: 0.60, wander: 0.22, arcDeg: 0 },
  2: { lenMin: 18, lenMax: 28, forkP: 0.015, girthMax: 2, cutBudget: 12, minClimb: 0.25, wander: 0.32, arcDeg: 1.5 },
  3: { lenMin: 9,  lenMax: 14, forkP: 0.040, girthMax: 1, cutBudget: 8,  minClimb: 0.15, wander: 0.34, arcDeg: 0.9 }
};
const SHOOT_P = { 1: 0.020, 2: 0.020, 3: 0.012 }; // wild child-tier shoot per growth event
const SHOOT_P_FULL = 0.004;   // ...once the child tier already hit its target
const WILD_MINUTES = 2500;    // dormant tree: ~one wild shoot per this many minutes
const SPROUT_P = 0.28;        // new twig voxel sprouts interior greenery
const CAP_MULT = 1.35;        // tier segment counts may overshoot targets by this much
const VOXEL_HARD_CAP = 7000;  // absolute backstop on live voxels
const BOUND_R = 34, BOUND_TOP = 90, BOUND_BOT = 2;
const ROOT = [0, 3, 0];       // root voxel: sits on the soil mound (mound top y=2)

const GREEN_SIZES = [30, 48];  // greenery cluster size range (terminal)
const SPROUT_SIZES = [12, 20]; // interior sprout size range

class Sim {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
    this.nodes = [];          // index = id; null = dead/removed
    this.occ = new Map();     // "x|y|z" -> live node id
    this.segs = new Map();    // segId -> segment
    this.tips = new Map();    // tipId -> live tip
    this.clusters = new Map();// clusterId -> greenery cluster
    this.nextNode = 0; this.nextSeg = 0; this.nextTip = 0; this.nextCl = 0;
    this.counts = { s1: 0, s2: 0, s3: 0, cl: 0 };
    this.targets = { s1: 1, s2: this._ri(8, 11), s3: this._ri(30, 46), cl: this._ri(130, 180) };
    this.liveChain = [];      // live tier1-3 non-girth node ids (shoot candidates)
    this.chainPos = new Map();// nodeId -> index in liveChain (swap-remove)
    this.rate = 0.2;          // voxels per minute (UI slider; default = slowest)
    this.acc = 0;             // fractional growth accumulator
    this.wildAcc = 0;         // minutes accumulated while dormant
    this.voxels = 0;          // live voxel count
    this.simMin = 0;
    this._seedTree();
  }

  /* ---------- rng helpers ---------- */
  _ri(a, b) { return a + Math.floor(this.rng.next() * (b - a + 1)); }
  _chance(p) { return this.rng.next() < p; }
  _pick(arr) { return arr[Math.floor(this.rng.next() * arr.length)]; }

  /* ---------- low-level node ops ---------- */
  _key(x, y, z) { return x + '|' + y + '|' + z; }

  _addNode(o) {
    const id = this.nextNode++;
    const n = {
      id, x: o.x, y: o.y, z: o.z, tier: o.tier, parent: o.parent,
      children: [], seg: o.seg, segIdx: o.segIdx || 0,
      girth: !!o.girth, cluster: o.cluster == null ? -1 : o.cluster,
      col: o.col, dx: o.dx || 0, dy: o.dy || 1, dz: o.dz || 0,
      shoots: 0, dead: false
    };
    this.nodes[id] = n;
    this.occ.set(this._key(o.x, o.y, o.z), id);
    if (o.parent != null && o.parent >= 0) {
      const p = this.nodes[o.parent];
      if (p && !p.dead) p.children.push(id);
    }
    if (!n.girth && n.tier < 4 && n.cluster < 0) {
      this.chainPos.set(id, this.liveChain.length);
      this.liveChain.push(id);
    }
    this.voxels++;
    return id;
  }

  _killNode(id) {
    const n = this.nodes[id];
    if (!n || n.dead) return;
    n.dead = true;
    this.nodes[id] = null;
    this.occ.delete(this._key(n.x, n.y, n.z));
    this.voxels--;
    if (n.parent != null && n.parent >= 0) {
      const p = this.nodes[n.parent];
      if (p && !p.dead) {
        const i = p.children.indexOf(id);
        if (i >= 0) p.children.splice(i, 1);
      }
    }
    const cp = this.chainPos.get(id);
    if (cp !== undefined) {
      const last = this.liveChain.pop();
      if (last !== id) { this.liveChain[cp] = last; this.chainPos.set(last, cp); }
      this.chainPos.delete(id);
    }
    // segment bookkeeping
    if (!n.girth && n.tier < 4 && n.cluster < 0 && n.seg >= 0) {
      const s = this.segs.get(n.seg);
      if (s) {
        const i = s.nodes.indexOf(id);
        if (i >= 0) s.nodes.splice(i, 1);
        if (s.nodes.length === 0) {
          this.segs.delete(n.seg);
          this.counts['s' + s.tier]--;
        }
      }
    }
    // tip on this node dies
    for (const [tid, t] of this.tips) {
      if (t.nodeId === id) { this.tips.delete(tid); }
    }
    // cluster bookkeeping
    if (n.cluster >= 0) {
      const c = this.clusters.get(n.cluster);
      if (c) {
        const i = c.nodes.indexOf(id);
        if (i >= 0) c.nodes.splice(i, 1);
        if (c.nodes.length === 0) { this.clusters.delete(n.cluster); this.counts.cl--; }
      }
    }
  }

  _collectSubtree(id) {
    const out = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      const n = this.nodes[cur];
      if (!n || n.dead) continue;
      out.push(cur);
      for (const c of n.children) stack.push(c);
    }
    return out;
  }

  /* ---------- segments & tips ---------- */
  _newSegment(tier, parentSeg) {
    const id = this.nextSeg++;
    const s = {
      id, tier, nodes: [], tipId: -1, parentSeg: parentSeg == null ? -1 : parentSeg,
      childSegs: [], girth: 1, complete: false, budget0: 0, regrow: false
    };
    this.segs.set(id, s);
    this.counts['s' + tier]++;
    if (parentSeg != null && parentSeg >= 0) {
      const ps = this.segs.get(parentSeg);
      if (ps) {
        ps.childSegs.push(id);
        if (ps.childSegs.length === 1) this._addGirth(ps); // first child -> parent thickens
      }
    }
    return s;
  }

  _segCap(tier) { return Math.ceil(this.targets['s' + tier] * CAP_MULT); }

  _newTip(nodeId, segId, tier, dir, remaining, mode, priority) {
    const id = this.nextTip++;
    const n = this.nodes[nodeId];
    const t = {
      id, nodeId, segId, tier,
      px: n.x, py: n.y, pz: n.z,
      dx: dir[0], dy: dir[1], dz: dir[2],
      remaining, mode, priority, arcDeg: TIER[tier].arcDeg
    };
    this.tips.set(id, t);
    const s = this.segs.get(segId);
    if (s) s.tipId = id;
    return t;
  }

  _tipOnNode(nodeId) {
    for (const t of this.tips.values()) if (t.nodeId === nodeId) return t;
    return null;
  }

  _norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  _perturb(dir, amt) {
    const r = this.rng;
    return this._norm([dir[0] + (r.next() - 0.5) * 2 * amt,
                       dir[1] + (r.next() - 0.5) * 2 * amt,
                       dir[2] + (r.next() - 0.5) * 2 * amt]);
  }
  _upBias(dir, b) { return this._norm([dir[0], dir[1] + b, dir[2]]); }

  _outwardDir(elevMin, elevMax) {
    const az = this.rng.next() * Math.PI * 2;
    const el = (elevMin + this.rng.next() * (elevMax - elevMin)) * Math.PI / 180;
    return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  }

  /* Spawn a child segment anchored at a live node. Returns the new tip. */
  _spawnSeg(tier, anchorId, dir, budget, mode, priority, parentSegId) {
    const anchor = this.nodes[anchorId];
    if (!anchor || anchor.dead) return null;
    const seg = this._newSegment(tier, parentSegId);
    seg.budget0 = budget;
    anchor.shoots++;
    return this._newTip(anchorId, seg.id, tier, this._norm(dir), budget, mode, priority);
  }

  /* ---------- seeding ---------- */
  _seedTree() {
    const seg = this._newSegment(1, -1);
    const budget = this._ri(TIER[1].lenMin, TIER[1].lenMax);
    seg.budget0 = budget;
    const tilt = (this.rng.next() - 0.5) * 0.24;
    const dir = this._norm([tilt, 1, -tilt * 0.7]);
    const rootId = this._addNode({
      x: ROOT[0], y: ROOT[1], z: ROOT[2], tier: 1, parent: -1,
      seg: seg.id, col: this.rng.next(), dx: dir[0], dy: dir[1], dz: dir[2]
    });
    seg.nodes.push(rootId);
    this._newTip(rootId, seg.id, 1, dir, budget, 'grow', 1.3);
  }

  /* ---------- growth ---------- */
  get dormant() {
    return this.tips.size === 0 &&
      this.counts.s1 >= this.targets.s1 &&
      this.counts.s2 >= this.targets.s2 &&
      this.counts.s3 >= this.targets.s3 &&
      this.counts.cl >= this.targets.cl;
  }

  _pickTip() {
    let best = null, bestW = -1;
    for (const t of this.tips.values()) {
      const w = t.priority * (0.7 + 0.6 * this.rng.next());
      if (w > bestW) { bestW = w; best = t; }
    }
    return best;
  }

  growOne() {
    if (this.voxels >= VOXEL_HARD_CAP) return null;
    if (this.tips.size === 0) {
      // No growing points: either the tree rests, or it back-buds to
      // reach the element counts it is trying for. It never stalls.
      if (this.dormant) return null;
      this._backbud();
      return null;
    }
    const tip = this._pickTip();
    if (!tip) return null;
    const node = this._extend(tip);
    if (!node) { this._retireTip(tip); return null; }
    this._afterGrow(tip, node);
    return { kind: 'grow', id: node.id, x: node.x, y: node.y, z: node.z, tier: node.tier, col: node.col };
  }

  /* Emergency budding: every tier tries to reach its target count, so if
     growth ever stalls below target the tree pushes new buds. Never fails
     while any wood of the parent tier exists (the root always does). */
  _backbud() {
    const cand = (tier) => {
      const out = [];
      for (const id of this.liveChain) {
        const n = this.nodes[id];
        if (n && !n.dead && n.tier === tier) out.push(id);
      }
      return out;
    };
    if (this.counts.s2 < this.targets.s2 && this.counts.s2 < this._segCap(2)) {
      const c = cand(1);
      if (c.length) {
        const nid = this._pick(c);
        const T = TIER[2];
        this._spawnSeg(2, nid, this._outwardDir(15, 50),
                       this._ri(T.lenMin, T.lenMax), 'grow', 1.6, this.nodes[nid].seg);
        return;
      }
    }
    if (this.counts.s3 < this.targets.s3 && this.counts.s3 < this._segCap(3)) {
      const c = cand(2);
      if (c.length) {
        const nid = this._pick(c);
        const n = this.nodes[nid];
        const az = Math.atan2(n.dz, n.dx) + (this.rng.next() - 0.5) * 2.1;
        const el = (30 + this.rng.next() * 35) * Math.PI / 180;
        const T = TIER[3];
        this._spawnSeg(3, nid, [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)],
                       this._ri(T.lenMin, T.lenMax), 'grow', 1.6, n.seg);
        return;
      }
    }
    if (this.counts.cl < this.targets.cl &&
        this.counts.cl < Math.ceil(this.targets.cl * CAP_MULT)) {
      const c = cand(3);
      if (c.length) this._greenery(this._pick(c), this._ri(12, 20));
    }
  }

  _extend(tip) {
    const T = TIER[tip.tier];
    const n0 = this.nodes[tip.nodeId];
    if (!n0 || n0.dead) return null;
    const seg = this.segs.get(tip.segId);
    // a brand-new lateral pushes out of (possibly thick) parent wood:
    // give it many more tries to find the surface before giving up
    const attempts = (seg && seg.nodes.length === 0) ? 22 : 7;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let dir;
      const td = [tip.dx, tip.dy, tip.dz];
      if (attempt < 4) {
        dir = this._perturb(td, T.wander);
        // arc: pitch the heading toward horizontal by arcDeg per step
        // (a real rotation, so the flattening persists)
        const hh = Math.hypot(dir[0], dir[2]);
        if (hh > 1e-4 && tip.arcDeg > 0) {
          let el = Math.atan2(dir[1], hh) - tip.arcDeg * Math.PI / 180;
          const elMin = Math.asin(Math.min(0.9, T.minClimb));
          if (el < elMin) el = elMin;
          const ch = Math.cos(el) / hh;
          dir = [dir[0] * ch, Math.sin(el), dir[2] * ch];
        } else if (dir[1] < T.minClimb) {
          // no arc (trunk): still never droop below the climb floor
          const k2 = Math.min(1, (T.minClimb - dir[1]) * 2.5);
          dir = this._norm([dir[0] * (1 - k2), dir[1] * (1 - k2) + T.minClimb * k2, dir[2] * (1 - k2)]);
        }
        // trunk leash: a trunk may curve, but it stays over its base
        if (tip.tier === 1) {
          const hr = Math.hypot(n0.x, n0.z);
          if (hr > 10) {
            const k = Math.min(0.5, (hr - 10) * 0.08);
            const bl = Math.hypot(n0.x, n0.z) || 1;
            dir = this._norm([dir[0] * (1 - k) - (n0.x / bl) * k, dir[1], dir[2] * (1 - k) - (n0.z / bl) * k]);
          }
        }
      } else {
        // steer back inside the allowed cylinder
        const inw = this._norm([-n0.x, 0.6, -n0.z]);
        dir = this._norm([inw[0] * 0.7 + (this.rng.next() - 0.5),
                          0.5 + this.rng.next() * 0.5,
                          inw[2] * 0.7 + (this.rng.next() - 0.5)]);
      }
      const nx = Math.round(n0.x + dir[0]);
      const ny = Math.round(n0.y + dir[1]);
      const nz = Math.round(n0.z + dir[2]);
      const r = Math.hypot(nx, nz);
      if (this.occ.has(this._key(nx, ny, nz))) continue;
      if (r > BOUND_R || ny > BOUND_TOP || ny < BOUND_BOT) continue;
      if (nx === n0.x && ny === n0.y && nz === n0.z) continue;
      const seg = this.segs.get(tip.segId);
      const id = this._addNode({
        x: nx, y: ny, z: nz, tier: tip.tier, parent: tip.nodeId,
        seg: tip.segId, segIdx: seg ? seg.nodes.length : 0,
        col: this.rng.next(), dx: dir[0], dy: dir[1], dz: dir[2]
      });
      if (seg) seg.nodes.push(id);
      tip.nodeId = id;
      tip.px = nx; tip.py = ny; tip.pz = nz;
      tip.dx = dir[0]; tip.dy = dir[1]; tip.dz = dir[2];
      tip.remaining--;
      return this.nodes[id];
    }
    return null; // boxed in
  }

  _retireTip(tip) {
    this.tips.delete(tip.id);
    const s = this.segs.get(tip.segId);
    if (s && s.tipId === tip.id) { s.tipId = -1; s.complete = true; }
  }

  _afterGrow(tip, node) {
    const tier = tip.tier;
    const isNub = tip.mode === 'nub';
    // interior foliage on fresh twigs (never on a tiny regrowth nub)
    if (tier === 3 && !isNub && this._chance(SPROUT_P) && this.counts.cl < this._segCap(4)) {
      this._greenery(node.id, this._ri(SPROUT_SIZES[0], SPROUT_SIZES[1]));
    }
    if (!isNub) this._tryFork(tip);
    this._tryShoot();
    if (tip.remaining <= 0 && this.tips.has(tip.id)) this._complete(tip);
  }

  /* A regrown segment that put on enough wood gives the lower tiers below
     it a chance at a little more girth — the nearest lower tier gets a
     50% chance, the next one 25%. _addGirth enforces girthMax, so lower
     tiers can never thicken without bound. */
  _regrowGirth(seg) {
    const lowers = [];
    let cur = seg;
    for (let depth = 0; depth < 4 && lowers.length < 2; depth++) {
      const ps = cur.parentSeg >= 0 ? this.segs.get(cur.parentSeg) : null;
      if (!ps) break;
      cur = ps;
      if (ps.tier < seg.tier) lowers.push(ps);
    }
    let p = 0.5;
    for (const ps of lowers) {
      if (this._chance(p)) this._addGirth(ps);
      p *= 0.5;
    }
  }

  /* Bend a handoff direction away from its parent heading by 20-45 degrees
     (random azimuth): a twig arcs off its branch instead of cloning it.
     This is what keeps the crown from spiking straight into the ceiling. */
  _handoffDir(dir) {
    const a = (20 + this.rng.next() * 25) * Math.PI / 180;
    let perp = [-dir[2], (this.rng.next() - 0.5), dir[0]];
    if (Math.hypot(perp[0], perp[1], perp[2]) < 0.2) perp = [1, 0, 0];
    perp = this._norm(perp);
    return this._norm([dir[0] * Math.cos(a) + perp[0] * Math.sin(a),
                       dir[1] * Math.cos(a) + perp[1] * Math.sin(a) + 0.12,
                       dir[2] * Math.cos(a) + perp[2] * Math.sin(a)]);
  }

  _forkDir(dir) {
    // rotate 35-70 degrees away from the parent direction, biased upward
    const a = (35 + this.rng.next() * 35) * Math.PI / 180;
    let perp = [-dir[2], 0, dir[0]];
    if (Math.hypot(perp[0], perp[2]) < 0.2) perp = [1, 0, 0];
    perp = this._norm(perp);
    if (this._chance(0.5)) perp = [-perp[0], -perp[1], -perp[2]];
    const d = [dir[0] * Math.cos(a) + perp[0] * Math.sin(a),
               dir[1] * Math.cos(a) + perp[1] * Math.sin(a) + 0.25,
               dir[2] * Math.cos(a) + perp[2] * Math.sin(a)];
    return this._norm(d);
  }

  _tryFork(tip) {
    const T = TIER[tip.tier];
    if (tip.remaining < 3) return;
    if (this.counts['s' + tip.tier] >= this._segCap(tip.tier)) return;
    if (!this._chance(T.forkP)) return;
    const budget = Math.round(this._ri(T.lenMin, T.lenMax) * 0.75);
    this._spawnSeg(tip.tier, tip.nodeId, this._forkDir([tip.dx, tip.dy, tip.dz]),
                   budget, 'grow', 1.2, tip.segId);
  }

  _tryShoot() {
    if (this.liveChain.length === 0) return;
    const nid = this._pick(this.liveChain);
    const n = this.nodes[nid];
    if (!n || n.dead || n.tier > 3 || n.shoots >= 3) return;
    const child = n.tier + 1;
    const capKey = child === 4 ? 4 : child;
    const atTarget = child === 4
      ? this.counts.cl >= this.targets.cl
      : this.counts['s' + child] >= this.targets['s' + child];
    const p = atTarget ? SHOOT_P_FULL : SHOOT_P[n.tier];
    if (!this._chance(p)) return;
    if (child === 4) {
      if (this.counts.cl >= Math.ceil(this.targets.cl * CAP_MULT)) return;
      this._greenery(nid, this._ri(SPROUT_SIZES[0], SPROUT_SIZES[1]));
      return;
    }
    if (this.counts['s' + child] >= this._segCap(child)) return;
    let dir;
    if (n.tier === 1) dir = this._outwardDir(15, 50);
    else if (n.tier === 2) {
      const az = Math.atan2(n.dz, n.dx) + (this.rng.next() - 0.5) * 2.1;
      const el = (25 + this.rng.next() * 40) * Math.PI / 180;
      dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    } else {
      dir = this._outwardDir(30, 70);
    }
    const T = TIER[child];
    this._spawnSeg(child, nid, dir, this._ri(T.lenMin, T.lenMax), 'grow', 1.0, n.seg);
  }

  _complete(tip) {
    const seg = this.segs.get(tip.segId);
    this.tips.delete(tip.id);
    if (seg) { seg.tipId = -1; seg.complete = true; this._addGirth(seg); }
    if (tip.mode === 'nub') return; // tiny twig nub: a few voxels, then it stops
    // A regrown segment that put on enough wood gives the lower tiers
    // holding it up a chance at a little more girth. Chance-based, and
    // _addGirth enforces girthMax, so lower tiers never thicken endlessly.
    if (seg && seg.regrow && seg.nodes.length >= 6) this._regrowGirth(seg);
    const tier = tip.tier;
    const dir = [tip.dx, tip.dy, tip.dz];

    if (tip.mode === 'continue') {
      // stump regrowth: push out more of the same tier, then behave normally
      const T = TIER[tier];
      const nt = this._spawnSeg(tier, tip.nodeId, this._upBias(this._perturb(dir, 0.5), 0.2),
                     this._ri(T.lenMin, T.lenMax), 'grow', 1.5, tip.segId);
      if (nt && seg && seg.regrow) {
        const ns = this.segs.get(nt.segId);
        if (ns) ns.regrow = true;
      }
      return;
    }
    if (tier < 3) {
      // advance: hand off to the next tier
      const child = tier + 1;
      if (this.counts['s' + child] >= this._segCap(child)) return; // at cap: retire
      const T = TIER[child];
      let budget, cdir;
      if (tier === 1) {
        // trunk -> upward leader: shorter than a normal branch, strongly vertical
        budget = this._ri(12, 18);
        cdir = this._upBias(dir, 0.35);
      } else {
        budget = this._ri(T.lenMin, T.lenMax);
        cdir = this._handoffDir(dir); // arc off the branch, don't clone its heading
      }
      this._spawnSeg(child, tip.nodeId, cdir, budget,
                     'grow', tier === 1 ? 1.3 : 1.0, tip.segId);
      if (tier === 1 && seg) this._scaffoldBranches(seg);
    } else {
      // twig completion (grow or advance): cap it with greenery
      if (this.counts.cl < Math.ceil(this.targets.cl * CAP_MULT)) {
        this._greenery(tip.nodeId, this._ri(GREEN_SIZES[0], GREEN_SIZES[1]));
      }
    }
  }

  _scaffoldBranches(trunkSeg) {
    // when the trunk finishes, set 3-5 scaffold branches along its midsection
    const nodes = trunkSeg.nodes;
    if (nodes.length < 12) return;
    const k = this._ri(3, 5);
    const lo = Math.floor(nodes.length * 0.25), hi = Math.floor(nodes.length * 0.85);
    for (let i = 0; i < k; i++) {
      if (this.counts.s2 >= this._segCap(2)) return;
      const nid = nodes[this._ri(lo, hi)];
      const n = this.nodes[nid];
      if (!n || n.dead || n.shoots >= 3) continue;
      const T = TIER[2];
      this._spawnSeg(2, nid, this._outwardDir(15, 50),
                     this._ri(T.lenMin, T.lenMax), 'grow', 1.1, trunkSeg.id);
    }
  }

  _addGirth(seg) {
    const T = TIER[seg.tier];
    if (seg.girth >= T.girthMax) return;
    seg.girth++;
    const L = seg.girth;
    const n = seg.nodes.length;
    for (let i = 0; i < n; i++) {
      const cn = this.nodes[seg.nodes[i]];
      if (!cn || cn.dead) continue;
      // taper: full ring only on the basal part, thinner toward the tip
      const frac = n <= 1 ? 0 : i / (n - 1);
      let ring = L;
      if (L === 3 && frac > 0.65) ring = 2;
      if (L === 2 && frac > 0.8) ring = 1;
      if (ring < 2) continue;
      // local frame perpendicular to the segment direction
      const d = this._norm([cn.dx, cn.dy, cn.dz]);
      let u = [-d[2], 0, d[0]];
      if (Math.hypot(u[0], u[2]) < 0.2) u = [1, 0, 0];
      u = this._norm(u);
      const v = this._norm([d[1] * u[2] - d[2] * u[1],
                            d[2] * u[0] - d[0] * u[2],
                            d[0] * u[1] - d[1] * u[0]]);
      const offs = ring === 2
        ? [[1, 0], [0, 1], [1, 1]]
        : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [a, b] of offs) {
        const nx = Math.round(cn.x + u[0] * a + v[0] * b);
        const ny = Math.round(cn.y + u[1] * a + v[1] * b);
        const nz = Math.round(cn.z + u[2] * a + v[2] * b);
        if (this.occ.has(this._key(nx, ny, nz))) continue;
        if (Math.hypot(nx, nz) > 36) continue;
        this._addNode({
          x: nx, y: ny, z: nz, tier: seg.tier, parent: cn.id,
          seg: seg.id, girth: true, col: this.rng.next() * 0.9, // slightly darker
          dx: d[0], dy: d[1], dz: d[2]
        });
      }
    }
  }

  _greenery(anchorId, size) {
    const anchor = this.nodes[anchorId];
    if (!anchor || anchor.dead) return null;
    const id = this.nextCl++;
    const c = { id, nodes: [], twigSeg: anchor.seg, anchor: anchorId };
    this.clusters.set(id, c);
    this.counts.cl++;
    let cx = anchor.x, cy = anchor.y, cz = anchor.z;
    let placed = 0;
    for (let i = 0; i < size * 10 && placed < size; i++) {
      const ox = this._ri(-1, 1), oy = this._ri(-1, 1), oz = this._ri(-1, 1);
      if (!ox && !oy && !oz) continue;
      const nx = cx + ox, ny = cy + oy, nz = cz + oz;
      if (Math.hypot(nx - anchor.x, ny - anchor.y, nz - anchor.z) > 5) continue;
      if (ny < BOUND_BOT || ny > BOUND_TOP) continue;
      if (Math.hypot(nx, nz) > 38) continue; // foliage may overhang wood slightly
      if (this.occ.has(this._key(nx, ny, nz))) continue;
      const nid = this._addNode({
        x: nx, y: ny, z: nz, tier: 4, parent: anchorId,
        seg: anchor.seg, cluster: id, col: this.rng.next(),
        dx: ox, dy: oy, dz: oz
      });
      c.nodes.push(nid);
      placed++;
      if (this._chance(0.6)) { cx = nx; cy = ny; cz = nz; }
    }
    if (c.nodes.length === 0) { this.clusters.delete(id); this.counts.cl--; return null; }
    return c;
  }

  /* ---------- pruning ---------- */
  cut(nodeId) {
    let node = this.nodes[nodeId];
    if (!node || node.dead) return null;
    if (node.girth) { nodeId = node.parent; node = this.nodes[nodeId]; }
    if (!node || node.dead) return null;
    if (node.tier === 4) return this._cutCluster(node.cluster);
    if (nodeId === 0) return { rejected: 'root' };

    const sub = this._collectSubtree(nodeId);
    const parentId = node.parent;
    const debris = sub.map(id => {
      const n = this.nodes[id];
      return { x: n.x, y: n.y, z: n.z, tier: n.tier, col: n.col };
    });
    for (const id of sub) this._killNode(id);

    let stump = null;
    const p = this.nodes[parentId];
    if (p && !p.dead && p.tier >= 1 && p.tier <= 3 && !p.girth && !this._tipOnNode(parentId)) {
      stump = this._stumpPlan(p);
    }
    this.wildAcc = 0; // a pruned tree is awake
    return { removed: sub.length, debris, stump };
  }

  _cutCluster(clId) {
    const c = this.clusters.get(clId);
    if (!c) return null;
    const anchorId = c.anchor;
    const debris = c.nodes.map(id => {
      const n = this.nodes[id];
      return { x: n.x, y: n.y, z: n.z, tier: n.tier, col: n.col };
    });
    for (const id of [...c.nodes]) this._killNode(id);
    // Cutting foliage is a light touch: 50/50 it pushes a tiny twig nub
    // (2-4 voxels, then it stops) or just regrows the greenery.
    let regrow = null;
    const a = this.nodes[anchorId];
    if (a && !a.dead && a.tier === 3 && !this._tipOnNode(anchorId)) {
      if (this._chance(0.5)) {
        const dir = this._norm([a.dx * 0.4 + (this.rng.next() - 0.5),
                                a.dy * 0.4 + 0.9,
                                a.dz * 0.4 + (this.rng.next() - 0.5)]);
        this._spawnSeg(3, a.id, dir, this._ri(2, 4), 'nub', 2.0, a.seg);
        regrow = { kind: 'nub' };
      } else {
        const g = this._greenery(anchorId, this._ri(GREEN_SIZES[0], GREEN_SIZES[1]));
        regrow = { kind: 'greenery', size: g ? g.nodes.length : 0 };
      }
    }
    this.wildAcc = 0; // a pruned tree is awake
    return { removed: debris.length, debris, regrow, cluster: true };
  }

  _stumpPlan(p) {
    // A cut never kills: the parent becomes a tip with a fresh growth budget,
    // randomly larger or smaller than the tier default.
    const T = TIER[p.tier];
    const budget = Math.max(3, Math.round(T.cutBudget * (0.7 + this.rng.next() * 0.7)));
    const mode = p.tier === 1 ? 'grow' : (this._chance(0.5) ? 'continue' : 'advance');
    const dir = this._norm([p.dx * 0.4 + (this.rng.next() - 0.5),
                            p.dy * 0.4 + 0.9,
                            p.dz * 0.4 + (this.rng.next() - 0.5)]);
    const tip = this._spawnSeg(p.tier, p.id, dir, budget, mode, 3.0, p.seg);
    if (tip) {
      const s = this.segs.get(tip.segId);
      if (s) s.regrow = true; // regrown wood may later thicken its supports
    }
    return { tier: p.tier, budget, mode };
  }

  /* What cut(nodeId) would remove, without doing it — for the hold-to-trim
     preview glow. Returns null when nothing prunable is there. */
  previewCut(nodeId) {
    let node = this.nodes[nodeId];
    if (!node || node.dead) return null;
    if (node.girth) { nodeId = node.parent; node = this.nodes[nodeId]; }
    if (!node || node.dead) return null;
    if (node.tier === 4) {
      const c = this.clusters.get(node.cluster);
      if (!c) return null;
      return { sub: [...c.nodes] };
    }
    if (nodeId === 0) return null;
    return { sub: this._collectSubtree(nodeId) };
  }

  /* ---------- time ---------- */
  advance(dtMin) {
    if (dtMin <= 0) return 0;
    this.simMin += dtMin;
    let grown = 0;
    if (this.dormant) {
      this.wildAcc += dtMin;
      while (this.wildAcc >= WILD_MINUTES) {
        this.wildAcc -= WILD_MINUTES;
        this._wildShoot();
      }
      if (this.tips.size === 0) { this.acc = 0; return 0; } // truly resting
      // a wild shoot woke the tree: it gets this period's growth
    }
    this.wildAcc = 0;
    this.acc += this.rate * dtMin;
    let n = Math.floor(this.acc);
    this.acc -= n;
    n = Math.min(n, 2000); // per-call safety cap; remainder stays in acc
    for (let i = 0; i < n; i++) {
      if (this.growOne()) grown++;
      else if (this.dormant) break;
    }
    return grown;
  }

  _wildShoot() {
    if (this.voxels >= VOXEL_HARD_CAP || this.liveChain.length === 0) return;
    // A dormant tree's rare bud push ignores the per-node shoots cap —
    // once every couple of days, old wood is allowed one more bud.
    for (let tries = 0; tries < 40; tries++) {
      const nid = this._pick(this.liveChain);
      const n = this.nodes[nid];
      if (!n || n.dead || n.tier > 3) continue;
      if (n.tier === 3) {
        // a twig's "next tier" is foliage: a wild leaf puff
        this._greenery(nid, this._ri(8, 14));
        return;
      }
      const child = n.tier + 1;
      const T = TIER[child];
      const dir = n.tier === 1 ? this._outwardDir(20, 55)
        : this._upBias(this._perturb([n.dx, n.dy, n.dz], 0.6), 0.3);
      this._spawnSeg(child, nid, dir, this._ri(T.lenMin, T.lenMax), 'grow', 1.4, n.seg);
      return;
    }
  }

  /* Simulate dtMin minutes, recording every grown voxel in order
     (used for the catch-up replay when the user reopens the page). */
  fastForward(dtMin, record) {
    const events = [];
    if (dtMin <= 0) return { events, grown: 0 };
    this.simMin += dtMin;
    let n = Math.floor(this.rate * dtMin);
    n = Math.min(n, 60000);
    let grown = 0;
    for (let i = 0; i < n; i++) {
      if (this.dormant) {
        // dormant catch-up: occasional wild shoots over long absences
        this.wildAcc += dtMin / Math.max(1, n - i);
        while (this.wildAcc >= WILD_MINUTES) {
          this.wildAcc -= WILD_MINUTES;
          this._wildShoot();
        }
        if (this.tips.size === 0) break;
      }
      const e = this.growOne();
      if (e) {
        grown++;
        if (record) events.push(e);
      } else if (this.dormant && this.tips.size === 0) {
        break;
      }
    }
    return { events, grown };
  }

  /* ---------- persistence ---------- */
  save() {
    const f4 = v => Math.round(v * 1e4) / 1e4;
    return {
      v: 1, seed: this.seed, rngS: this.rng.get(), rate: this.rate,
      acc: this.acc, wildAcc: this.wildAcc, simMin: this.simMin,
      targets: this.targets, counts: this.counts,
      next: [this.nextNode, this.nextSeg, this.nextTip, this.nextCl],
      nodes: this.nodes.map(n => n
        ? [n.x, n.y, n.z, n.tier, n.parent, n.seg, n.segIdx, n.girth ? 1 : 0,
           n.cluster, f4(n.col), f4(n.dx), f4(n.dy), f4(n.dz), n.shoots]
        : 0),
      segs: [...this.segs.values()].map(s =>
        [s.id, s.tier, s.nodes, s.tipId, s.parentSeg, s.childSegs, s.girth,
         s.complete ? 1 : 0, s.budget0, s.regrow ? 1 : 0]),
      tips: [...this.tips.values()].map(t =>
        [t.id, t.nodeId, t.segId, t.tier, t.remaining, t.mode, t.priority,
         f4(t.dx), f4(t.dy), f4(t.dz)]),
      clusters: [...this.clusters.values()].map(c => [c.id, c.nodes, c.twigSeg, c.anchor])
    };
  }

  load(d) {
    this.seed = d.seed; this.rng.set(d.rngS);
    this.rate = d.rate; this.acc = d.acc; this.wildAcc = d.wildAcc || 0;
    this.simMin = d.simMin || 0;
    this.targets = d.targets; this.counts = d.counts;
    [this.nextNode, this.nextSeg, this.nextTip, this.nextCl] = d.next;
    this.nodes = []; this.occ = new Map();
    this.segs = new Map(); this.tips = new Map(); this.clusters = new Map();
    this.liveChain = []; this.chainPos = new Map();
    this.voxels = 0;
    d.nodes.forEach((a, id) => {
      if (!a) { this.nodes[id] = null; return; }
      const n = {
        id, x: a[0], y: a[1], z: a[2], tier: a[3], parent: a[4], children: [],
        seg: a[5], segIdx: a[6], girth: a[7] === 1, cluster: a[8],
        col: a[9], dx: a[10], dy: a[11], dz: a[12], shoots: a[13] || 0, dead: false
      };
      this.nodes[id] = n;
      this.occ.set(this._key(n.x, n.y, n.z), id);
      if (!n.girth && n.tier < 4 && n.cluster < 0) {
        this.chainPos.set(id, this.liveChain.length);
        this.liveChain.push(id);
      }
      this.voxels++;
    });
    for (const n of this.nodes) {
      if (n && n.parent != null && n.parent >= 0) {
        const p = this.nodes[n.parent];
        if (p) p.children.push(n.id);
      }
    }
    for (const a of d.segs) {
      this.segs.set(a[0], {
        id: a[0], tier: a[1], nodes: a[2], tipId: a[3], parentSeg: a[4],
        childSegs: a[5], girth: a[6], complete: a[7] === 1, budget0: a[8],
        regrow: a[9] === 1
      });
    }
    for (const a of d.tips) {
      const n = this.nodes[a[1]];
      this.tips.set(a[0], {
        id: a[0], nodeId: a[1], segId: a[2], tier: a[3], remaining: a[4],
        mode: a[5], priority: a[6], arcDeg: TIER[a[3]].arcDeg,
        px: n ? n.x : 0, py: n ? n.y : 0, pz: n ? n.z : 0,
        dx: a[7], dy: a[8], dz: a[9]
      });
    }
    for (const a of d.clusters) {
      this.clusters.set(a[0], { id: a[0], nodes: a[1], twigSeg: a[2], anchor: a[3] });
    }
  }

  /* ---------- introspection (debug/tests) ---------- */
  stats() {
    let apex = 0, spread = 0;
    for (const n of this.nodes) {
      if (!n || n.dead) continue;
      if (n.y > apex) apex = n.y;
      const r = Math.hypot(n.x, n.z);
      if (r > spread) spread = r;
    }
    return {
      voxels: this.voxels, apex, spread: Math.round(spread * 10) / 10,
      tips: this.tips.size, dormant: this.dormant,
      s1: this.counts.s1, s2: this.counts.s2, s3: this.counts.s3, cl: this.counts.cl,
      t2: this.targets.s2, t3: this.targets.s3, tCl: this.targets.cl,
      segs: this.segs.size, clusters: this.clusters.size, rate: this.rate
    };
  }

  liveNodes() {
    const out = [];
    for (const n of this.nodes) if (n && !n.dead) out.push(n);
    return out;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Sim, TIER, makeRng, ROOT, VOXEL_HARD_CAP, BOUND_R, BOUND_TOP };
} else if (typeof window !== 'undefined') {
  window.BonsaiSim = { Sim, TIER, makeRng, ROOT, VOXEL_HARD_CAP, BOUND_R, BOUND_TOP };
}
