// Connection checks must run on every request, not during the site build.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:4000";
    const readinessUrl = new URL("/ready", apiOrigin);
    const response = await fetch(readinessUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000)
    });
    const health = await response.json();
    const isReady = response.ok && health.status === "ok" && health.database === "connected";

    if (!isReady) {
      throw new Error("API is not ready");
    }
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    // Keep internal addresses and database errors out of browser responses.
    return Response.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
