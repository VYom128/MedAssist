import { buildMeta, parsePagination } from '../src/utils/pagination.js';

describe('parsePagination', () => {
  it('uses page 1 and limit 20 by default', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(parsePagination()).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('parses string query values and computes skip', () => {
    expect(parsePagination({ page: '3', limit: '25' })).toEqual({ page: 3, limit: 25, skip: 50 });
  });

  it('caps limit at 100', () => {
    expect(parsePagination({ limit: '500' }).limit).toBe(100);
  });

  it.each([['0'], ['-2'], ['abc'], ['1.5'], [''], [null]])(
    'falls back to defaults for invalid value %j',
    (value) => {
      expect(parsePagination({ page: value, limit: value })).toEqual({
        page: 1,
        limit: 20,
        skip: 0,
      });
    },
  );
});

describe('buildMeta', () => {
  it('computes totalPages', () => {
    expect(buildMeta({ page: 2, limit: 20, total: 41 })).toEqual({
      page: 2,
      limit: 20,
      total: 41,
      totalPages: 3,
    });
  });

  it('returns 0 pages for an empty result', () => {
    expect(buildMeta({ page: 1, limit: 20, total: 0 }).totalPages).toBe(0);
  });
});
