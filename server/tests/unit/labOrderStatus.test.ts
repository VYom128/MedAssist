import { derivedOrderStatus } from '../../src/modules/labOrders/status.js';

const items = (...statuses: string[]) => statuses.map((status) => ({ status }));

describe('derivedOrderStatus (spec §5.4)', () => {
  it('every test cancelled → cancelled (drafts and cancelled orders stay)', () => {
    expect(derivedOrderStatus({ status: 'ordered', items: items('cancelled', 'cancelled') })).toBe(
      'cancelled',
    );
    expect(derivedOrderStatus({ status: 'processing', items: items('cancelled') })).toBe(
      'cancelled',
    );
    expect(derivedOrderStatus({ status: 'draft', items: items('cancelled') })).toBe('draft');
    expect(derivedOrderStatus({ status: 'cancelled', items: items('pending') })).toBe('cancelled');
  });

  it('processing → result_entered once every open test has results', () => {
    expect(
      derivedOrderStatus({ status: 'processing', items: items('result_entered', 'cancelled') }),
    ).toBe('result_entered');
    expect(
      derivedOrderStatus({ status: 'processing', items: items('result_entered', 'pending') }),
    ).toBe('processing');
  });

  it('otherwise unchanged', () => {
    expect(derivedOrderStatus({ status: 'ordered', items: items('pending', 'cancelled') })).toBe(
      'ordered',
    );
    expect(derivedOrderStatus({ status: 'sample_collected', items: items('result_entered') })).toBe(
      'sample_collected',
    );
    expect(derivedOrderStatus({ status: 'released', items: items('verified') })).toBe('released');
  });
});
