import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { apiRouter } from './server/routes';

async function startServer() {
  const app = express();
  const port = parseInt(process.env.PORT || '3000', 10);
  const isProd = process.env.NODE_ENV === 'production';

  // 1. Security & Anti-Scraping Headers
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Anti-scraping and privacy: block search indexing of private app instances & API
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    next();
  });

  // 2. Anti-Scraping & Rate Limiting Middleware
  const requestCounts = new Map<string, { count: number; resetTime: number }>();
  const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
  const MAX_REQUESTS_PER_WINDOW = 200; // 200 requests per minute per IP

  app.use((req, res, next) => {
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    
    // Block common malicious scrapers and brute-force bots
    const blockedScrapers = ['scrapy', 'nikto', 'sqlmap', 'censys', 'shodan', 'zgrab', 'masscan'];
    if (blockedScrapers.some(bot => userAgent.includes(bot))) {
      res.status(403).json({ success: false, error: 'Access denied by anti-scraping security guard.' });
      return;
    }

    // IP-based rate limiting
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const clientRecord = requestCounts.get(ip);

    if (!clientRecord || now > clientRecord.resetTime) {
      requestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    } else {
      clientRecord.count++;
      if (clientRecord.count > MAX_REQUESTS_PER_WINDOW) {
        res.status(429).json({
          success: false,
          error: 'Rate limit exceeded. System protected against automated scraping.'
        });
        return;
      }
    }

    // Clean up stale entries every 500 requests
    if (requestCounts.size > 1000) {
      for (const [key, val] of requestCounts.entries()) {
        if (now > val.resetTime) requestCounts.delete(key);
      }
    }

    next();
  });

  app.use(express.json({ limit: '35mb' }));
  app.use(express.urlencoded({ limit: '35mb', extended: true }));

  // 3. Secure Uploads Handling (Strict Path Traversal Protection)
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  app.use('/uploads', (req, res, next) => {
    // Sanitize filename to prevent any ../ directory traversal
    const safeName = path.basename(req.path);
    const targetFile = path.join(uploadsDir, safeName);

    if (!targetFile.startsWith(uploadsDir) || !fs.existsSync(targetFile)) {
      res.status(404).send('Not found');
      return;
    }
    res.sendFile(targetFile);
  });

  // Mount API router
  app.use('/api', apiRouter);

  // Vite integration
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`BrandLens full-stack server running on port ${port} (${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
