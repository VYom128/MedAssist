import cron, { type ScheduledTask } from 'node-cron';
import { JOB_RULES } from '../config/constants.js';
import { config } from '../config/env.js';
import { getSettings } from '../modules/settings/service.js';
import { logger, serializeError } from '../utils/logger.js';
import { runNoShowJob } from './noShow.job.js';
import { runReminderJob } from './reminders.job.js';

/**
 * Background jobs (spec §8.11) with node-cron in the clinic timezone. Only when
 * JOBS_ENABLED=true, and on one API instance only (no distributed lock yet). The job functions
 * are plain exports so tests call them with a fixed `now`. A timezone change in settings takes
 * effect after a restart.
 */

const JOBS = [
  { name: 'reminders', run: runReminderJob },
  { name: 'no-show', run: runNoShowJob },
] as const;

/** Runs a job; never throws (a failing job must not take the server down). */
async function safely(name: string, run: (now: Date) => Promise<unknown>) {
  try {
    await run(new Date());
  } catch (err) {
    logger.error({ err: serializeError(err), job: name }, 'Job failed');
  }
}

/** Schedules the jobs if enabled. @returns a function that stops them (graceful shutdown). */
export async function startJobs(): Promise<() => Promise<void>> {
  if (!config.jobs.enabled) {
    logger.info('Background jobs are off (JOBS_ENABLED=false)');
    return async () => undefined;
  }
  const { timezone } = await getSettings();
  const tasks: ScheduledTask[] = JOBS.map(({ name, run }) =>
    cron.schedule(JOB_RULES.every15Minutes, () => safely(name, run), {
      name,
      timezone,
      noOverlap: true,
    }),
  );
  logger.info({ jobs: JOBS.map((j) => j.name), timezone }, 'Background jobs scheduled');
  return async () => {
    await Promise.all(tasks.map((t) => t.stop()));
  };
}
