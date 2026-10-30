// Grandmaster Lab - Patricia worker glue (runs before the Emscripten runtime).
//
// The generated patricia-*.js is itself the worker entry point: the engine
// host spawns it with `new Worker(url)` and talks plain UCI text over
// postMessage, exactly like stockfish.js. In the threaded build the same
// script also boots every pthread worker, which must skip this glue.

var GML_IS_PTHREAD =
  typeof self !== 'undefined' &&
  typeof self.name === 'string' &&
  self.name.indexOf('em-pthread') === 0;

if (!GML_IS_PTHREAD) {
  Module['print'] = function (line) {
    postMessage(line);
  };
  Module['printErr'] = function (line) {
    postMessage('info string [patricia] ' + line);
  };

  // Fetch the NNUE nets while the WASM module compiles.
  Module['gmlNets'] = fetch(new URL('patricia-nets.bin', self.location.href).href).then(
    function (res) {
      if (!res.ok) throw new Error('patricia-nets.bin HTTP ' + res.status);
      return res.arrayBuffer();
    }
  );
  Module['preRun'] = [
    function () {
      addRunDependency('gml-nets');
      Module['gmlNets'].then(
        function (buffer) {
          Module['gmlNetsBuffer'] = new Uint8Array(buffer);
          removeRunDependency('gml-nets');
        },
        function (err) {
          postMessage('info string [patricia] failed to load nets: ' + err);
        }
      );
    },
  ];

  // Zero-delay yield for the cooperative (Asyncify) build. Chained
  // setTimeout(0) calls get clamped to 4 ms, so most yields hop through a
  // MessageChannel (~50 us). Every 8th yield uses a real timer so runtimes that
  // drain a port's queue in one go (Node) still service incoming commands.
  var gmlYieldQueue = [];
  var gmlYieldCount = 0;
  var gmlYieldChannel = new MessageChannel();
  gmlYieldChannel.port1.onmessage = function () {
    var resolve = gmlYieldQueue.shift();
    if (resolve) resolve();
  };
  Module['gmlYield'] = function (resolve) {
    if (++gmlYieldCount % 8 === 0) {
      setTimeout(resolve, 0);
      return;
    }
    gmlYieldQueue.push(resolve);
    gmlYieldChannel.port2.postMessage(0);
  };
}
