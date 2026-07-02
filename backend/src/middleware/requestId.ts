import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

// ── Request correlation id ───────────────────────────────────────────────────────
// Assigns a unique id to every request and echoes it in the `X-Request-Id`
// response header. This is how a production issue is traced: find the request id
// (from the client's response header or an HTTP log line) and grep the logs for
// it — rather than dumping raw query parameters. Honours an inbound X-Request-Id
// so ids can be propagated from an upstream proxy/load balancer.
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('X-Request-Id');
  const id = inbound && inbound.length <= 200 ? inbound : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
