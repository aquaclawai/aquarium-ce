import type { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { config } from '../config.js';
import { getApiRateLimits, getCorsOrigins } from '../services/system-config.js';

let generalLimiter: RequestHandler = createRateLimiter(15 * 60 * 1000, 300);
let loginLimiter: RequestHandler = createRateLimiter(15 * 60 * 1000, 10, true);
let credentialsLimiter: RequestHandler = createRateLimiter(60 * 1000, 30);
let corsHandler: RequestHandler = cors({ origin: config.corsOrigin, credentials: true });

function createRateLimiter(windowMs: number, max: number, skipSuccessful = false): RequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false, xForwardedForHeader: false },
    ...(skipSuccessful ? { skipSuccessfulRequests: true } : {}),
  });
}

export const dynamicGeneralLimiter: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  generalLimiter(req, res, next);
};

export const dynamicLoginLimiter: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  loginLimiter(req, res, next);
};

export const dynamicCredentialsLimiter: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  credentialsLimiter(req, res, next);
};

export const dynamicCors: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  corsHandler(req, res, next);
};

export async function reloadDynamicMiddleware(): Promise<void> {
  try {
    const limits = await getApiRateLimits();
    generalLimiter = createRateLimiter(limits.general.windowMs, limits.general.max);
    loginLimiter = createRateLimiter(limits.login.windowMs, limits.login.max, true);
    credentialsLimiter = createRateLimiter(limits.credentials.windowMs, limits.credentials.max);

    const extraOrigins = await getCorsOrigins();
    const allOrigins = [config.corsOrigin, ...extraOrigins].filter(Boolean);
    corsHandler = cors({ origin: allOrigins, credentials: true });

    console.log('[DynamicMiddleware] Reloaded rate limits and CORS config');
  } catch (err) {
    console.error('[DynamicMiddleware] Failed to reload:', err);
  }
}
