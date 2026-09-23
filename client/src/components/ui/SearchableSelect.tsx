import { forwardRef, useId } from 'react';
import Input, { type InputProps } from './Input';

/**
 * Text box with type-ahead suggestions from `options` (native datalist), for long lists such as
 * timezones. The form schema checks that the value is one of the options.
 */
const SearchableSelect = forwardRef<HTMLInputElement, InputProps & { options: readonly string[] }>(
  function SearchableSelect({ options, ...props }, ref) {
    const listId = useId();
    return (
      <>
        <Input ref={ref} list={listId} autoComplete="off" {...props} />
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </>
    );
  },
);

export default SearchableSelect;
