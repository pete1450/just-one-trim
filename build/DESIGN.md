# Bonsai — procedural voxel tree simulator: growth design

Base: the Floating Pagoda island code (`~/workspace/pagoda-island/build/`).
Everything is removed except the island ground itself (uniform grass top,
dirt/stone strata, rocky underside — no pond, paths, zen garden, pagoda,
islets, clouds, tools). A small soil mound at the island center is the
planting spot. Voxel size is unchanged (VS = 0.5 world units).

Scale: the pagoda spire topped out at voxel y=77. The mature bonsai's apex
lands a little above that (~80–86 voxels) — the tree replaces the pagoda as
the island's centerpiece, so it keeps the same visual presence.

## 1. Data model

A tree is a graph of voxel **nodes**. Every node knows its parent (toward the
trunk); cutting a node removes its whole subtree — exactly "the part of the
branch that was away from the trunk".

```
node: { id, x,y,z, tier 1..4, parent, children[],
        seg (segment id), girth bool, cluster (greenery cluster id),
        colSeed }
tip:  { nodeId (current end), segId, pos[3] float, dir[3] float unit,
        remaining, mode: 'grow'|'continue'|'advance', priority }
segment: { id, tier, nodes[] (chain order), tipId or -1,
           budget0, parentSeg, childSegs[], girthLevel, complete }
cluster: { id, nodes[], twigSeg, anchorNode }
```

- **Tier 1** trunk — thickest. **Tier 2** branch. **Tier 3** twig — thinnest
  wood. **Tier 4** greenery — leaf blobs, terminal, never grow further.
- A **segment** is one unbroken run of same-tier wood: trunk = 1 segment,
  each branch = 1 segment, etc. Segments are the "elements" the tree counts
  toward its targets.
- **Tips** are the only places growth happens. A growth event = one voxel
  added at one tip. Growth currency is *voxels per minute* (slider).

## 2. Tier parameters (tuned constants, all tunable in one table)

| tier | len range | seg target/tree | forkP /voxel | girthMax | cut budget default |
|------|-----------|-----------------|--------------|----------|--------------------|
| 1 trunk  | 58–68 | 1        | 0.004 | 3 | 16 |
| 2 branch | 18–28 | 8–11     | 0.015 | 2 | 12 |
| 3 twig   | 9–14  | 30–46    | 0.040 | 1 | 8  |
| 4 green  | cluster 5–9 voxels | 80–120 clusters | — | — | — |

- `len range`: random target length each new segment grows to before it
  transitions. ("each tier has a random length between a range")
- `seg target`: per-tree fixed at seeding; the tree *tries to reach* these
  counts. Forks, shoots and transitions may overshoot to a hard cap of
  1.35× target — never runaway.
- `forkP`: lateral same-tier fork chance per grown voxel. Deliberately
  tiny at tier 1 (a trunk fork is a rare event, ~1 in 8 trees), freer at
  higher tiers. ("more limited at tier 1, allowed more at higher tiers")
- `girthMax`: cross-section size. Trunk can reach 3×3, branches 2×2,
  twigs stay single-voxel.

## 3. Growth (one voxel per event)

1. If no live tips → dormant (see §6). Otherwise pick a tip, weighted by
   `priority × (0.7 + 0.6·rand)`. Priorities: fresh cut stump 3.0, young
   segment 1.5, default 1.0, trunk leader ×1.3 (apical dominance).
2. Advance the tip's float position by its unit `dir`; voxel = rounded pos.
   - **Wander**: `dir` is perturbed by random noise each step (0.30).
   - **Phototropism**: `dir` is blended toward up — 0.10 (trunk, stays
     columnar), 0.16 (branch), 0.22 (twig, reaches for light).
   - **Collision**: occupied cell → try up to 6 jittered dirs; all fail →
     tip retires (rare).
   - **Bounds**: cylinder radius 34, y ≤ 90. Out-of-bounds → steer inward;
     still out → tip retires.
3. Stamp the voxel (tier = tip tier, color jittered per tier palette).
4. `remaining--`. On fork roll (`forkP`): spawn a **lateral segment** — same
   tier, new tip at the current voxel, direction rotated 35–70° away,
   biased outward and up, budget 0.75× tier range. Forks never consume the
   voxel; the lateral tip joins the pool and grows on later events.
5. **Wild shoot roll** (`shootP` = 0.012, or 0.004 once the child tier is at
   target): pick a random chain node of tier t<3 and start a tier t+1
   segment mid-limb. This is the "even when not cut, a low chance for the
   next tier to shoot off" behavior — interior back-budding.
6. **Segment completion** (`remaining == 0`):
   - Segment marked complete; **girth +1** on it (the rule: *once the next
     tier starts, the tier it grew from gains girth*).
   - Tier 1→2, 2→3: spawn the child segment at the tip (direction
     continues, up-biased). Trunk completion spawns the upward **leader**.
     If the child tier is at hard cap, the tip just retires.
   - Tier 3: the tip becomes a **greenery cluster** (5–9 voxel random-walk
     blob around the tip) and retires.
   - Plus: every new twig voxel has a 12% chance to sprout a small interior
     cluster (2–4 voxels) — foliage isn't only at twig ends.

### Girth (secondary growth)

`girthLevel` 1 → single chain; 2 → 2×2 cross-section along the segment;
3 → 3×3. Added as `girth` voxels parented to their chain voxel (so pruning
above/below carries them correctly — they're children in the graph, never
tips). Girth is gained when (a) the segment spawns its first child-tier
segment, (b) the segment completes. Old trunks end up 3×3 at the base —
the classic aged-bonsai look — while twigs never thicken.

## 4. Pruning (tap to cut)

- Tap (not drag) raycasts the tree's instanced mesh → node id.
- Girth voxels resolve to their chain voxel; greenery voxels resolve to
  their whole cluster. The single root voxel is uncuttable (the tree can
  never be killed at the base).
- The tapped node **and its entire subtree** are removed: chain, girth,
  greenery. Removed voxels become **debris** — they tumble with gravity,
  land on the island, and shrink-fade away over ~2.5 s.
- The surviving parent (always tier 1–3 wood) becomes a **stump tip** with
  a fresh **growth budget**: `round(defaultBudget × (0.7 + 0.7·rand))` —
  randomly larger or smaller than the default, exactly as specified.
  The stump also flips a coin for what happens when the budget runs out:
  - cut twig → 50% grow more twig, 50% go straight to greenery;
  - cut branch → 50% grow more branch, 50% transition into twig
    (which later becomes greenery);
  - cut trunk → regrow the leader (the tree refuses to die).
- Stump priority 3.0: wound response grows first. New direction = parent
  direction blended strongly upward with random spread.
- Cutting also drops the tier counts below target, so the tree's
  target-seeking (§6) joins the regrowth — shaping by pruning works
  because the tree *wants* its branches back, but on the player's terms.

## 5. Nothing ever dies

Every cut leaves a living stump with a plan. Cutting every branch off
leaves a trunk full of buds; cutting the trunk leaves a stump that pushes
a new leader. There is no death state — only regrowth, redirected.

## 6. Steady state (the tree rests)

The tree is **dormant** when: no live tips remain **and** every tier is at
or above its target count **and** greenery clusters are at target. A
dormant tree consumes its growth accumulator silently (time still passes,
nothing piles up).

Even dormant, each growth event rolls a tiny **wild-shoot** chance
(0.003): a tree may, over days, push one new shoot somewhere — old trees
keep a little life. Total live voxels are hard-capped (~5200) so this can
never run away.

Pruning wakes the tree immediately (new stump tip + below-target counts).

## 7. Time, persistence, catch-up

- Growth rate: UI slider, **voxels per minute**, log scale 0.2 → 600,
  default 3. Slow = a patient, realistic tree; fast = watch it reshape
  live for testing.
- `advance(dtMinutes)`: accumulator += rate·dt; whole voxels become growth
  events (capped per frame; remainder carries).
- Saved to `localStorage` (`bonsai.v1`): seed, PRNG state, all nodes /
  segments / tips / clusters (compact arrays), counts, targets,
  accumulator, slider rate, `lastTime`. Autosave every 5 s + on hide/unload.
- **Catch-up**: on load, `elapsed = now − lastTime`; simulate
  `elapsed × savedRate` voxels (capped 60k iterations; steady state stops
  it far earlier). Every added voxel is recorded in order, then **replayed
  visually over ~6–10 s** — the user watches the night's growth happen
  fast, then the tree settles back to the live rate. A small
  "catching up…" note shows during replay.
- The sim is deterministic given (seed, rngState): same state + same
  events → same tree. `logic.js` has zero DOM/THREE dependencies so the
  whole model is unit-testable in node.

## 8. Rendering & interaction (scene.js)

- Static island baked once (instanced per color, as in pagoda).
- Tree: **one** `InstancedMesh` (cap 4096) with per-instance color,
  rebuilt when dirty. `instanceId → nodeId` map for tap raycasting.
- Debris: separate `InstancedMesh` (cap 512), simple ballistic physics,
  land → shrink-fade.
- Cut feedback: expanding pale ring at the cut + soft wooden "snip".
- Camera: orbit only (no walk mode — it's a desktop tree), target y≈16,
  idle slow drift. Tap = prune; drag = orbit; wheel/pinch = zoom.
- UI: title pill with live status (`growing…` / `resting — prune to wake
  it` / `catching up…`); bottom pill with growth slider (slower↔faster,
  no numbers), 🌱 new-tree (two-tap confirm), ❓ help (collapsible,
  plain language, no numbers — feel only), 🔊 ambient toggle (kept from
  pagoda).
- `window.__bonsai` debug hooks: sim handle, `cutAt(nodeId)`,
  `step(n)`, state snapshots — for headless verification.

## 9. Open tuning notes (final model, 2026-10-17)

- Direction model per growth step: perturb (wander) → **arc** (true rotation
  pitching the heading toward horizontal by `arcDeg`: T1 0°, T2 1.5°,
  T3 0.9°) → **minClimb** floor (phototropism: T1 0.60, T2 0.25, T3 0.15 —
  a floor, not a magnet) → trunk leash (steers back if |x,z| > 10).
  Lesson learned: a scale-then-renormalize "arc" does nothing (the norm
  restores verticality); an additive up-bias compounds until every tip is
  vertical and the apex pins to the ceiling. Rotation + floor is stable.
- Handoffs bend: tier2→tier3 child arcs 20–45° off the parent heading
  (`_handoffDir`); the trunk→leader handoff stays vertical (upBias 0.35).
- Final shape over 10 seeds: apex 72–90, mean ~80 (pagoda spire was 77);
  ~2000 voxels mature; canopy spread ~35 (wood ≤34, foliage overhang ≤38).
- If the mature tree reads too sparse/dense, tune `seg target` ranges and
  `len` ranges first — they control silhouette most.
- If regrowth after pruning feels sluggish, raise stump priority or cut
  budgets; if it explodes, lower `forkP` at the cut tier.
- Wild shoots on a dormant tree are time-based (one per ~2500 min), not
  event-based — event-based would give ~13 shoots/day at default rate.

## 10. Verification fixes (2026-10-17, headless Chromium)

- **White debris bug**: three.js r147 bakes `USE_INSTANCING_COLOR` into the
  compiled program at first render. The debris mesh first rendered with
  `instanceColor = null` (no debris yet); adding colors later via
  `setColorAt` wrote a correct buffer that the shader ignored → white
  cubes. Fix: `debrisMesh.setColorAt(0, white)` once at creation so the
  buffer exists before first render (the tree never hit this because
  `rebuildTree` runs before its first render).
- **Dormant `advance()` never grew wild shoots**: the dormant branch
  returned 0 immediately after spawning. Now, if tips exist after the
  wild-shoot pass, it falls through and grows them with that period's time.
- **`_wildShoot` starved on mature trees**: every chain node had
  `shoots >= 3`, so the 8-try loop found nothing. Wild shoots (once per
  ~2 days) now ignore the per-node shoots cap; tries raised to 40.
- **Crown density** (screenshot verdict "sparse/scraggly"): `GREEN_SIZES`
  [5,9]→[7,12], `SPROUT_SIZES` [2,4]→[3,6], `SPROUT_P` 0.12→0.16,
  `SHOOT_P[2]` 0.012→0.02. Mature ~2150 voxels, apex mean 81 (72–90).
- Headless-test notes: SwiftShader runs rAF at ~0.25 fps and `dt` clamps
  at 0.05, so debris physics looks frozen between screenshots — a test
  artifact, not a bug. CDP `Input.dispatchMouseEvent` round-trips are
  slow; keep press/release back-to-back or the 500 ms tap window expires
  (synthetic PointerEvents proved tap-to-prune cuts correctly).
  `beforeunload` → `saveNow()` correctly overwrites a faked `lastTime`;
  test reload catch-up via a `localStorage.setItem` wrapper or by calling
  the debug `fastForward(minutes)` directly.
- **Greenery 3× (user request 2026-10-17)**: `GREEN_SIZES` [7,12]→[30,48],
  `SPROUT_SIZES` [3,6]→[12,20], `SPROUT_P` 0.16→0.28, cluster anchor
  radius 3.5→5, attempts size×6→size×10, `targets.cl` [80,120]→[130,180].
  Measured over 10 seeds: greenery ~3410 voxels (was ~1150), total ~4900
  (max 5264). `VOXEL_HARD_CAP` 5200→7000 and renderer `TREE_CAP`
  4096→8192 raised to match. Apex mean 82.7 — silhouette unchanged.

## 11. Trimming rework (2026-10-17, user round 3)

- **Greenery cuts are a light touch now**: 50/50 the twig pushes a tiny
  2–4 voxel nub (`'nub'` tip mode: no sprouts, no forks, no greenery cap
  on completion — it just stops) or the foliage puff simply regrows in
  place. No more full branch regrowth from a leaf trim.
- **Regrow supports itself**: segments spawned from a cut (`regrow` flag,
  propagated through `'continue'` chains, persisted in saves) roll for
  ancestral girth when they complete with ≥6 nodes — nearest lower tier
  50%, next 25%. `_addGirth` enforces `girthMax`, so supports never
  thicken without bound.
- **Hold-to-trim UI**: tap replaced by press-and-hold 1s. On press,
  `previewCut()` computes the would-be-removed subtree (no mutation);
  those voxels glow overbright white and a transparent white ring dial
  charges at the fingertip. Moving >10px, second finger, or early release
  cancels; a full second executes the cut. Prevents accidental trims.
