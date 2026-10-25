import { parseHealthResponse } from '@ratelab/contracts';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  let upstream: Response;
  try {
    upstream = await fetch(new URL('/health', process.env.API_ORIGIN ?? 'http://127.0.0.1:3001'), {
      cache: 'no-store', signal: AbortSignal.timeout(3_000), redirect: 'error',
    });
    if (!upstream.ok) {
      return Response.json({ error: 'API_UNAVAILABLE' }, { status: 503, headers });
    }
  } catch {
    return Response.json({ error: 'API_UNAVAILABLE' }, { status: 503, headers });
  }
  try {
    return Response.json(parseHealthResponse(await upstream.json()), { headers });
  } catch {
    return Response.json({ error: 'API_INCOMPATIBLE' }, { status: 502, headers });
  }
}
