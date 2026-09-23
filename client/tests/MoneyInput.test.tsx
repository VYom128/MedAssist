import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import MoneyInput from '../src/components/ui/MoneyInput';

function Harness({ initial = null }: { initial?: number | null }) {
  const [paise, setPaise] = useState<number | null>(initial);
  return (
    <>
      <MoneyInput label="Fee" value={paise} onChange={setPaise} />
      <output aria-label="paise">{paise === null ? 'null' : String(paise)}</output>
    </>
  );
}

describe('MoneyInput', () => {
  it('the user types rupees; the value is integer paise', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Fee');
    const paise = screen.getByLabelText('paise');

    await user.type(input, '1,250.5');
    expect(paise).toHaveTextContent('125050');

    await user.clear(input);
    await user.type(input, '499.995');
    expect(paise).toHaveTextContent('50000'); // half-up, no float drift

    await user.clear(input);
    expect(paise).toHaveTextContent('null');

    await user.type(input, 'abc');
    expect(paise).toHaveTextContent('NaN');
  });

  it('shows stored paise as rupees and tidies the text on blur', async () => {
    render(<Harness initial={60_000} />);
    const input = screen.getByLabelText('Fee');
    expect(input).toHaveValue('600');
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, '0750.50');
    await user.tab();
    expect(input).toHaveValue('750.50');
    expect(screen.getByLabelText('paise')).toHaveTextContent('75050');
  });
});
