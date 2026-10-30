#pragma once
// Grandmaster Lab additions to Patricia 5.1 (browser / iOS build).
//
//  * Pondering: `go ponder` + `ponderhit`, with optional thermal caps
//    (`ponderdepth N`, `pondernodes N`). When a cap is reached the search
//    *pauses* (CPU idle) instead of finishing, so a later `ponderhit` resumes
//    the very same iterative-deepening loop with real time limits.
//  * Playstyles: Aggressive (stock Patricia, amplified), Positional, Solid.
//  * Cooperative yielding for the single-threaded (Asyncify) build so `stop`
//    and `ponderhit` are processed while a search is running.

#include <atomic>
#include <chrono>
#include <cstdint>
#include <thread>

#if defined(__EMSCRIPTEN__)
#include <emscripten.h>
#endif

#if defined(__EMSCRIPTEN__) && !defined(__EMSCRIPTEN_PTHREADS__)
#define GML_COOPERATIVE 1
#else
#define GML_COOPERATIVE 0
#endif

// ---------------------------------------------------------------- pondering
inline std::atomic<bool> g_pondering{false};
inline std::atomic<bool> g_ponder_capped{false};
inline int g_ponder_depth_cap = 0;      // 0 = unlimited
inline uint64_t g_ponder_nodes_cap = 0; // 0 = unlimited

#if GML_COOPERATIVE
// Yields to the worker's event loop. ms == 0 uses a MessageChannel hop
// (~0.05 ms) instead of setTimeout, which browsers clamp to 4 ms.
EM_ASYNC_JS(void, gml_js_yield, (int ms), {
  await new Promise((resolve) => {
    if (ms > 0) setTimeout(resolve, ms);
    else Module.gmlYield(resolve);
  });
});

inline std::chrono::steady_clock::time_point g_last_yield =
    std::chrono::steady_clock::now();

// Called from the hot search path; yields every ~12 ms of search.
inline void gml_maybe_yield() {
  auto now = std::chrono::steady_clock::now();
  if (now - g_last_yield >= std::chrono::milliseconds(12)) {
    gml_js_yield(0);
    g_last_yield = std::chrono::steady_clock::now();
  }
}
#endif

inline void engine_idle_wait_ms(int ms) {
#if GML_COOPERATIVE
  gml_js_yield(ms);
#else
  std::this_thread::sleep_for(std::chrono::milliseconds(ms));
#endif
}

// ---------------------------------------------------------------- playstyle
namespace Styles {
constexpr int Aggressive = 0;
constexpr int Positional = 1;
constexpr int Solid = 2;
} // namespace Styles

struct StyleConfig {
  int id = Styles::Aggressive;
  int sac_bonus_pct = 100;  // scales Patricia's sacrifice bonus
  bool mat_scaling = true;  // shrink eval as material comes off (keep attacking)
  int draw_contempt = 50;   // draw score shift when material is imbalanced
  int sac_net_above = 400;  // use the sacrifice net when score is above this
  int endgame_net_below = -20; // use the endgame net when score is below this
  bool allow_sac_net = true;
  int space_weight = 0;     // positional: safe central squares behind pawns
  int doubled_penalty = 0;  // positional: doubled pawns
  int isolated_penalty = 0; // positional: isolated pawns
  int shield_weight = 0;    // solid: pawns sheltering the king
  int open_king_penalty = 0; // solid: half-open files next to the king
};

inline StyleConfig g_style;

inline void set_style(int id) {
  StyleConfig s;
  s.id = id;
  if (id == Styles::Aggressive) {
    // "Hyper-aggressive": stock Patricia with the sacrifice machinery turned up.
    s.sac_bonus_pct = 160;
    s.mat_scaling = true;
    s.draw_contempt = 60;
    s.sac_net_above = 150;
    s.endgame_net_below = -60;
  } else if (id == Styles::Positional) {
    s.sac_bonus_pct = 25;
    s.mat_scaling = false;
    s.draw_contempt = 30;
    s.allow_sac_net = false;
    s.endgame_net_below = -20;
    s.space_weight = 3;
    s.doubled_penalty = 22;
    s.isolated_penalty = 16;
  } else {
    // Solid: counter-punching defence. Accepts simplification, values shelter.
    s.sac_bonus_pct = 0;
    s.mat_scaling = false;
    s.draw_contempt = 10;
    s.allow_sac_net = false;
    s.endgame_net_below = 60;
    s.shield_weight = 12;
    s.open_king_penalty = 18;
    s.doubled_penalty = 10;
  }
  g_style = s;
}
