import express from 'express';
import { config } from './config';
import { closePool } from './db/connection';
import { errorHandler } from './middleware/errorHandler';
import transactionsRouter from './routes/transactions';
import categoriesRouter from './routes/categories';
import analyticsRouter from './routes/analytics';

const app = express();

// ─── Global Middleware ───────────────────────────────────────────────

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging (non-production)
if (!config.isProduction) {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ─── Health Check ────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Routes ──────────────────────────────────────────────────────

app.use('/api/transactions', transactionsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/analytics', analyticsRouter);

// ─── 404 Handler ─────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ status: 404, message: 'Endpoint not found' });
});

// ─── Global Error Handler ────────────────────────────────────────────

app.use(errorHandler);

// ─── Server Startup ──────────────────────────────────────────────────

const server = app.listen(config.port, () => {
  console.log(`Expense Backend running on port ${config.port} [${config.nodeEnv}]`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    await closePool();
    console.log('Database pool closed. Goodbye.');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
