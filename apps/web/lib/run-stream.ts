import { parseRunSnapshot, type RunSnapshot } from '@ratelab/contracts';

export async function readRunStream(body: ReadableStream<Uint8Array>, onSnapshot: (run: RunSnapshot) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Stream ended before the final snapshot');
      if (value.byteLength > 256 * 1_024) throw new Error('Stream chunk exceeds budget');
      pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        if (frame.length > 64 * 1_024) throw new Error('Event exceeds budget');
        const lines = frame.split('\n');
        if (!lines.includes('event: snapshot')) continue;
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        const run = parseRunSnapshot(JSON.parse(data));
        onSnapshot(run);
        if (['completed', 'stopped'].includes(run.status)) return;
      }
      if (pending.length > 64 * 1_024) throw new Error('Event exceeds budget');
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function watchRun(token: string, signal: AbortSignal,
  onSnapshot: (run: RunSnapshot) => void, onConnection: (connected: boolean) => void) {
  while (!signal.aborted) {
    const connection = new AbortController();
    let idle = setTimeout(() => connection.abort(), 15_000);
    try {
      const response = await fetch('/api/runs/events', { headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store', signal: AbortSignal.any([signal, connection.signal]) });
      if (response.status === 404) { await response.body?.cancel(); onConnection(false); return; }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Stream unavailable'); }
      onConnection(true);
      await readRunStream(response.body, (snapshot) => {
        clearTimeout(idle);
        idle = setTimeout(() => connection.abort(), 15_000);
        onSnapshot(snapshot);
      });
      return;
    } catch {
      clearTimeout(idle);
      connection.abort();
      if (signal.aborted) return;
      onConnection(false);
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 1_000);
        signal.addEventListener('abort', done, { once: true });
      });
    } finally { clearTimeout(idle); connection.abort(); }
  }
}
