/**
 * logger.ts
 *
 * Tiny structured logger that respects the LOG_LEVEL env var.
 * Uses stderr so it never contaminates the MCP stdio transport.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const configured = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase() as Level;
const threshold = LEVELS[configured] ?? LEVELS.info;

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta,
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info:  (msg: string, meta?: Record<string, unknown>) => log('info',  msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => log('warn',  msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
