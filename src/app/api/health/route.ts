export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    service: "equity-radar",
    convex: process.env.NEXT_PUBLIC_CONVEX_URL ? "configured" : "missing",
    ts: new Date().toISOString(),
  });
}
