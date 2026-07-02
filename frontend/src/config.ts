// ── Frontend runtime config ──────────────────────────────────────────────────────
// In production the SPA is served by Caddy on the same origin as the API
// (`/api/*` and `/socket.io/*` are proxied to the backend), so the defaults are
// RELATIVE and need no configuration. Set the VITE_* vars only for a split
// API-domain deployment. In local dev, vite.config.ts proxies these paths to
// the backend, so the same relative defaults work there too.

// Base path for REST calls, e.g. `${API_BASE}/auth/login`.
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Socket.io origin. `undefined` → socket.io connects to the page origin.
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined;
