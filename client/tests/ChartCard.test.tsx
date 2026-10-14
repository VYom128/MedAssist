import { render, screen } from '@testing-library/react';
import ChartCard from '../src/components/ui/ChartCard';

/**
 * Charts and assistive technology (spec §13.3, WCAG 2.1 AA): with a text summary the chart is
 * hidden from screen readers AND out of the tab order (axe aria-hidden-focus) – Recharts makes
 * its surface focusable, here stood in for by a button.
 */
describe('ChartCard', () => {
  const chart = <button type="button">chart surface</button>;

  it('with a summary: the summary is read, the chart is hidden and inert', () => {
    render(
      <ChartCard title="Revenue" summary="₹1,200 collected this week">
        {chart}
      </ChartCard>,
    );
    expect(screen.getByText('₹1,200 collected this week')).toHaveClass('sr-only');
    const surface = screen.getByText('chart surface').parentElement!;
    expect(surface).toHaveAttribute('aria-hidden', 'true');
    expect(surface).toHaveAttribute('inert');
    expect(screen.queryByRole('button', { name: 'chart surface' })).not.toBeInTheDocument();
  });

  it('without a summary: the chart stays reachable', () => {
    render(<ChartCard title="Revenue">{chart}</ChartCard>);
    const surface = screen.getByText('chart surface').parentElement!;
    expect(surface).not.toHaveAttribute('aria-hidden');
    expect(surface).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'chart surface' })).toBeInTheDocument();
  });
});
