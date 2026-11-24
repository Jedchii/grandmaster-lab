# Grandmaster Lab

An offline, touch-first chess sparring PWA for iPhone (Safari → Add to Home Screen) with three opponents:

| Persona | Engine | What it does |
|---|---|---|
| 🐇 **Patricia** | Patricia 5.1 by Adam Kulju, compiled to WebAssembly (SIMD) from source | Human-like, sacrificial play. Estimated Elo 800–3000, four playstyles (Classic is stock Patricia). |
| 🐟 **Stockfish** | Stockfish 19 lite NNUE (stockfish.js) | The benchmark: live eval, mate scores, PV lines, eval bar. Optional Elo limit. |
| 🐡 **DrawFish** | Stockfish 19 + Trollfish's draw logic | Draws at all costs: repetitions, perpetuals, trades, fortresses, stalemate lines. |

Everything (engines, NNUE nets, opening books, piece art, sounds) is precached by a service worker. Once loaded, the app makes no network requests.

## How it plays

There are two layouts over the same game, engines and settings. Switch any time under **Lab → Display → Layout** (Classic) or **Options → Layout** (SmallFish); the game in progress carries over.

### Classic (default)

* Persona card on top (avatar, live status, search depth, opening name), the board edge to edge with **your colour at the bottom**, a slim eval strip and a scrolling move strip under it.
* Tap the opponent card to shrink it to one slim line (tap again to expand, or Lab → Display → Compact opponent card): the board moves up and gets bigger on small phones.
* **Built for one thumb.** Every control is at least 44 × 44 pt, the iOS minimum.
* Bottom bar, always in the same place: `Back · Next · Undo · Hint · New · Lab`.
  * *Back* / *Next* step through the game on release (hold to scrub). A drag that starts on a button never presses it. While you look at an earlier position the engine waits; *Live* at the end of the move strip jumps back.
  * *Undo* takes back to your previous turn. *New* first asks which colour you want (White, Black or Random), then starts the game; your choice becomes the Lab's *Play as* default.
  * Left-handed? Lab → Display → *Bottom bar for* → *Left thumb* mirrors the bar (Lab on the left, Back and Next on the right).
* When a game ends, the result shows as a slim banner over the top of the board and the bar becomes `Rematch · Switch · Undo · Review · Lab`. *Review* hides the result and gives you the normal bar back.
* The Lab slides up from behind the bar. *Lab* (or the grabber pill) opens it to half height; drag up for full height. Drag down, swipe down on the content when it's scrolled to the top, tap outside it, or tap *Lab* again to close. Its four tabs sit right above the bar:
  * **Play:** New game, Resign (tap twice), Flip board, Edit position, Copy / Share PGN, Play as, Match history.
  * **Opponent:** opponent and Elo, playstyle, engine presets, Instamove and think time.
  * **Display:** move suggestions, undo / redo step, compact card, bar handedness, board colours, display and feel, layout.
  * **Engine:** pondering caps, opening book, engine threads and hash, reset, about.
* Sliders have − / + buttons for exact one-notch steps (hold to repeat; the engine restarts once, on release).

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
* **Instamove:** replies in under 50 ms. It uses the book, or a 30 ms search. Stockfish and DrawFish add an Elo-scaled depth cap (depth 1–2 at club level) and, for Stockfish, controlled slips; Patricia's own Elo mode does her weakening. Measured at 2–6 ms on desktop Chrome, about 30 ms in the host tests.
  * *Ponder during Instamove* (Thinking, off by default): keeps pondering on your time. When you play the expected move, the reply is still instant but comes from the deeper ponder search. For Stockfish, pondering is capped at Instamove's Elo depth, so it never plays stronger than your Elo setting. For Patricia, a hit plays at her full Elo-setting strength.
* **Edit Position:**
  * Tap a palette piece, then tap squares to place it (drag to paint). Drag pieces from the palette, or use ✋ to move pieces and ⌫ to erase.
  * Clear Board, Starting Position, side to move, castling rights and which colour you play.
  * FEN copy and import, with validation.
  * *Start* archives the current game and syncs the position to the game record and the engine.
* **Match history:** collapsed to one row until you tap it. Inside: *Auto-save games* (on by default: the previous game is saved whenever a new one starts), *Save current game now*, and the games (Resume / Share PGN / Delete). Resuming a game takes it out of the history while it's the live game; saving the same game again updates its entry instead of adding a duplicate.
* **PGN archive:** saved on the device (localStorage). Headers are anonymous ("only moves matter"): Event, Site, Date, Round, White and Black are `?`, while Result carries the real outcome. Edited start positions add `SetUp`/`FEN`.
* **Crash guard:** a UI error shows a small recovery card (Try again / Reload / Reset settings & reload) instead of a blank screen; the game and the engine keep running. Everything read from storage is validated, so a corrupt or outdated entry can't break the app.

## Install on your iPhone

The app installs straight from Safari as a Home Screen app. You don't need the App Store, a Mac or a developer account, and nothing expires after 7 days the way a sideloaded `.ipa` does. It needs one HTTPS address to install from; after that it never uses the network.

1. **Deploy** (from this folder): `npx vercel --prod`. The folder is linked to the Vercel project *masterplan*; `vercel.json` sets the cross-origin isolation headers and `.vercelignore` keeps the upload to what the build needs. The first time, the CLI asks you to sign in.
2. **On the iPhone, in Safari** (not Chrome; only Safari can install): open the deployment URL, tap **Share → Add to Home Screen**, keep *Open as Web App* on, and tap **Add**.
3. **Open it once from the Home Screen while online** and wait for **✓ Ready to play offline** (about 10 MB). The Home Screen app keeps its own storage, separate from Safari, so this first launch is what saves it for offline use.
4. From then on it works in airplane mode. **Lab → Engine → About** shows the version, whether the offline copy is complete and how much it stores, plus **Check for update**.

**Updates:** deploy again. The app looks for a new version each time it comes back to the foreground (at most every 30 minutes) or when you tap *Check for update*, downloads it in the background, and shows *Update ready, tap to reload*. The game in progress is saved on every move, so the reload brings it back.

**Your data** (settings, presets, saved games, the live game) lives in the Home Screen app's storage on the phone. Deleting the app from the Home Screen deletes it, so export games you want to keep with *Share PGN* first.

**What the Home Screen app adds over a Safari tab:** full screen with no browser bars, launch screens for every iPhone from the SE to the 17 Pro Max (`pnpm splash` regenerates them), and storage marked persistent, so iOS doesn't clear the offline copy to free space.

## Native iOS app (.ipa, sideloaded)

The same app can also ship as a native iOS app: a Capacitor shell (`ios-app/`) around a bundled copy of the web build. Use it if you'd rather sideload than install from Safari. The Home Screen install above is still the main path and is unchanged.

**How it differs from the Home Screen app**

* **Everything is inside the app.** No service worker, no first-run download, and no network use at all.
* **Single-threaded engines.** The iOS web view serves the app from `capacitor://localhost` without cross-origin isolation, so SharedArrayBuffer isn't available. The engine host notices and boots `patricia-st` and `stockfish-19-lite-single` by itself (`tests/engine-fallback.test.ts`). The *Threads* option is hidden, as in any non-isolated browser, so only the 2–3 thread setting is lost (the default is 1 thread).
* **Updates** come as a new `.ipa`. Lab → Engine → About says "Native app".
* **Your data is separate** from the Home Screen app's: settings and saved games don't carry over. Use *Share PGN* to move games.
* **Free Apple ID:** a sideloaded app stops opening after 7 days. Re-install it with Sideloadly to renew it; your data stays as long as the app isn't deleted.

**Build** (no Mac needed): `.github/workflows/ios-ipa.yml` runs on a GitHub Actions macOS runner on every push to `main` (or by hand: *Actions → iOS unsigned IPA → Run workflow*). It runs the tests, `pnpm build:native`, generates the Xcode project (`ios-app/scripts/prepare-ios.sh`: Capacitor 8 with Swift Package Manager; portrait only, iPhone only, light status bar over the app, app icon and launch screen from `ios-app/assets`), builds **unsigned**, and uploads `GrandmasterLab-<version>-<run>-unsigned.ipa` as the run's artifact (kept 14 days). Bundle ID `com.grandmasterlab.app`, Home Screen name *GM Lab*.

The same build also runs on **Codemagic** (`codemagic.yaml`; free personal accounts get 500 macOS minutes a month), which is handy when GitHub Actions isn't available: add the repo as an app in Codemagic, then *Start new build → main → iOS unsigned IPA*, and download the `.ipa` from the build's *Artifacts*. Both services run the same `ios-app/scripts/prepare-ios.sh` and `ios-app/scripts/build-ipa.sh`.

**Install with Sideloadly** (Windows or Mac):

1. Plug in the iPhone, unlock it and tap *Trust* if asked.
2. In Sideloadly, drop the `.ipa` in, pick the iPhone, enter your Apple ID, click **Start**, and enter the password and code when Sideloadly asks. Sideloadly signs the app with your Apple ID.
3. On the iPhone, turn on **Settings → Privacy & Security → Developer Mode** (iOS 16+; the phone restarts), then trust your Apple ID under **Settings → General → VPN & Device Management**.

**Check it locally:** `pnpm build:native && pnpm preview:native` serves the native bundle without the isolation headers, like the iOS web view (single-thread engines, no service worker). `pnpm native:assets` regenerates the icon and launch image.

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
                                   ├─ persona layer (Elo/style mapping, DrawFish selection, Stockfish slips)
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
* Continuous `UCI_Elo`, which feeds Patricia's own human mode. Below 3000 she searches five lines at full depth, then plays a worse one within a running mistake budget of `120 − Elo/25` centipawns per move (Skill Level's calibration, also used by her Lichess bot littlePatricia).
  * The budget only means what it says when the search is deep enough to measure the losses, so the host gives her the full think time and adds no depth cap and no slips. Instamove is a 30 ms time limit only.
  * A ponder search that ends in `stop` (you played another move) doesn't touch the budget; a ponder hit counts as normal. `budget` (debug) prints it.
  * She compares her five candidates at the last fully searched depth (`search.h`, `done_*`). Stock Patricia can mix depths when time runs out partway through an iteration, which made a move that had just been refuted look like a small inaccuracy.
* A `Style` option:
  * **Classic:** stock Patricia 5.1, unchanged.
  * **Hyper-Aggressive:** stock Patricia with the sacrifice bonuses ×1.6, the sacrifice net used earlier, and higher draw contempt.
  * **Positional:** sacrifice machinery off and material scaling off, with space and pawn-structure terms.
  * **Solid:** king-shelter and open-file terms, low contempt, happy to simplify, and prefers her careful "endgame" net when not winning.

**DrawFish.** Trollfish (included in the source folder) changes Stockfish's search to "prefer the smallest positive score; if losing, play the best move". DrawFish applies that rule at the root over Stockfish's MultiPV 6 lines, and adds:

* immediate threefold / 50-move / stalemate claims,
* perpetual-check detection,
* bonuses for even trades and pure opposite-coloured-bishop endings,
* a safety floor so it never walks into a loss.

Like Trollfish, it declines forced mates: when every line it sees is a forced mate, it plays the slowest one (preferring moves that keep the 50-move count running), never the mate in 1. When it is clearly winning (its last evaluation ≥ +2.5, or 3 pawns up on the board) it weighs 24 moves instead of 6, so it can find a way to give the win back. If every move still keeps it at least 3 pawns up, it avoids pawn moves and captures so the 50-move rule can end the game. *Defence* (Options) picks how hard it saves worse positions:

* **Max defence** (default): always searches at full depth, whatever the Elo setting, and when behind stays within 0.25 pawns of the best defence and counts only pawn trades as drawish (trading pieces helps the side that's ahead). Started a pawn down against Stockfish at its strongest limited level, it held 3 of 4 games where the original lost all 4.
* **Original:** the first DrawFish. The Elo setting caps its search depth, and when behind it allows moves up to 0.4 pawns worse and likes any even trade, so a worse position can slip away. *Subtle* hovers at a small plus; *Relentless* dives toward zero.

Trollfish itself isn't compiled: it needs a 45 MB Stockfish 15 net and a second full engine build, which is too heavy for an iPhone.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev --host` | HTTPS dev server on the LAN |
| `pnpm build` / `pnpm preview --host` | production build with service worker |
| `pnpm build:native` / `pnpm preview:native` | bundle for the native iOS app (`dist-native/`, no service worker), served without isolation headers |
| `pnpm native:assets` | regenerate the iOS app icon and launch image (`ios-app/assets/`, headless Chrome) |
| `pnpm test` | Polyglot hashing vs python-chess, DrawFish selection, undo/redo + PGN + archive rules, settings validation + presets + reset, host state-machine stress test (incl. suggestion arrows), single-thread fallback without SharedArrayBuffer, Patricia UCI smoke test |
| `pnpm engines:patricia` | rebuild Patricia WASM (needs the Emscripten SDK; set `EMSDK`, default `F:/emsdk` on this PC) |
| `pnpm engines:stockfish` | copy the Stockfish lite builds from `node_modules` (runs on install) |
| `pnpm data` | regenerate the Polyglot random table + ECO index (`python-chess`) |
| `pnpm book` | rebuild *The Grandmaster Files* from `../Opening Data Base` (override with `BOOK_SOURCES`, `BOOK_TIERS`, `BOOK_MERGE`) |
| `pnpm icons` | regenerate the icons (headless Chrome) |
| `pnpm splash` | regenerate the iOS launch screens from the icon and update `index.html` (headless Chrome) |

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
