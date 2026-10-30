// Grandmaster Lab - browser entry point for Patricia 5.1.
//
// Replaces the blocking stdin loop of uci.h with an exported uci_command()
// that the worker glue (post.js) calls once per UCI line. Two flavours are
// built from this file:
//
//  * patricia-mt  (-pthread): the search runs on a pthread, so `stop` and
//    `ponderhit` arrive while it is running. Needs SharedArrayBuffer, i.e. a
//    cross-origin isolated page.
//  * patricia-st  (Asyncify): no threads; the search yields to the event loop
//    every ~12 ms (see gml.h) so `stop`/`ponderhit` still get through.
//
// Extensions over stock Patricia: go ponder / ponderhit, ponderdepth and
// pondernodes thermal caps, UCI_LimitStrength + continuous UCI_Elo, Style.

#include <emscripten.h>
#include <emscripten/eventloop.h>

#include <cstdlib>
#include <memory>
#include <sstream>
#include <string>

#include "../src/human.h"
#include "../src/search.h"

namespace {

Position g_position;
std::unique_ptr<ThreadInfo> g_thread_info;

#if !GML_COOPERATIVE
std::thread g_search_thread;
#endif

bool g_limit_strength = false;
int g_elo = 3000;

constexpr int kMaxThreads = 3; // matches PTHREAD_POOL_SIZE in build.mjs

void apply_strength() {
  ThreadInfo &ti = *g_thread_info;
  if (!g_limit_strength || g_elo >= 3000) {
    ti.is_human = false;
    return;
  }
  ti.is_human = true;
  // Same calibration as Patricia's Skill_Level table (cp_loss = 120 - elo/25),
  // but continuous instead of 20 steps.
  ti.cp_loss = std::max(0, 120 - g_elo / 25);
}

Move uci_to_internal(const Position &position, const std::string &uci) {
  std::array<Move, ListSize> list;
  int nmoves = movegen_dispatch<Generate::GenAll>(
      position, list.data(),
      attacks_square(position, get_king_pos(position, position.color),
                     position.color ^ 1));
  for (int i = 0; i < nmoves; i++) {
    if (internal_to_uci(position, list[i]) == uci) {
      return list[i];
    }
  }
  return MoveNone;
}

void run_search() {
  ThreadInfo &ti = *g_thread_info;
  if (ti.is_human) {
    search_human(g_position, ti);
  } else {
    search_position(g_position, ti, TT);
  }
}

void join_search() {
#if !GML_COOPERATIVE
  if (g_search_thread.joinable()) {
    g_search_thread.join();
  }
#endif
}

void set_threads(int value) {
#if !GML_COOPERATIVE
  value = std::clamp(value, 1, kMaxThreads);
  thread_data.terminate = true;
  reset_barrier.arrive_and_wait();
  idle_barrier.arrive_and_wait();
  for (auto &t : thread_data.threads) {
    if (t.joinable()) {
      t.join();
    }
  }
  thread_data.thread_infos.clear();
  thread_data.threads.clear();
  thread_data.terminate = false;
  thread_data.num_threads = value;
  reset_barrier.reset(value);
  idle_barrier.reset(value);
  search_end_barrier.reset(value);
  for (int i = 0; i < value - 1; i++) {
    thread_data.thread_infos.emplace_back();
    thread_data.threads.emplace_back(loop, i);
  }
#else
  (void)value;
#endif
}

void cmd_setoption(std::istringstream &in) {
  ThreadInfo &ti = *g_thread_info;
  std::string token, name, value;
  in >> token; // "name"
  // Option names may contain spaces; read up to "value".
  while (in >> token && token != "value") {
    name += (name.empty() ? "" : " ") + token;
  }
  std::getline(in >> std::ws, value);

  auto as_int = [&]() { return std::atoi(value.c_str()); };

  if (name == "Hash") {
    resize_TT(std::clamp(as_int(), 1, 256));
  } else if (name == "Threads") {
    set_threads(as_int());
  } else if (name == "MultiPV") {
    ti.multipv = std::clamp(as_int(), 1, 5);
  } else if (name == "Move_Overhead" || name == "Move Overhead") {
    thread_data.move_overhead = std::clamp(as_int(), 0, 5000);
  } else if (name == "UCI_Chess960") {
    thread_data.is_frc = (value == "true");
  } else if (name == "UCI_LimitStrength") {
    g_limit_strength = (value == "true");
    apply_strength();
  } else if (name == "UCI_Elo") {
    g_elo = std::clamp(as_int(), 500, 3000);
    apply_strength();
  } else if (name == "Skill_Level") {
    int level = std::clamp(as_int(), 1, 21);
    static constexpr std::array<int, 20> levels = {
        500,  800,  1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800,
        1900, 2000, 2100, 2200, 2300, 2400, 2500, 2650, 2800, 3000};
    g_limit_strength = level < 21;
    g_elo = level < 21 ? levels[level - 1] : 3000;
    apply_strength();
  } else if (name == "Style") {
    if (value == "Positional") {
      set_style(Styles::Positional);
    } else if (value == "Solid") {
      set_style(Styles::Solid);
    } else if (value == "Classic") {
      g_style = StyleConfig{};
    } else {
      set_style(Styles::Aggressive);
    }
  } else if (name == "Ponder") {
    // Accepted for GUI compatibility; pondering is driven by `go ponder`.
  } else {
    for (auto &param : get_params()) {
      if (name == param.name) {
        *param.value = as_int();
        if (name == "LMRBase" || name == "LMRRatio") {
          init_LMR();
        }
      }
    }
  }
}

void cmd_position(std::istringstream &in) {
  ThreadInfo &ti = *g_thread_info;
  ti.game_ply = 6;
  std::string setup;
  in >> setup;
  if (setup == "fen") {
    std::string fen, part;
    for (int i = 0; i < 6 && in >> part; i++) {
      if (part == "moves") {
        // Short FEN without move counters.
        break;
      }
      fen += part + " ";
    }
    set_board(g_position, ti, fen);
    if (part != "moves") {
      in >> part; // consume "moves" if present
    }
  } else {
    set_board(g_position, ti,
              "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    std::string maybe_moves;
    in >> maybe_moves;
  }
  calculate(g_position);

  std::string move_str;
  while (in >> move_str) {
    Move move = uci_to_internal(g_position, move_str);
    if (move == MoveNone) {
      printf("info string illegal move %s\n", move_str.c_str());
      break;
    }
    ss_push(g_position, ti, move);
    make_move(g_position, move);
  }
}

void cmd_go(std::istringstream &in) {
  ThreadInfo &ti = *g_thread_info;
  ti.start_time = std::chrono::steady_clock::now();

#if !GML_COOPERATIVE
  for (auto &info : thread_data.thread_infos) {
    while (info.searching) {
    }
  }
#endif
  join_search();

  ti.max_nodes_searched = UINT64_MAX / 2;
  ti.opt_nodes_searched = UINT64_MAX / 2;
  ti.max_iter_depth = MaxSearchDepth;

  bool ponder = false;
  int ponder_depth = 0;
  uint64_t ponder_nodes = 0;
  int color = g_position.color, time = INT32_MAX, increment = 0;
  int movetime = -1;

  std::string token;
  while (in >> token) {
    if (token == "ponder") {
      ponder = true;
    } else if (token == "ponderdepth") {
      in >> ponder_depth;
    } else if (token == "pondernodes") {
      in >> ponder_nodes;
    } else if (token == "wtime" && color == Colors::White) {
      in >> time;
    } else if (token == "btime" && color == Colors::Black) {
      in >> time;
    } else if (token == "winc" && color == Colors::White) {
      in >> increment;
    } else if (token == "binc" && color == Colors::Black) {
      in >> increment;
    } else if (token == "nodes") {
      uint64_t nodes;
      in >> nodes;
      ti.max_nodes_searched = nodes;
    } else if (token == "depth") {
      int depth;
      in >> depth;
      ti.max_iter_depth = std::clamp(depth, 1, (int)MaxSearchDepth);
    } else if (token == "movetime") {
      in >> movetime;
    }
  }

  if (movetime >= 0) {
    ti.max_time = std::max(2, movetime - thread_data.move_overhead);
    ti.opt_time = INT32_MAX / 2;
  } else {
    time = std::max(2, time - thread_data.move_overhead);
    ti.max_time = time * 8 / 10;
    ti.opt_time = (time / 20 + increment) * 6 / 10;
  }

  g_ponder_depth_cap = ponder ? ponder_depth : 0;
  g_ponder_nodes_cap = ponder ? ponder_nodes : 0;
  g_ponder_capped.store(false);
  g_pondering.store(ponder, std::memory_order_release);
  thread_data.stop = false;

#if GML_COOPERATIVE
  g_last_yield = std::chrono::steady_clock::now();
  run_search(); // Asyncify unwinds out of here at every yield point.
#else
  g_search_thread = std::thread(run_search);
#endif
}

void cmd_ponderhit() {
  if (!g_pondering.load()) {
    return;
  }
  // The engine's think time starts now that the predicted move was played.
  g_thread_info->start_time = std::chrono::steady_clock::now();
  g_ponder_capped.store(false, std::memory_order_relaxed);
  g_pondering.store(false, std::memory_order_release);
}

} // namespace

extern "C" {

// Allocates a 64-byte aligned block (used for the NNUE nets).
EMSCRIPTEN_KEEPALIVE void *patricia_alloc(size_t bytes) {
  size_t rounded = (bytes + 63) & ~static_cast<size_t>(63);
  return std::aligned_alloc(64, rounded);
}

EMSCRIPTEN_KEEPALIVE int patricia_net_bytes() {
  return static_cast<int>(NNUE_FILE_BYTES);
}

EMSCRIPTEN_KEEPALIVE int patricia_alloc_size() {
  return static_cast<int>(sizeof(NNUE_Params));
}

EMSCRIPTEN_KEEPALIVE void patricia_set_net(int index, const void *data) {
  if (index >= 0 && index < static_cast<int>(NUM_NETS)) {
    g_nets[index] = static_cast<const NNUE_Params *>(data);
  }
}

EMSCRIPTEN_KEEPALIVE void patricia_init() {
  // There is no main(): pin the runtime alive, otherwise Emscripten treats the
  // first finished callback as program exit and stops servicing the pthread
  // mailbox (search output from worker threads would stall).
  emscripten_runtime_keepalive_push();
  init_LMR();
  init_bbs();
  g_thread_info = std::make_unique<ThreadInfo>();
  set_style(Styles::Aggressive);
  new_game(*g_thread_info, TT);
  set_board(g_position, *g_thread_info,
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
}

EMSCRIPTEN_KEEPALIVE void uci_command(const char *line) {
  std::string input(line);
  std::istringstream in(input);
  std::string command;
  in >> std::skipws >> command;

  if (command == "uci") {
    printf("id name Patricia 5.1 (Grandmaster Lab WASM%s)\n"
           "id author Adam Kulju\n"
           "option name Hash type spin default 32 min 1 max 256\n"
           "option name Threads type spin default 1 min 1 max %d\n"
           "option name MultiPV type spin default 1 min 1 max 5\n"
           "option name Ponder type check default false\n"
           "option name UCI_LimitStrength type check default false\n"
           "option name UCI_Elo type spin default 3000 min 500 max 3000\n"
           "option name Skill_Level type spin default 21 min 1 max 21\n"
           "option name Style type combo default Aggressive var Aggressive "
           "var Positional var Solid var Classic\n"
           "option name Move_Overhead type spin default 50 min 0 max 5000\n"
           "option name UCI_Chess960 type check default false\n"
           "uciok\n",
           GML_COOPERATIVE ? ", cooperative" : ", threads",
           GML_COOPERATIVE ? 1 : kMaxThreads);
  } else if (command == "isready") {
    printf("readyok\n");
  } else if (command == "setoption") {
    cmd_setoption(in);
  } else if (command == "ucinewgame") {
    thread_data.stop = true;
    g_pondering.store(false);
    join_search();
    new_game(*g_thread_info, TT);
    set_board(g_position, *g_thread_info,
              "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  } else if (command == "position") {
    cmd_position(in);
  } else if (command == "go") {
    cmd_go(in);
  } else if (command == "stop") {
    // Do not join here: the search thread's final printf is proxied to this
    // thread, so the bestmove arrives asynchronously right after.
    thread_data.stop = true;
  } else if (command == "ponderhit") {
    cmd_ponderhit();
  } else if (command == "d") {
    print_board(g_position);
  }
}

} // extern "C"
