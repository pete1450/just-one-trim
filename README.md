# Just One Trim — a bonsai that grows while you're away
<img height="700" alt="image" src="https://github.com/user-attachments/assets/5f8e5088-f9ba-44aa-95b9-fc8902fab3bf" />

A relaxing procedural bonsai simulator in a **single HTML file** (`index.html`).
Three.js r147 is inlined, so the game runs offline with no build step at
runtime — open the file (or the GitHub Pages URL) and tend your tree.

Your tree is a living voxel sculpture on a little floating island. It grows on
its own in real time, remembers the time between your visits, and catches you
up on everything that happened while you were gone. You shape it with a
single gesture: **press and hold a branch to trim it** — and nothing here can
ever die, so prune boldly.

## Gameplay

- **It grows by itself.** Trunk, branches, twigs, and foliage each grow to
  their own natural size, fork at random, and thicken as they hand off to the
  next tier. Left alone, a tree settles into a steady, mature state.
- **Press and hold to trim.** Touch a branch and hold for a second: a ring
  charges at your fingertip while everything that would be cut glows white.
  Release early (or drag away) and nothing happens — no accidental snips.
  The cut piece tumbles to the ground and fades.
- **Nothing ever dies.** A trimmed branch heals over and pushes out fresh
  growth on a randomized budget — sometimes a whole new limb, sometimes just
  a twig. Snipped foliage either sprouts a tiny twig nub or simply leafs
  back out. Regrown wood gives the branches below it a chance to thicken up
  in support.
- **It lives while you're away.** The game saves to your browser and, when
  you return, fast-forwards the elapsed time and replays the growth for you
  to watch.
- **Growth slider.** From a slow, patient tree (a new voxel every few
  minutes) to wild (a whole tree in minutes) for shaping and testing.

   <img width="490" height="402" alt="image" src="https://github.com/user-attachments/assets/ddddead7-a4bc-4b86-ba2d-287d6ec7dbd6" /><img width="596" height="463" alt="image" src="https://github.com/user-attachments/assets/bb3daea2-a76e-4af7-b039-d2c72a2e65b5" />



## Controls

| Input | Action |
|---|---|
| press & hold a branch (1s) | trim it there (ring charges, piece glows white) |
| release early / drag away | cancel the trim |
| drag | orbit the camera |
| pinch / wheel | zoom |
| 🌱 Bonsai (top-left) | open the menu |
| growth slider | pace of life, from slow to wild |
| 🌱 (in menu) | start over with a new seedling (tap twice to confirm) |
| 🔊/🔇 (in menu) | ambient sound on/off |
| ? (in menu) | how-to card |

## Your own music

Drop audio files (`.mp3`, `.ogg`, `.wav`, `.m4a`, …) into `build/music/` and
they play in **random order** while you tend your tree, replacing the built-in
generative hum. When the queue ends it reshuffles and starts over. If the
folder is empty, the game falls back to its generative ambient sound. See
`build/music/README.md`.

## Files

| File | What it is |
|---|---|
| `index.html` | the playable game (built by CI — don't edit by hand) |
| `music/` | your audio files + `playlist.json` (built by CI from `build/music/`) |
| `build/head.html` | HTML shell: menu, help card, CSS |
| `build/three.min.js` | three.js r147, inlined into the final page |
| `build/logic.js` | pure simulation: growth, pruning, persistence (no DOM) |
| `build/scene.js` | renderer, camera, hold-to-trim UI, audio |
| `build/build.py` | assembles the single-file `index.html` (+ copies `music/`) |
| `build/test_logic.js` | unit tests for the simulation (`node build/test_logic.js`) |
| `build/DESIGN.md` | design notes and tuning history |
| `build/music/` | drop your audio files here |

## Build & test locally

```bash
node build/test_logic.js        # unit tests (must all pass)
python3 build/build.py          # writes index.html next to the script
python3 build/build.py out.html # ...or to a path you choose
```

## CI / GitHub Pages

`.github/workflows/build.yml` runs on every push to `main`: it syntax-checks
the JS, runs the node tests, builds the single-file `index.html` (plus
`music/`), and commits them to the repo root so GitHub Pages can serve the
game. The bot's own build commits carry `[skip ci]` and don't retrigger the
workflow.

To publish: Settings → Pages → Deploy from branch → `main` / root. The game
is then live at `https://<you>.github.io/just-one-trim/`.

## Tech

- three.js r147 (inlined, no CDN at runtime)
- Seeded procedural growth (`logic.js` is DOM-free and deterministic)
- localStorage persistence with catch-up fast-forward
- WebAudio: generative ambient + pruning snip, or your `music/` folder
