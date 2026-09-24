/**
 * Shared chart look for Phase 10 dashboards and reports (Recharts is not installed yet; pass
 * these values to its props when it is). One highlighted series in primary, the rest in tints;
 * light grid, muted axes, values in tabular figures.
 */
export const CHART_COLORS = [
  '#4f5bd5', // primary-600
  '#3b82f6', // info-500
  '#10b981', // success-500
  '#f59e0b', // warning-500
  '#8b5cf6', // consult-500
  '#f43f5e', // danger-500
  '#8a93a6', // neutral-500
] as const;

/** Bars that are not the highlighted one (e.g. other months). */
export const CHART_MUTED_FILL = '#e0e3fb'; // primary-100

export const CHART_THEME = {
  grid: { stroke: '#e6e8f0', strokeDasharray: '4 4', vertical: false },
  axis: {
    stroke: '#e6e8f0',
    tick: { fill: '#5b6478', fontSize: 12 },
    tickLine: false,
    axisLine: false,
  },
  tooltip: {
    contentStyle: {
      background: '#ffffff',
      border: '1px solid #e6e8f0',
      borderRadius: 12,
      boxShadow: '0 4px 12px -2px rgb(16 24 40 / 0.08)',
      fontSize: 13,
      color: '#1e293b',
    },
    cursor: { fill: '#eef0fd' },
  },
  bar: { radius: [8, 8, 0, 0] as [number, number, number, number], maxBarSize: 48 },
  line: { strokeWidth: 2.5, dot: false },
} as const;
