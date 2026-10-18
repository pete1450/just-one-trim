# music/

Drop your own audio files here (`.mp3`, `.ogg`, `.wav`, `.m4a`, …) and they
will play in **random order** while you tend your tree, replacing the
built-in generative hum. When the queue runs out it reshuffles and starts
over.

How it works:

- `python3 build.py` copies every audio file found here next to the built
  `index.html` (into `music/`) and writes `music/playlist.json` listing them.
- The game fetches `music/playlist.json` on load. If it lists tracks, those
  play (shuffled); if the folder is empty or the file is missing, the game
  falls back to its generative ambient sound.
- The 🔊/🔇 button in the menu mutes whichever is playing.
- Files are served as `music/<name>` — keep names simple (no spaces is safest).

Note: audio files ship with the game, so they count toward the repo/page
size. A few compressed `.mp3`/`.ogg` files are ideal.
