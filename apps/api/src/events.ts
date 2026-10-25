import type { ServerResponse } from 'node:http';
import type { RunSnapshot } from '@ratelab/contracts';

export function createRunEvents(snapshot: RunSnapshot, stop: () => void, {
  graceMs = 15_000, intervalMs = 200, slowReaderMs = 5_000,
} = {}) {
  let current: ServerResponse | undefined;
  let closeCurrent: (() => void) | undefined;
  let sendCurrent: (() => void) | undefined;
  let finished = false;
  let grace: ReturnType<typeof setTimeout>;

  function startGrace() {
    clearTimeout(grace);
    if (!finished) grace = setTimeout(stop, graceMs).unref();
  }
  startGrace();

  function connect(response: ServerResponse) {
    closeCurrent?.();
    clearTimeout(grace);
    current = response;
    let blocked = false;
    let slowReader: ReturnType<typeof setTimeout>;
    let lastHeartbeat = Date.now();
    response.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no', Connection: 'keep-alive',
    });
    response.setTimeout(0);
    response.flushHeaders();

    function cleanup() {
      clearInterval(tick);
      clearTimeout(slowReader);
      response.off('drain', drain);
      response.off('close', disconnected);
      response.off('error', disconnected);
      if (current === response) {
        current = undefined;
        closeCurrent = undefined;
        sendCurrent = undefined;
      }
    }
    function disconnected() {
      cleanup();
      startGrace();
    }
    function send() {
      if (blocked || response.destroyed || response.writableEnded) return;
      const heartbeat = Date.now() - lastHeartbeat >= 10_000;
      if (heartbeat) lastHeartbeat = Date.now();
      const frame = `${heartbeat ? ': heartbeat\n\n' : ''}event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
      if (response.writableLength + Buffer.byteLength(frame) > 256 * 1_024) { response.destroy(); return; }
      if (!response.write(frame)) {
        blocked = true;
        slowReader = setTimeout(() => response.destroy(), slowReaderMs).unref();
      }
      if (finished && !blocked) {
        cleanup();
        response.end();
      }
    }
    function drain() {
      blocked = false;
      clearTimeout(slowReader);
      send();
    }
    const tick = setInterval(send, intervalMs).unref();
    response.on('drain', drain);
    response.on('close', disconnected);
    response.on('error', disconnected);
    closeCurrent = () => { cleanup(); response.destroy(); };
    sendCurrent = send;
    send();
  }

  function finish() {
    finished = true;
    clearTimeout(grace);
    sendCurrent?.();
  }
  function close() {
    finished = true;
    clearTimeout(grace);
    closeCurrent?.();
  }
  return { connect, finish, close };
}
