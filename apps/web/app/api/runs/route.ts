import { parseRunConfig, parseRunSnapshot } from '@ratelab/contracts';

async function forward(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  const url = new URL(request.url);
  if (url.search) return Response.json({ error: 'QUERY_NOT_SUPPORTED' }, { status: 400, headers });
  if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) {
    return Response.json({ error: 'ORIGIN_NOT_ALLOWED' }, { status: 403, headers });
  }
  const authorization = request.headers.get('authorization');
  if (request.method !== 'POST' && !/^Bearer [a-f0-9]{64}$/.test(authorization ?? '')) {
    return Response.json({ error: 'RUN_NOT_FOUND' }, { status: 404, headers });
  }
  let body: string | undefined;
  if (request.method === 'POST') {
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new Error('Missing body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1_024) throw new Error('Body too large');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const config = parseRunConfig(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      body = JSON.stringify(config);
    } catch {
      return Response.json({ error: 'INVALID_CONFIG' }, { status: 400, headers });
    }
  }
  try {
    const upstream = await fetch(new URL('/runs', process.env.API_ORIGIN ?? 'http://127.0.0.1:3001'), {
      method: request.method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: { 'Content-Type': 'application/json', 'X-RateLab-Request': '1',
        ...(authorization ? { Authorization: authorization } : {}) },
      ...(body ? { body } : {}),
    });
    if (!upstream.ok) {
      const status = [400, 403, 404, 503].includes(upstream.status) ? upstream.status : 502;
      await upstream.body?.cancel();
      return Response.json({ error: 'RUN_REQUEST_FAILED' }, { status, headers });
    }
    const data = await upstream.json();
    if (request.method === 'POST') {
      if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) {
        throw new Error('Invalid run credential');
      }
      return Response.json({ run: parseRunSnapshot(data.run), token: data.token }, { status: 201, headers });
    }
    return Response.json(parseRunSnapshot(data), { headers });
  } catch {
    return Response.json({ error: 'RUN_API_UNAVAILABLE' }, { status: 503, headers });
  }
}

export async function POST(request: Request) { return forward(request); }
export async function GET(request: Request) { return forward(request); }
export async function DELETE(request: Request) { return forward(request); }
