// Grandmaster Lab - Patricia worker glue (UCI message pump).
//
// Threaded build: every command runs immediately; `go` starts a pthread.
// Cooperative build: `go` runs through Asyncify and returns a Promise; while
// it is pending only stop / ponderhit / isready run immediately, everything
// else is queued until the search reports bestmove.

if (!GML_IS_PTHREAD) {
  (function () {
    var queue = [];
    var ready = false;
    var busy = false;
    var IMMEDIATE = /^(stop|ponderhit|isready)\b/;

    function exec(cmd) {
      if (GML_COOPERATIVE && /^go\b/.test(cmd)) {
        busy = true;
        var done = function () {
          busy = false;
          pump();
        };
        try {
          Promise.resolve(ccall('uci_command', null, ['string'], [cmd], { async: true })).then(
            done,
            function (err) {
              postMessage('info string [patricia] search error: ' + err);
              done();
            }
          );
        } catch (err) {
          postMessage('info string [patricia] search error: ' + err);
          done();
        }
      } else {
        ccall('uci_command', null, ['string'], [cmd]);
      }
    }

    function pump() {
      while (ready && !busy && queue.length) exec(queue.shift());
    }

    self.onmessage = function (event) {
      var cmd = typeof event.data === 'string' ? event.data.trim() : '';
      if (!cmd) return;
      if (cmd === 'quit') {
        self.close();
        return;
      }
      if (ready && busy && IMMEDIATE.test(cmd)) {
        exec(cmd);
        return;
      }
      queue.push(cmd);
      pump();
    };

    Module['onRuntimeInitialized'] = function () {
      var nets = Module['gmlNetsBuffer'];
      var netBytes = _patricia_net_bytes();
      var allocBytes = _patricia_alloc_size();
      if (!nets || nets.length < netBytes * 3) {
        postMessage('info string [patricia] nets missing or truncated');
        return;
      }
      for (var i = 0; i < 3; i++) {
        var ptr = _patricia_alloc(allocBytes);
        HEAPU8.set(nets.subarray(i * netBytes, (i + 1) * netBytes), ptr);
        _patricia_set_net(i, ptr);
      }
      Module['gmlNetsBuffer'] = null;
      _patricia_init();
      ready = true;
      pump();
    };
  })();
}
