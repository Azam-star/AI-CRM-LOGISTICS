import { createHmac, timingSafeEqual } from 'crypto';
import { Router, type Request, type RequestHandler } from 'express';

const SESSION_COOKIE = 'freightdesk_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

export interface AuthConfig {
  email: string;
  password: string;
  secret: string;
  secureCookie: boolean;
}

interface SessionPayload {
  email: string;
  expiresAt: number;
}

export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;
  const secret = env.AUTH_SECRET;

  if (!email || !password || !secret) {
    throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD, and AUTH_SECRET before starting the server');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters long');
  }
  if (secret.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters long');
  }

  return {
    email,
    password,
    secret,
    secureCookie: env.NODE_ENV === 'production',
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(email: string, secret: string, now = Date.now()): string {
  const payload: SessionPayload = {
    email,
    expiresAt: now + SESSION_DURATION_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifySessionToken(token: string, config: AuthConfig, now = Date.now()): boolean {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const encoded = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  if (!safeEqual(suppliedSignature, signature(encoded, config.secret))) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    return payload.email === config.email && Number.isFinite(payload.expiresAt) && payload.expiresAt > now;
  } catch {
    return false;
  }
}

function cookieHeader(config: AuthConfig, token?: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token ?? ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${token ? SESSION_DURATION_MS / 1000 : 0}`,
  ];
  if (config.secureCookie) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(req: Request, name: string): string | undefined {
  const cookies = req.headers.cookie?.split(';') ?? [];
  const entry = cookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
  return entry?.trim().slice(name.length + 1);
}

export function requireAuth(config: AuthConfig): RequestHandler {
  return (req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token || !verifySessionToken(token, config)) {
      res.status(401).set('Cache-Control', 'no-store').json({ error: 'Authentication required' });
      return;
    }
    next();
  };
}

export function createAuthRouter(config: AuthConfig): Router {
  const router = Router();
  const failedAttempts = new Map<string, { count: number; resetAt: number }>();

  router.post('/auth/login', (req, res) => {
    res.set('Cache-Control', 'no-store');

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const attempts = failedAttempts.get(ip);
    if (attempts && attempts.resetAt > now && attempts.count >= MAX_LOGIN_ATTEMPTS) {
      res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
      return;
    }

    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (email.length > 320 || password.length > 1024) {
      res.status(400).json({ error: 'Invalid email or password' });
      return;
    }

    const validEmail = safeEqual(email, config.email);
    const validPassword = safeEqual(password, config.password);
    if (!validEmail || !validPassword) {
      const nextAttempts = attempts && attempts.resetAt > now ? attempts : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
      nextAttempts.count += 1;
      failedAttempts.set(ip, nextAttempts);
      res.status(401).json({ error: 'Email or password is incorrect' });
      return;
    }

    failedAttempts.delete(ip);
    const token = createSessionToken(config.email, config.secret, now);
    res.setHeader('Set-Cookie', cookieHeader(config, token));
    res.json({ user: { email: config.email } });
  });

  router.post('/auth/logout', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', cookieHeader(config));
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAuth(config), (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: { email: config.email } });
  });

  return router;
}
