/** 
 * Log level: `'silent'` (no output), `'info'` (info only), or `'debug'` (debug only). 
 * */
export type LogLevel = 'silent' | 'info' | 'debug';

/**
 * Simple logging utility with configurable verbosity.
 *
 * @example
 * ```typescript
 * const logger = new Logger('info');
 * logger.info('Reflow started', { count: 10 });
 * ```
 */
export class Logger {
  /**
   * @param level - Logging level (default: `'info'`)
   */
  constructor(private readonly level: LogLevel = 'info') {}

  /**
   * Log an info message. Outputs only if level is `'info'`.
   * @param msg - Message to log
   * @param meta - Optional metadata object
   */
  info(msg: string, meta?: Record<string, unknown>): void {
    if (this.level === 'silent') return;
    console.log(`[INFO] ${msg}`, meta ?? '');
  }

  /**
   * Log a debug message. Outputs only if level is `'debug'`.
   * @param msg - Message to log
   * @param meta - Optional metadata object
   */
  debug(msg: string, meta?: Record<string, unknown>): void {
    if (this.level !== 'debug') return;
    console.log(`[DEBUG] ${msg}`, meta ?? '');
  }

  
  /**
   * Logs tabular data to the console. If the logging level is set to 'silent', no output is produced.
   * The method uses `console.table` if available; otherwise, it falls back to `console.log`.
   *
   * @param data - The data to be displayed in tabular format. Can be of any type.
   * @param title - An optional title to display above the table. If provided, it is prefixed with the logging level.
   */
  table(data: unknown, title?: string): void {
    if (this.level === 'silent') {
      return;
    }

    const prefix = this.level === 'debug' ? '[DEBUG]' : '[INFO]';
    
    if (title) {
      console.log(`${prefix} ${title}`);
    }

    if (typeof console.table === 'function') {
      // console.table has a loose typing, cast to any to avoid TS complaints
      console.table(data);
    } else {
      console.log(`${prefix} table:`, data);
    }
  }
}
