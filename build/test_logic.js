/* node tests for the bonsai growth sim (logic.js). Run: node test_logic.js */
'use strict';
const { Sim, TIER, ROOT, VOXEL_HARD_CAP, BOUND_R, BOUND_TOP } = require('./logic.js');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('FAIL:', name, extra || ''); }
}
function growUntil(sim, maxCalls) {
  let calls = 0;
  while (!sim.dormant && calls < maxCalls) { sim.growOne(); calls++; }
  return calls;
}
function mature(seed) {
  const sim = new Sim(seed);
  const calls = growUntil(sim, 40000);
  return { sim, calls };
}

console.log('--- 1: seed grows a trunk upward ---');
{
  const sim = new Sim(1234);
  for (let i = 0; i < 70; i++) sim.growOne();
  const st = sim.stats();
  ok(st.voxels >= 70, 'trunk voxels after 70 grows', JSON.stringify(st));
  ok(st.s1 === 1, 'single trunk segment', 's1=' + st.s1);
  ok(st.apex >= 60, 'trunk reaches upward', 'apex=' + st.apex);
  const top = sim.liveNodes().filter(n => n.tier === 1).sort((a, b) => b.y - a.y)[0];
  ok(Math.hypot(top.x, top.z) < 15, 'trunk stays near center', JSON.stringify([top.x, top.z]));
}

console.log('--- 2: full growth reaches steady state ---');
{
  const { sim, calls } = mature(42);
  const st = sim.stats();
  ok(sim.dormant, 'tree goes dormant', JSON.stringify(st));
  ok(calls < 40000, 'dormancy reached in bounded calls', 'calls=' + calls);
  ok(st.s2 >= st.t2, 'branch target met', `s2=${st.s2} t2=${st.t2}`);
  ok(st.s3 >= st.t3, 'twig target met', `s3=${st.s3} t3=${st.t3}`);
  ok(st.cl >= st.tCl, 'greenery target met', `cl=${st.cl} tCl=${st.tCl}`);
  ok(st.voxels < VOXEL_HARD_CAP, 'under hard cap', 'voxels=' + st.voxels);
  ok(st.voxels > 800, 'substantial tree', 'voxels=' + st.voxels);
  ok(st.apex >= 78, 'taller than the pagoda (77)', 'apex=' + st.apex);
  ok(st.apex <= 92, 'apex within bounds', 'apex=' + st.apex);
  ok(st.spread <= 38, 'canopy within island (foliage may overhang wood)', 'spread=' + st.spread);
}

console.log('--- 3: tier transitions produce greenery on twigs ---');
{
  const { sim } = mature(7);
  ok(sim.clusters.size > 0, 'greenery clusters exist');
  let bad = 0;
  for (const c of sim.clusters.values()) {
    const a = sim.nodes[c.anchor];
    if (!a || a.dead || a.tier !== 3) bad++;
  }
  ok(bad === 0, 'all clusters anchor on twigs', 'bad=' + bad);
}

console.log('--- 4: girth — trunk thickens once branches exist ---');
{
  const { sim } = mature(99);
  const trunkSeg = [...sim.segs.values()].find(s => s.tier === 1);
  ok(trunkSeg && trunkSeg.girth === 3, 'trunk reaches 3x3 girth', 'girth=' + (trunkSeg && trunkSeg.girth));
  // base cross-section: several tier-1 voxels near y=5
  const base = sim.liveNodes().filter(n => n.tier === 1 && n.y >= 4 && n.y <= 6 &&
    Math.abs(n.x) <= 1 && Math.abs(n.z) <= 1);
  ok(base.length >= 6, 'thick trunk base', 'base voxels=' + base.length);
  const twigSeg = [...sim.segs.values()].find(s => s.tier === 3);
  ok(twigSeg && twigSeg.girth === 1, 'twigs never thicken', 'girth=' + (twigSeg && twigSeg.girth));
}

console.log('--- 5: forking is limited at tier 1, freer higher up ---');
{
  let s1max = 0, okOrder = true;
  for (const seed of [1, 2, 3, 4, 5]) {
    const { sim } = mature(seed);
    s1max = Math.max(s1max, sim.counts.s1);
    if (!(sim.counts.s3 >= sim.counts.s2)) okOrder = false;
  }
  ok(s1max <= 3, 'trunk forks are rare', 'max s1=' + s1max);
  ok(okOrder, 'more twig segments than branch segments');
}

console.log('--- 6: cutting a branch removes the distal part, stump regrows ---');
{
  const { sim } = mature(2024);
  const before = sim.stats();
  // pick a mid-branch tier-2 chain node that has children (distal part exists)
  const cand = sim.liveNodes().filter(n => n.tier === 2 && !n.girth &&
    n.children.some(c => { const cn = sim.nodes[c]; return cn && !cn.dead && !cn.girth; }));
  ok(cand.length > 0, 'found a mid-branch node to cut');
  const target = cand[Math.floor(cand.length / 2)];
  const res = sim.cut(target.id);
  ok(res && !res.rejected, 'cut accepted');
  ok(res.removed >= 4, 'distal part removed', 'removed=' + res.removed);
  ok(res.debris.length === res.removed, 'debris matches removed');
  ok(res.stump && res.stump.tier === 2, 'tier-2 stump planned', JSON.stringify(res.stump));
  ok(res.stump.budget >= 8 && res.stump.budget <= 17,
    'budget randomly around default 12', 'budget=' + res.stump.budget);
  ok(['continue', 'advance'].includes(res.stump.mode), 'stump mode is continue|advance');
  ok(!sim.dormant, 'cut wakes the tree');
  const v0 = sim.stats().voxels;
  sim.rate = 600;
  sim.advance(30); // 30 min at test speed
  const v1 = sim.stats().voxels;
  ok(v1 > v0, 'stump regrew wood', `v0=${v0} v1=${v1}`);
}

console.log('--- 7: nothing ever dies ---');
{
  const { sim } = mature(555);
  ok(sim.cut(0).rejected === 'root', 'root voxel cannot be cut');
  // sever every branch at its base, one by one
  const trunkKids = [...sim.nodes[0].children]; // not used directly; find tier2 bases below
  let cuts = 0;
  for (let round = 0; round < 40; round++) {
    const base = sim.liveNodes().find(n => n.tier === 2 && !n.girth &&
      sim.nodes[n.parent] && sim.nodes[n.parent].tier === 1);
    if (!base) break;
    sim.cut(base.id);
    cuts++;
  }
  ok(cuts > 0, 'branches were cut', 'cuts=' + cuts);
  ok(sim.nodes[0] && !sim.nodes[0].dead, 'root survives everything');
  ok(sim.stats().voxels >= 1, 'tree never vanishes');
  sim.rate = 600;
  sim.advance(120);
  ok(sim.tips.size > 0 || sim.stats().voxels > 60, 'tree pushes regrowth', JSON.stringify(sim.stats()));
}

console.log('--- 8: twig-end cuts regrow as twig OR greenery ---');
{
  const modes = new Set();
  let foliageRegrew = 0, trials = 0;
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    const { sim } = mature(seed);
    // twig end = tier-3 chain node with no chain children
    const end = sim.liveNodes().find(n => n.tier === 3 && !n.girth &&
      !n.children.some(c => { const cn = sim.nodes[c]; return cn && !cn.dead && !cn.girth && cn.tier === 3; }));
    if (!end) continue;
    trials++;
    const clBefore = sim.stats().cl;
    const res = sim.cut(end.id);
    if (res.stump) modes.add(res.stump.mode);
    sim.rate = 600;
    growUntil(sim, 20000);
    if (sim.stats().cl >= clBefore) foliageRegrew++;
  }
  ok(trials >= 4, 'enough twig-end trials', 'trials=' + trials);
  ok(modes.has('continue') && modes.has('advance'), 'both regrow modes occur', [...modes].join(','));
  ok(foliageRegrew === trials, 'foliage always comes back', `${foliageRegrew}/${trials}`);
}

console.log('--- 9: save/load round-trip is deterministic ---');
{
  const a = new Sim(777);
  for (let i = 0; i < 500; i++) a.growOne();
  const snap = a.save();
  const b = new Sim(1);
  b.load(JSON.parse(JSON.stringify(snap)));
  const sa = a.stats(), sb = b.stats();
  ok(sa.voxels === sb.voxels && sa.s2 === sb.s2 && sa.s3 === sb.s3 && sa.cl === sb.cl &&
     sa.tips === sb.tips, 'state identical after load', JSON.stringify([sa, sb]));
  for (let i = 0; i < 200; i++) { a.growOne(); b.growOne(); }
  const sa2 = a.stats(), sb2 = b.stats();
  ok(sa2.voxels === sb2.voxels && sa2.apex === sb2.apex, 'deterministic after load',
     JSON.stringify([sa2, sb2]));
}

console.log('--- 10: catch-up fast-forward matches incremental growth ---');
{
  const rate = 3, mins = 60;
  const a = new Sim(31337); a.rate = rate;
  const ff = a.fastForward(mins, true);
  const b = new Sim(31337); b.rate = rate;
  for (let m = 0; m < mins; m++) b.advance(1);
  const sa = a.stats(), sb = b.stats();
  ok(sa.voxels === sb.voxels && sa.apex === sb.apex && sa.s2 === sb.s2,
    'fast-forward == incremental', JSON.stringify([sa, sb]));
  ok(ff.events.length === ff.grown && ff.grown > 0, 'events recorded', 'grown=' + ff.grown);
  ok(ff.events.every(e => e.tier >= 1 && e.tier <= 4), 'recorded events sane');
}

console.log('--- 11: growth rate math ---');
{
  const sim = new Sim(9);
  sim.rate = 60;
  const grown = sim.advance(1);
  ok(grown === 60, '60 voxels/min for 1 min => 60 voxels', 'grown=' + grown);
  const sim2 = new Sim(9);
  sim2.rate = 0.5;
  const grown2 = sim2.advance(10); // 5 voxels over 10 min
  ok(grown2 === 5, 'fractional accumulator works', 'grown=' + grown2);
}

console.log('--- 12: all voxels inside bounds ---');
{
  const { sim } = mature(2718);
  let bad = 0;
  for (const n of sim.liveNodes()) {
    // wood stays inside 34; foliage/girth may overhang to 38
    if (Math.hypot(n.x, n.z) > 38 + 1e-6 || n.y > BOUND_TOP || n.y < 1) bad++;
  }
  ok(bad === 0, 'bounds respected', 'bad=' + bad);
}

console.log('--- 13: dormant tree truly rests, wild shoots are rare ---');
{
  const { sim } = mature(314);
  const v0 = sim.stats().voxels;
  sim.rate = 600;
  sim.advance(60); // wildAcc 60 < 2500 -> no shoots
  ok(sim.stats().voxels === v0, 'no growth while dormant (short absence)');
  sim.wildAcc = 2499;
  const v1 = sim.stats().voxels;
  sim.advance(2); // 1200 growth events: the shoot grows out and finishes
  ok(sim.stats().voxels > v1, 'a wild shoot eventually appears and grows', 
     `v0=${v0} v1=${v1} v2=${sim.stats().voxels}`);
}

console.log('--- 14: cutting greenery removes the cluster voxels, twig survives ---');
{
  const { sim } = mature(808);
  const leaf = sim.liveNodes().find(n => n.tier === 4);
  ok(!!leaf, 'found a leaf voxel');
  const anchorId = sim.clusters.get(leaf.cluster).anchor;
  const res = sim.cut(leaf.id);
  ok(res.cluster === true, 'resolved as cluster cut');
  ok(res.removed >= 1, 'cluster voxels removed as debris', 'removed=' + res.removed);
  ok(sim.nodes[anchorId] && !sim.nodes[anchorId].dead, 'twig anchor survives');
  // 50/50: a tiny nub tip OR the greenery regrows in place
  ok(res.regrow && (res.regrow.kind === 'nub' || res.regrow.kind === 'greenery'),
     'regrow plan kind', res.regrow && res.regrow.kind);
}

console.log('--- 15: cutting a girth voxel cuts the wood beneath ---');
{
  const { sim } = mature(909);
  const g = sim.liveNodes().find(n => n.girth && n.parent !== 0);
  ok(!!g, 'found a girth voxel (not on the root)');
  const parentTier = sim.nodes[g.parent].tier;
  const res = sim.cut(g.id);
  ok(res && res.removed >= 2, 'chain cut happened through girth', 'removed=' + (res && res.removed));
  ok(res.stump && res.stump.tier === parentTier, 'stump at parent tier');
}

console.log('--- 16: heavy pruning cannot break the sim ---');
{
  const sim = new Sim(4242);
  sim.rate = 600;
  for (let round = 0; round < 12; round++) {
    sim.advance(20);
    const victim = sim.liveNodes().find(n => n.id !== 0 && n.tier >= 2 && !n.girth);
    if (victim) sim.cut(victim.id);
  }
  const st = sim.stats();
  ok(st.voxels >= 1 && st.voxels < VOXEL_HARD_CAP, 'voxel count sane', 'voxels=' + st.voxels);
  ok(sim.nodes[0] && !sim.nodes[0].dead, 'root alive');
  // and it can still reach a resting state afterwards
  growUntil(sim, 40000);
  ok(sim.stats().voxels < VOXEL_HARD_CAP, 'recovers within caps');
}

console.log('--- 17: greenery cut -> tiny nub OR greenery regrow (50/50) ---');
{
  let nub = 0, green = 0, trials = 0;
  for (const seed of [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) {
    const { sim } = mature(seed);
    const leaf = sim.liveNodes().find(n => n.tier === 4);
    if (!leaf) continue;
    trials++;
    const clBefore = sim.stats().cl;
    const res = sim.cut(leaf.id);
    ok(res && res.cluster === true, 'cluster cut resolves', 'seed=' + seed);
    ok(res.regrow && (res.regrow.kind === 'nub' || res.regrow.kind === 'greenery'),
       'regrow plan is nub or greenery', 'seed=' + seed + ' kind=' + (res.regrow && res.regrow.kind));
    if (res.regrow.kind === 'nub') {
      nub++;
      const tips = [...sim.tips.values()].filter(t => t.mode === 'nub');
      ok(tips.length === 1, 'exactly one nub tip', 'seed=' + seed);
      ok(tips[0].remaining >= 2 && tips[0].remaining <= 4, 'nub budget tiny', 'remaining=' + tips[0].remaining);
      ok(sim.stats().cl === clBefore - 1, 'cluster stays gone for nub outcome');
    } else {
      green++;
      if (res.regrow.size > 0) {
        ok(sim.stats().cl === clBefore, 'greenery regrew in place of the cut', `cl=${sim.stats().cl} before=${clBefore}`);
      }
    }
  }
  ok(trials >= 8, 'enough greenery trials', 'trials=' + trials);
  ok(nub > 0 && green > 0, 'both outcomes occur', `nub=${nub} green=${green}`);
}

console.log('--- 18: nub tip completion just retires (no greenery cap, no fork) ---');
{
  const { sim } = mature(31337);
  const anchor = sim.liveNodes().find(n => n.tier === 3 && !n.girth);
  ok(!!anchor, 'found a twig anchor');
  const tip = sim._spawnSeg(3, anchor.id, [0, 1, 0], 3, 'nub', 2.0, anchor.seg);
  ok(!!tip && tip.mode === 'nub', 'nub tip spawned');
  const clBefore = sim.clusters.size, tipsBefore = sim.tips.size, segsBefore = sim.segs.size;
  sim._complete(tip);
  ok(sim.tips.size === tipsBefore - 1, 'nub tip retired and none spawned');
  ok(sim.clusters.size === clBefore, 'nub completion adds no greenery cap');
  ok(sim.segs.size === segsBefore, 'nub spawns no continuation segment');
}

console.log('--- 19: regrow completion gives lower tiers a girth chance (capped) ---');
{
  const trueRng = { next: () => 0, get: () => 0, set: () => {} };
  const falseRng = { next: () => 0.999999, get: () => 0, set: () => {} };
  const { sim } = mature(777);
  let child = null, parent = null;
  for (const s of sim.segs.values()) {
    if (s.tier === 2 && s.parentSeg >= 0) {
      const p = sim.segs.get(s.parentSeg);
      if (p && p.tier === 1) { child = s; parent = p; break; }
    }
  }
  ok(child && parent, 'found a branch under the trunk');
  // strip the trunk's girth voxels to simulate a thin support, reset its level
  // (a pruned tree keeps its girth *level* while losing the voxels)
  for (const n of sim.liveNodes()) {
    if (n.girth && n.seg === parent.id) sim._killNode(n.id);
  }
  parent.girth = 1;
  // below cap + chance hits -> thickens
  const v0 = sim.voxels;
  sim.rng = trueRng;
  sim._regrowGirth(child);
  ok(parent.girth === 2, 'parent gained a girth level', 'girth=' + parent.girth);
  ok(sim.voxels > v0, 'girth voxels added', `+${sim.voxels - v0}`);
  // chance misses -> nothing
  parent.girth = 1;
  const v1 = sim.voxels;
  sim.rng = falseRng;
  sim._regrowGirth(child);
  ok(parent.girth === 1 && sim.voxels === v1, 'no thickening when chance misses');
  // at girthMax -> never thickens, even when chance hits (no runaway)
  parent.girth = 3;
  const v2 = sim.voxels;
  sim.rng = trueRng;
  sim._regrowGirth(child);
  ok(parent.girth === 3 && sim.voxels === v2, 'girthMax caps regrow thickening');
}

console.log('--- 19b: _complete on a regrow stump rolls ancestral girth ---');
{
  const { sim } = mature(888);
  const target = sim.liveNodes().find(n => n.tier === 2 && !n.girth &&
    n.children.some(c => { const cn = sim.nodes[c]; return cn && !cn.dead && !cn.girth; }));
  ok(!!target, 'found a cuttable branch');
  const res = sim.cut(target.id);
  ok(res && res.stump, 'stump planned');
  const stumpTip = [...sim.tips.values()].find(t => t.nodeId === target.parent);
  ok(!!stumpTip, 'stump tip on the parent');
  const seg = sim.segs.get(stumpTip.segId);
  ok(seg && seg.regrow === true, 'stump segment flagged regrow');
  // grow the stump out without side effects, then complete it
  let guard = 0;
  while (sim.tips.has(stumpTip.id) && seg.nodes.length < 8 && guard++ < 500) {
    if (!sim._extend(stumpTip)) break;
  }
  let girthCalls = 0;
  const orig = sim._regrowGirth.bind(sim);
  sim._regrowGirth = (s) => { girthCalls++; return orig(s); };
  const nNodes = seg.nodes.length;
  sim._complete(stumpTip);
  if (nNodes >= 6) {
    ok(girthCalls === 1, 'regrow completion rolled ancestral girth', 'calls=' + girthCalls);
  } else {
    ok(girthCalls === 0, 'short regrow skips the girth roll', 'nodes=' + nNodes);
  }
}

console.log('--- 20: previewCut matches cut without mutating ---');
{
  const { sim } = mature(999);
  const target = sim.liveNodes().find(n => n.tier === 2 && !n.girth &&
    n.children.some(c => { const cn = sim.nodes[c]; return cn && !cn.dead && !cn.girth; }));
  ok(!!target, 'found a branch');
  const v0 = sim.stats().voxels;
  const prev = sim.previewCut(target.id);
  ok(prev && prev.sub.length > 1, 'preview returns the subtree', 'n=' + (prev && prev.sub.length));
  ok(prev.sub.includes(target.id), 'preview includes the tapped node');
  ok(sim.stats().voxels === v0, 'preview does not mutate', `voxels=${sim.stats().voxels}`);
  ok(sim.nodes[target.id] && !sim.nodes[target.id].dead, 'tapped node still alive');
  ok(sim.previewCut(0) === null, 'root is not prunable');
  ok(sim.previewCut(999999) === null, 'bogus id returns null');
  const leaf = sim.liveNodes().find(n => n.tier === 4);
  const clPrev = sim.previewCut(leaf.id);
  ok(clPrev && clPrev.sub.length >= 1, 'greenery preview returns its cluster');
  const g = sim.liveNodes().find(n => n.girth && n.parent !== 0);
  if (g) {
    const gp = sim.previewCut(g.id);
    const pp = sim.previewCut(g.parent);
    ok(gp && pp && gp.sub.length === pp.sub.length && gp.sub.includes(g.parent),
       'girth tap redirects to the parent wood');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('failures:\n - ' + failures.join('\n - ')); process.exit(1); }
