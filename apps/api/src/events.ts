import type { ServerResponse } from 'node:http';
import type { RunSnapshot } from '@ratelab/contracts';

export function createRunEvents(
  snapshot: RunSnapshot,
  stop: () => void,
  {
    graceMs = 15_000,
    intervalMs = 200,
    slowReaderMs = 5_000,
  } = {},
) {
  let currentResponse: ServerResponse | undefined;
  let closeCurrent: (() => void) | undefined;
  let sendCurrent: (() => void) | undefined;
  let finished = false;
  let graceTimer: ReturnType<typeof setTimeout>;

  function startGrace() {
    clearTimeout(graceTimer);

    if (!finished) {
      graceTimer = setTimeout(stop, graceMs);
      graceTimer.unref();
    }
  }

  startGrace();

  function connect(response: ServerResponse) {
    closeCurrent?.();
    clearTimeout(graceTimer);
    currentResponse = response;

    let waitingForDrain = false;
    let slowReaderTimer: ReturnType<typeof setTimeout>;
    let lastHeartbeat = Date.now();

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    response.setTimeout(0);
    response.flushHeaders();

    function cleanup() {
      clearInterval(snapshotInterval);
      clearTimeout(slowReaderTimer);

      response.off('drain', drain);
      response.off('close', disconnected);
      response.off('error', disconnected);

      if (currentResponse === response) {
        currentResponse = undefined;
        closeCurrent = undefined;
        sendCurrent = undefined;
      }
    }

    function disconnected() {
      cleanup();
      startGrace();
    }

    function send() {
      if (waitingForDrain || response.destroyed || response.writableEnded) {
        return;
      }

      const heartbeatDue = Date.now() - lastHeartbeat >= 10_000;
      let frame = '';

      if (heartbeatDue) {
        lastHeartbeat = Date.now();
        frame = ': heartbeat\n\n';
      }

      frame += `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;

      const pendingBytes = response.writableLength + Buffer.byteLength(frame);

      if (pendingBytes > 256 * 1_024) {
        response.destroy();
        return;
      }

      // Pause snapshots until the connection can accept more output.
      if (!response.write(frame)) {
        waitingForDrain = true;

        slowReaderTimer = setTimeout(() => {
          response.destroy();
        }, slowReaderMs);

        slowReaderTimer.unref();
      }

      if (finished && !waitingForDrain) {
        cleanup();
        response.end();
      }
    }

    function drain() {
      waitingForDrain = false;
      clearTimeout(slowReaderTimer);

      send();
    }

    const snapshotInterval = setInterval(send, intervalMs);
    snapshotInterval.unref();

    response.on('drain', drain);
    response.on('close', disconnected);
    response.on('error', disconnected);

    closeCurrent = () => {
      cleanup();
      response.destroy();
    };

    sendCurrent = send;

    send();
  }

  function finish() {
    finished = true;
    clearTimeout(graceTimer);

    sendCurrent?.();
  }

  function close() {
    finished = true;
    clearTimeout(graceTimer);

    closeCurrent?.();
  }

  return { connect, finish, close };
}
