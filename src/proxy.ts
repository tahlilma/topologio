import { NextResponse, type NextRequest } from 'next/server';

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Rejects API writes sent from another site. Session cookies are SameSite=Lax, which
 * already stops most cross-site requests; this is the second lock. Requests without an
 * Origin header (non-browser clients) carry no victim's cookie, so they pass.
 */
function crossSiteWrite(req: NextRequest) {
  if (!WRITE.has(req.method)) return false;
  if (req.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** A per-request nonce lets Next's own scripts run while blocking injected ones. */
function withCsp(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  // Inline style attributes (pip fills, tooltips) need 'unsafe-inline' for styles only;
  // a style nonce would switch that off, so styles do not get one.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    if (crossSiteWrite(req)) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
    return NextResponse.next();
  }
  return withCsp(req);
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
