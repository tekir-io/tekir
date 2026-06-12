/**
 * A collection of commonly-used cron expressions as named constants and
 * helper functions for readable schedule definitions.
 *
 * @example
 * ```ts
 * await cron.add('cleanup', Patterns.daily, () => removeOldFiles())
 * await cron.add('report', Patterns.weeklyOn(1, 9, 0), () => sendReport())
 * ```
 */
export const Patterns = {
  // Every second
  everySecond: '* * * * * *',
  // Every minute
  everyMinute: '0 * * * * *',
  // Every 5 minutes
  everyFiveMinutes: '0 */5 * * * *',
  // Every 10 minutes
  everyTenMinutes: '0 */10 * * * *',
  // Every 15 minutes
  everyFifteenMinutes: '0 */15 * * * *',
  // Every 30 minutes
  everyThirtyMinutes: '0 */30 * * * *',
  // Every hour at minute 0
  hourly: '0 0 * * * *',
  // Every day at midnight
  daily: '0 0 0 * * *',

  /**
   * Every day at a specific hour and minute.
   * @param hour   0–23
   * @param minute 0–59 (default 0)
   */
  dailyAt: (hour: number, minute = 0): string =>
    `0 ${minute} ${hour} * * *`,

  /** Every Sunday at midnight — `0 0 0 * * 0` */
  weekly: '0 0 0 * * 0',

  /**
   * Every week on a specific day, hour, and minute.
   * @param day    0 = Sunday … 6 = Saturday
   * @param hour   0–23 (default 0)
   * @param minute 0–59 (default 0)
   */
  weeklyOn: (day: number, hour = 0, minute = 0): string =>
    `0 ${minute} ${hour} * * ${day}`,

  /** First day of every month at midnight — `0 0 0 1 * *` */
  monthly: '0 0 0 1 * *',

  /** First day of January every year at midnight — `0 0 0 1 1 *` */
  yearly: '0 0 0 1 1 *',
} as const
