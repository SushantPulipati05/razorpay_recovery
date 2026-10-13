import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Compares two secrets in constant time. A plain `a === b` stops at the first
 * different character, so response timing can leak how much of a guess was
 * right. Hashing first also makes the lengths equal, which timingSafeEqual needs.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Protects endpoints that message customers or expose their data. Requests must
 * send the admin key in the `x-admin-key` header. With no key configured, it is
 * allowed only outside production (local demos); production refuses to start
 * without a key (see config/env.ts), and this rejects as a second line of defence.
 */
export function adminAuth(opts: { key: string; production: boolean }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!opts.key) {
      if (opts.production) {
        res.status(503).json({ error: 'Admin API key is not configured' });
        return;
      }
      next(); // local development without a key
      return;
    }
    const provided = req.headers['x-admin-key'];
    if (typeof provided !== 'string' || !safeEqual(provided, opts.key)) {
      res.status(401).json({ error: 'Missing or invalid x-admin-key' });
      return;
    }
    next();
  };
}