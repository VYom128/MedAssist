import { simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** queue.your_turn (in-app by default). */
export const queueYourTurn: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'You are next',
    lines: ['You are next in the queue. Please stay close to the consultation room.'],
  });
