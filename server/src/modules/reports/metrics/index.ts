/**
 * The shared metric definitions (spec §14, Phase 10): dashboards and reports call these same
 * functions, so a number on a dashboard always equals the matching report total. All are server
 * aggregations over clinic-timezone ranges; money in integer paise.
 */
export * from './appointments.js';
export * from './ai.js';
export * from './labTat.js';
export * from './patients.js';
export * from './range.js';
export * from './revenue.js';
export * from './utilisation.js';
