# Grandmaster Lab

An offline, touch-first chess sparring PWA for iPhone (Safari → Add to Home Screen) with three opponents:

| Persona | Engine | What it does |
|---|---|---|
| 🐇 **Patricia** | Patricia 5.1 by Adam Kulju, compiled to WebAssembly (SIMD) from source | Human-like, sacrificial play. Estimated Elo 800–3000, three playstyles. |
| 🐟 **Stockfish** | Stockfish 19 lite NNUE (stockfish.js) | The benchmark: live eval, mate scores, PV lines, eval bar. Optional Elo limit. |
| 🐡 **DrawFish** | Stockfish 19 + Trollfish's draw logic | Draws at all costs: repetitions, perpetuals, trades, fortresses, stalemate lines. |

Everything (engines, NNUE nets, opening books, piece art, sounds) is precached by a service worker. Once loaded, the app makes no network requests.

## How it plays

There are two layouts over the same game, engines and settings. Switch any time under **Lab → Layout** (Classic) or **Options → Layout** (SmallFish); the game in progress carries over.

### Classic (default)

* Persona card on top (avatar, live status, search depth, opening name), the board edge to edge with **your colour at the bottom**, a slim eval strip and a scrolling move strip under it.
* Tap the opponent card to shrink it to one slim line (tap again to expand, or Lab → Undo, redo & gestures → Compact opponent card): the board moves up and gets bigger on small phones.
* Pull-up sheet: `Back · Next · Flip · Undo · Hint · New · Lab`.
  * *Back* / *Next* step through the game (hold to repeat). While you look at an earlier position the engine waits; *Next* back to the end resumes.
  * *Flip* turns the board around (view only). *Undo* takes back to your previous turn. *New* first asks which colour you want (White, Black or Random), then starts the game; your choice becomes the Lab's *Play as* default.
* Drag the sheet up (or tap *Lab*) for everything else: opponent and Elo, playstyle, Play as / Start / Resign, Edit position, Copy / Share PGN, move suggestions, engine presets, Instamove, think time, board colours, display and feel, the match history, pondering caps, opening book, engine threads, and reset.

### SmallFish

* **You always sit at the top of the board and push pieces downward; the engine sits at the bottom.** Playing White, the board is shown from Black's side (White on top); playing Black, from White's side (Black on top). Touch and drag targets follow the same orientation.
* **Layout:**
  * Header: your clock, status and the engine's clock. Tap the header to spring the board down and reveal the shelf.
  * Optional header lock (Options → Undo, redo & gestures → Header menu → *Lock button*): the clock pill at the top right becomes a 🔒 button. While locked, taps on the header do nothing (the lock wiggles); *Game* in the dock still opens the menu.
  * Board: vertical eval bar on the left edge.
  * Player bar: `Top: Me ••• Bottom: Engine`.
  * Monospaced, scrollable notation (wraps; tap a move to jump there).
  * Dock: `Game · Options · Flip · Move · Hint · •••`.
* **Shelf** (tap the header, the `•••` in the player bar, or *Game*):
  * New Game: archives the match, alternates your colour, and the engine opens if it's White.
  * Edit Position, the persona picker, the Elo slider (800–3000), Instamove, and Match history (Resume / Share PGN / Delete).
  * Tap the lowered board to snap it back.
* **Dock buttons:**
  * *Flip* swaps colours mid-game. You stay on top, so the board turns.
  * *Move* depends on the moment: while the engine thinks it reads **Now** and makes it move immediately; on your turn it plays the best move for you; while reviewing it continues from the shown position.
  * *Hint* draws a green arrow with Stockfish's best move.

### Both layouts

* **Gestures:** swipe **right** to undo and **left** to redo along the stored line.
  * Where (SmallFish): on the board, on the bottom area (player bar and moves), or both (Options → Undo, redo & gestures → Swipe to undo / redo). Classic swipes on the board.
  * How far (both layouts): *To your turn* (default: 1 or 2 moves, back to your previous turn), *1 move* or *2 moves*. Also used by the Undo buttons.
  * A gesture that starts on one of your own movable pieces is always a move, so sideways rook drags still work; a swipe that starts on a move in the notation doesn't also jump to it.
  * While moves remain to redo, the engine waits. Play a move to start a new branch; the engine always answers it.
  * Undo right after resigning just takes the resignation back.
* **Move suggestions** (Coach → Move suggestions, or `•••` in SmallFish): on your turn, up to three green arrows for your best moves. The brighter the arrow, the better the move: brightness falls with rank and with how much worse the move is, and a move much worse than the best isn't shown at all. Full-strength Stockfish runs a short 3-line search (about half a second) at the start of your turn, then the opponent goes back to pondering.
* **Engine arrows:** blue arrows for the engine's top candidate moves while it thinks (Display & feel → Engine arrows).
* **Board colours:** Auto (each layout's own), Slate, Paper, Wood, Green, Ocean, Lavender, Rose. The position editor uses the same colours.
* **Engine presets:** one tap sets opponent, Elo, style, think time, pondering and book. Built in: Blitz sparring, Club player, Master, Full Stockfish, Draw troll. *Save current setup as…* stores your own (tap × to delete). Presets never change threads or hash size, which are tuned to the device. The preset matching your current settings is highlighted.
* **Saved settings:** every change is saved on the device and restored next time. *Reset engine* and *Reset display* (tap twice) go back to the defaults; reset keeps your threads/hash and the layout you're in.
* **Sound and speech bubbles are off by default.** Turn them on under Display & feel. With sound off the app never opens an audio context, so music playing on the phone isn't interrupted.
* **Instamove:** replies in under 50 ms. It uses the book, or an Elo-scaled depth cap (depth 1–2 at club level) within a 30 ms budget, plus controlled slips. Measured at 2–6 ms on desktop Chrome, about 30 ms in the host tests.
  * *Ponder during Instamove* (Thinking, off by default): keeps pondering on your time. When you play the expected move, the reply is still instant but comes from the deeper ponder search. Pondering is capped at Instamove's Elo depth, so it never plays stronger than your Elo setting; it helps from about 2300 Elo up.
* **Edit Position:**
  * Tap a palette piece, then tap squares to place it (drag to paint). Drag pieces from the palette, or use ✋ to move pieces and ⌫ to erase.
  * Clear Board, Starting Position, side to move, castling rights and which colour you play.
  * FEN copy and import, with validation.
  * *Start* archives the current game and syncs the position to the game record and the engine.
* **Match history:** collapsed to one row until you tap it. Inside: *Auto-save games* (on by default: the previous game is saved whenever a new one starts), *Save current game now*, and the games (Resume / Share PGN / Delete). Resuming a game takes it out of the history while it's the live game; saving the same game again updates its entry instead of adding a duplicate.
* **PGN archive:** saved on the device (localStorage). Headers are anonymous ("only moves matter"): Event, Site, Date, Round, White and Black are `?`, while Result carries the real outcome. Edited start positions add `SetUp`/`FEN`.
* **Crash guard:** a UI error shows a small recovery card (Try again / Reload / Reset settings & reload) instead of a blank screen; the game and the engine keep running. Everything read from storage is validated, so a corrupt or outdated entry can't break the app.

## Run it

```bash
pnpm install
pnpm dev --host
```

`--host` serves over HTTPS on your LAN (for example `https://192.168.1.26:5173`), because iOS only grants SharedArrayBuffer and service workers to secure contexts. Open the Network URL in Safari on the iPhone and accept the certificate warning.

The dev server has no service worker. To test the real offline PWA (and Add to Home Screen), use a production build:

```bash
pnpm build
pnpm preview --host
```

iOS only registers service workers on a certificate it trusts. You have two options:

* **Deploy:** `npx vercel --prod`. `vercel.json` already sets the isolation headers.
* **Trusted local certificate:** run `mkcert -install && mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem <your-LAN-IP> localhost`, AirDrop `rootCA.pem` to the phone, install it, then enable it under Settings → General → About → Certificate Trust Settings. Vite picks up `certs/` automatically.

## Architecture

```
UI thread (Preact + signals)                 never searches, never parses UCI
 ├─ chessground board (transform-only drag/animation, imperative updates)
 ├─ game record (chessops, µs-cheap legality → moves land the same frame)
 └─ EngineClient ──postMessage──► engine-host worker
                                   ├─ Polyglot books (binary search, ~0.05 ms/probe) + ECO names
                                   ├─ persona layer (Elo/style mapping, DrawFish selection, human slips)
                                   ├─ ponder manager (go ponder / ponderhit / stop, thermal caps)
                                   ├─ UCI parsing + 10 Hz info throttle
                                   └─ nested engine worker (plain UCI text)
                                        ├─ patricia-mt  (pthreads)   ┐ chosen when the page is
                                        ├─ stockfish-19-lite (MT)    ┘ cross-origin isolated
                                        ├─ patricia-st  (Asyncify, cooperative)  ┐ fallback
                                        └─ stockfish-19-lite-single              ┘
service worker: precache everything + re-apply COOP/COEP/CORP to cached responses
```

* **Hot swap:** engines are booted lazily and kept warm (Patricia and Stockfish can both be resident). Stockfish and DrawFish share one engine instance.
* **Book first:** if the position is in the book (*The Grandmaster Files*, up to the configured depth), the move goes back without touching an engine, along with the ECO code and name.
* **The Grandmaster Files** (`public/books/The-Grandmaster-Files.bin`, built by `pnpm book` from the sources in `../Opening Data Base`): Komodo, Codekiddy, Perfect 2021 and GM 2001 (26.3 MB together) merged into one 2.5 MB standard Polyglot book. The builder walks every line from the starting position (up to 40 plies, the maximum book depth), so unreachable positions are dropped. Each book votes per position; the vote is a blend of the trust-weighted average and the best single-book vote, so one-move engine books can't erase another book's real alternatives. It keeps up to 7 moves in the first 10 plies, 3 up to ply 20, 2 up to ply 28, then the main line only. Probing takes about 0.04 ms.
* **Pondering:** after its move the engine ponders on its predicted reply. If you play that move, the host sends `ponderhit` and the warm search continues. If you play anything else, it sends `stop` and starts over. Thermal caps (max depth and max nodes) keep the phone cool:
  * Patricia pauses at the cap with the CPU idle, and resumes on ponderhit.
  * Stockfish is stopped by a host-side governor, and the warm transposition table is reused after a hit.
* **Pondering is suspended** while the app is in the background.
* **Robustness:** an engine that doesn't answer `stop` (stockfish.js single-thread can hang after a ponder search finishes by itself) is restarted by a watchdog.
* **Undo-safe state machine:** every engine result is tagged with the exact move line it was computed for. The host keys everything (answered, ponder prediction, hint, pending move) by game + side + full line, never by ply count.
  * An undo immediately aborts any search or ponder with `stop`.
  * The engine is then resynced with `position startpos moves <active history>` and an `isready` health check.
  * The next human move always gets a fresh reply.
  * `tests/host-sync.test.ts` reproduces the old post-undo deadlock (it fails against ply-keyed logic) and stress-tests 1,500 random undo/redo/branch/move-now/hint/persona actions.
* **New games** clear the engines' hash in the background (`ucinewgame`) the moment you start them, so the first reply is instant too.

## Personas in detail

**Patricia.** The engine is patched (see `engines/patricia/src/gml.h`, `search.h`, `wasm/patricia_wasm.cpp`):

* `go ponder` / `ponderhit`, plus `ponderdepth N` / `pondernodes N` thermal caps.
* Continuous `UCI_Elo`, which feeds Patricia's own human mode (`cp_loss = 120 − Elo/25`, MultiPV 5).
* A `Style` option:
  * **Hyper-Aggressive:** stock Patricia with the sacrifice bonuses ×1.6, the sacrifice net used earlier, and higher draw contempt.
  * **Positional:** sacrifice machinery off and material scaling off, with space and pawn-structure terms.
  * **Solid:** king-shelter and open-file terms, low contempt, happy to simplify, and prefers her careful "endgame" net when not winning.
* The host adds depth throttling and shorter think time at lower Elo, plus a small chance of a controlled slip below 1500.

**DrawFish.** Trollfish (included in the source folder) changes Stockfish's search to "prefer the smallest positive score; if losing, play the best move". DrawFish applies that rule at the root over Stockfish's MultiPV 6 lines, and adds:

* immediate threefold / 50-move / stalemate claims,
* perpetual-check detection,
* bonuses for even trades and pure opposite-coloured-bishop endings,
* a safety floor so it never walks into a loss.

Like Trollfish, it declines forced mates. *Subtle* hovers at a small plus; *Relentless* dives toward zero.

Trollfish itself isn't compiled: it needs a 45 MB Stockfish 15 net and a second full engine build, which is too heavy for an iPhone.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev --host` | HTTPS dev server on the LAN |
| `pnpm build` / `pnpm preview --host` | production build with service worker |
| `pnpm test` | Polyglot hashing vs python-chess, DrawFish selection, undo/redo + PGN + archive rules, settings validation + presets + reset, host state-machine stress test (incl. suggestion arrows), Patricia UCI smoke test |
| `pnpm engines:patricia` | rebuild Patricia WASM (needs the Emscripten SDK; set `EMSDK`, default `F:/emsdk` on this PC) |
| `pnpm engines:stockfish` | copy the Stockfish lite builds from `node_modules` (runs on install) |
| `pnpm data` | regenerate the Polyglot random table + ECO index (`python-chess`) |
| `pnpm book` | rebuild *The Grandmaster Files* from `../Opening Data Base` (override with `BOOK_SOURCES`, `BOOK_TIERS`, `BOOK_MERGE`) |
| `pnpm icons` | regenerate the icons (headless Chrome) |

## Requirements and notes

* **iOS 16.4+ / Safari 16.4+:** WebAssembly SIMD and module workers.
* **Haptics:** iOS has no Vibration API. On iOS 18+ the app uses the native switch-control haptic, which only fires for your own moves (user gesture). Android uses `navigator.vibrate`.
* **Threads:** the default is 1 thread, the coolest option. With cross-origin isolation, Options offers 2–3.
* **Header taps:** iOS keeps taps on its own status bar (the 5:37 / battery area). The trigger bar sits directly beneath it and reaches into the safe area as far as iOS allows.
* **Rules engine:** the game record uses chessops (Lichess's rules library), not chess.js. Wherever a spec says "sync to chess.js", that sync happens here.

## Licences

* Patricia: MIT (Adam Kulju).
* Stockfish / stockfish.js: GPLv3.
* chessground and the cburnett pieces: GPL-3.0.
* Opening names: lichess-org/chess-openings, CC0.

Distributing the bundled app is therefore subject to GPLv3.
