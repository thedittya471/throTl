export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store, no-transform' };
  const authorization = request.headers.get('authorization');
  if (new URL(request.url).search || !/^Bearer [a-f0-9]{64}$/.test(authorization ?? '')) {
    return Response.json({ error: 'RUN_NOT_FOUND' }, { status: 404, headers });
  }
  const controller = new AbortController();
  const handshake = setTimeout(() => controller.abort(), 5_000);
  try {
    const upstream = await fetch(new URL('/runs/events', process.env.API_ORIGIN ?? 'http://127.0.0.1:3001'), {
      headers: { Authorization: authorization!, 'X-RateLab-Request': '1' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.any([request.signal, controller.signal]),
    });
    clearTimeout(handshake);
    if (!upstream.ok || !upstream.body || !upstream.headers.get('content-type')?.startsWith('text/event-stream')) {
      await upstream.body?.cancel();
      controller.abort();
      return Response.json({ error: 'RUN_STREAM_UNAVAILABLE' }, { status: upstream.status === 404 ? 404 : 503, headers });
    }
    const reader = upstream.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          const { done, value } = await reader.read();
          if (done) { reader.releaseLock(); output.close(); return; }
          if (value.byteLength > 256 * 1_024) throw new Error('Stream chunk exceeds budget');
          output.enqueue(value);
        } catch {
          controller.abort();
          output.error(new Error('Run stream disconnected'));
        }
      },
      async cancel() { controller.abort(); await reader.cancel().catch(() => {}); },
    }, { highWaterMark: 0 });
    return new Response(body, { headers: { ...headers, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' } });
  } catch {
    controller.abort();
    return Response.json({ error: 'RUN_STREAM_UNAVAILABLE' }, { status: 503, headers });
  } finally { clearTimeout(handshake); }
}
