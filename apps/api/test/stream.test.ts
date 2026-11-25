import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { CoordinatorGateway } from "../dist/coordinator/gateway.js";

describe("Server-Sent Events (SSE) Streaming Pipeline", () => {
  const coordPort = 4090;
  const coordinator = new CoordinatorGateway({
    port: coordPort,
    spawnWorkers: true,
    instances: [
      { id: "instance-1", url: "http://localhost:4091" },
      { id: "instance-2", url: "http://localhost:4092" },
      { id: "instance-3", url: "http://localhost:4093" },
    ],
    mode: "per-instance",
    algorithm: "fixed-window",
    limit: 100,
    windowSizeMs: 60_000,
    tickIntervalMs: 50,
    heartbeatIntervalMs: 500,
  });

  const baseUrl = `http://localhost:${coordPort}`;

  before(async () => {
    await coordinator.start();
  });

  after(async () => {
    await coordinator.stop();
  });

  it("establishes SSE connection with standard headers and handshake", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/stream/metrics`, {
      signal: controller.signal,
    });

    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));
    assert.ok(res.headers.get("cache-control")?.includes("no-cache"));
    assert.equal(res.headers.get("connection"), "keep-alive");

    const reader = res.body?.getReader();
    assert.ok(reader);

    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const initialText = decoder.decode(value);

    assert.ok(initialText.includes("retry: 1000"));
    assert.ok(initialText.includes(": connected"));

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it("streams real-time aggregated metric ticks to connected SSE clients", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/stream/metrics`, {
      signal: controller.signal,
    });

    const reader = res.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();

    // Send 3 requests to coordinator to be aggregated
    await fetch(`${baseUrl}/api/check`, { headers: { "x-client-id": "client-stream-1" } });
    await fetch(`${baseUrl}/api/check`, { headers: { "x-client-id": "client-stream-2" } });
    await fetch(`${baseUrl}/api/check`, { headers: { "x-client-id": "client-stream-3" } });

    // Read chunks until a tick containing requests arrives
    let buffer = "";
    let receivedTick: any = null;

    const timeout = Date.now() + 2000;
    while (Date.now() < timeout && !receivedTick) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");

      for (let i = 0; i < lines.length - 1; i++) {
        const block = lines[i];
        const dataMatch = block.match(/data:\s*(\{.*\})/);
        if (dataMatch) {
          try {
            const parsed = JSON.parse(dataMatch[1]);
            if (parsed.totalCount > 0) {
              receivedTick = parsed;
              break;
            }
          } catch {
            // Incomplete JSON or other event
          }
        }
      }
      buffer = lines[lines.length - 1];
    }

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(receivedTick, "Expected to receive aggregated tick with data");
    assert.ok(receivedTick.tickId > 0);
    assert.ok(receivedTick.totalCount >= 1);
    assert.equal(receivedTick.allowedCount, receivedTick.totalCount);
    assert.ok(receivedTick.recentSamples.length >= 1);
  });

  it("broadcasts periodic heartbeat comments to keep connections alive", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/stream/metrics`, {
      signal: controller.signal,
    });

    const reader = res.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();

    coordinator.metricsStream.broadcastHeartbeat();

    let text = "";
    const timeout = Date.now() + 1000;
    while (Date.now() < timeout && !text.includes(": ping")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(text.includes(": ping"), "Expected SSE heartbeat ping");
  });

  it("tracks active client count and cleans up on disconnection", async () => {
    for (let i = 0; i < 10 && coordinator.metricsStream.clientCount() > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const initialCount = coordinator.metricsStream.clientCount();

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/stream/metrics`, {
      signal: controller.signal,
    });
    assert.ok(res.ok);

    assert.equal(coordinator.metricsStream.clientCount(), initialCount + 1);

    controller.abort();
    for (let i = 0; i < 10 && coordinator.metricsStream.clientCount() !== initialCount; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(coordinator.metricsStream.clientCount(), initialCount);
  });
});
