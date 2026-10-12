import { formatInTimeZone } from 'date-fns-tz';
import type { EmailTemplate } from '../email.templates.js';
import { formatClinicDateTime } from '../../utils/dates.js';
import type { NotificationData } from '../notificationData.js';

/**
 * Shared layout of the notification emails (spec §10.3, §11): a subject, one or two short
 * sentences, the clinic's name and a "Log in to view" button. Templates read only `data` (ids,
 * numbers, dates, statuses – checked by notificationData.ts), never the in-app title or body, so
 * no clinical details, drug names, results or amounts can reach an email.
 */

export interface NotificationEmailContext {
  clinicName: string;
  timezone: string;
  /** Absolute URL of the page to open (CLIENT_URL + link), when there is one. */
  url?: string;
  data: NotificationData;
  /** Greeting name – account emails only. */
  name?: string;
}

export type NotificationEmailTemplate = (c: NotificationEmailContext) => EmailTemplate;

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** '05 Oct 2026, 9:00 AM' in the clinic timezone, from an ISO instant in `data`. */
export function when(c: NotificationEmailContext, key = 'startAt'): string {
  const value = c.data[key];
  if (typeof value !== 'string') return 'the booked time';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'the booked time' : formatClinicDateTime(d, c.timezone);
}

/** '05 Oct 2026' from a calendar date in `data` (stored as UTC midnight or 'YYYY-MM-DD'). */
export function day(c: NotificationEmailContext, key: string): string {
  const value = c.data[key];
  if (typeof value !== 'string') return 'soon';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'soon' : formatInTimeZone(d, 'UTC', 'dd MMM yyyy');
}

/** A value from `data` as text ('' when missing). */
export const field = (c: NotificationEmailContext, key: string) => {
  const v = c.data[key];
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
};

export function simpleEmail(
  c: NotificationEmailContext,
  {
    subject,
    lines,
    button = 'Log in to view',
  }: { subject: string; lines: string[]; button?: string },
): EmailTemplate {
  const clinic = c.clinicName || 'MedAssist';
  const greeting = c.name ? `Hello ${c.name},` : 'Hello,';
  const text = [
    greeting,
    '',
    ...lines,
    ...(c.url ? ['', `${button}: ${c.url}`] : []),
    '',
    clinic,
  ].join('\n');
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">` +
    `<p>${escapeHtml(greeting)}</p>` +
    lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('') +
    (c.url
      ? `<p><a href="${escapeHtml(c.url)}" style="background:#0b6bcb;color:#fff;padding:10px 16px;` +
        `border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(button)}</a></p>`
      : '') +
    `<p style="color:#64748b;font-size:13px">${escapeHtml(clinic)}</p></div>`;
  return { subject, text, html, links: c.url ? [c.url] : [] };
}
