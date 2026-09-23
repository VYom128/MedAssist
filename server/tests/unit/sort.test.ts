import { parseSort } from '../../src/utils/pagination.js';

describe('parseSort', () => {
  const allowed = ['createdAt', 'lastName', 'email'];

  it('uses the fallback (plus _id) when missing or blank', () => {
    expect(parseSort(undefined, allowed, { createdAt: -1 })).toEqual({ createdAt: -1, _id: -1 });
    expect(parseSort('  ', allowed, { createdAt: -1 })).toEqual({ createdAt: -1, _id: -1 });
  });

  it('parses ascending and descending fields in order', () => {
    expect(parseSort('-createdAt,lastName', allowed, {})).toEqual({
      createdAt: -1,
      lastName: 1,
      _id: -1,
    });
  });

  it.each(['passwordHash', 'lastName,lastName', '-', 'lastName,,email'])('rejects %s', (value) => {
    expect(parseSort(value, allowed, {})).toBeNull();
  });
});
