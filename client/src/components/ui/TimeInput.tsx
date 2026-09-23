import { forwardRef } from 'react';
import Input, { type InputProps } from './Input';

/**
 * 24-hour clock time 'HH:mm' in 5-minute steps (the browser's time picker; the form schema
 * enforces the step). Works with react-hook-form's register().
 */
const TimeInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'step'>>(
  function TimeInput(props, ref) {
    return <Input ref={ref} type="time" step={300} {...props} />;
  },
);

export default TimeInput;
