import cron, { type ScheduledTask } from 'node-cron';
import { JOB_RULES } from '../config/constants.js';
import { config } from '../config/env.js';
import { getSettings } from '../modules/settings/service.js';
import { logger, serializeError } from '../utils/logger.js';
import { runFollowUpReminderJob } from './followUpReminders.job.js';
import { runLabTatJob } from './labTat.job.js';
import { runNoShowJob } from './noShow.job.js';
import { runPrescriptionCompletionJob } from './prescriptionCompletion.job.js';
import { runReminderJob } from './reminders.job.js';

/**
 * Background jobs (spec §8.11) with node-cron in the clinic timezone. Only when
 * JOBS_ENABLED=true, and on one API instance only (no distributed lock yet). The job functions
 * are plain exports so tests call them with a fixed `now`. A timezone change in settings takes
 * effect after a restart.
 */

export const JOBS = [
  { name: 'reminders', rule: JOB_RULES.every15Minutes, run: runReminderJob },
  { name: 'no-show', rule: JOB_RULES.every15Minutes, run: runNoShowJob },
  {
    name: 'prescription-completion',
    rule: JOB_RULES.daily0200,
    run: runPrescriptionCompletionJob,
  },
  { name: 'lab-tat', rule: JOB_RULES.hourly, run: runLabTatJob },
  { name: 'follow-up-reminders', rule: JOB_RULES.daily0900, run: runFollowUpReminderJob },
] as const;

/** Runs a job; never throws (a failing job must not take the server down). */
async function safely(name: string, run: (now: Date) => Promise<unknown>) {
  try {
    await run(new Date());
  } catch (err) {
    logger.error({ err: serializeError(err), job: name }, 'Job failed');
  }
}

/**
 * Runs every job once, one after the other (never throws). Called at start-up: cron does not
 * replay ticks missed while the instance slept (Render free tier), and every job catches up from
 * its own timestamps and claims, so an extra run is always safe (D202).
 */
export async function catchUpJobs(now = new Date()): Promise<void> {
  for (const { name, run } of JOBS) await safely(name, () => run(now));
}

/**
 * Schedules the jobs if enabled and starts one catch-up run in the background.
 * @returns a function that stops them (graceful shutdown).
 */
export async function startJobs(): Promise<() => Promise<void>> {
  if (!config.jobs.enabled) {
    logger.info('Background jobs are off (JOBS_ENABLED=false)');
    return async () => undefined;
  }
  const { timezone } = await getSettings();
  const tasks: ScheduledTask[] = JOBS.map(({ name, rule, run }) =>
    cron.schedule(rule, () => safely(name, run), {
      name,
      timezone,
      noOverlap: true,
    }),
  );
  logger.info({ jobs: JOBS.map((j) => j.name), timezone }, 'Background jobs scheduled');
  void catchUpJobs();
  return async () => {
    await Promise.all(tasks.map((t) => t.stop()));
  };
}
