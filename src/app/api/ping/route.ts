/**
 * Answered without touching the database. Open pages call it every few minutes so the free hosting
 * plan does not put the server to sleep while someone is filling in a form: a form sent to a
 * sleeping server is answered by the host's wake-up page, not by the app, and nothing is saved.
 */
export function GET() {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
