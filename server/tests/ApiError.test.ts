import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_HTTP_STATUS } from '../src/config/constants.js';
import { ApiError } from '../src/utils/ApiError.js';

describe('ApiError', () => {
  it('stores status, message, code, details and isOperational', () => {
    const err = new ApiError(409, 'Slot taken', ERROR_CODES.SLOT_UNAVAILABLE, { slot: '10:00' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({
      statusCode: 409,
      message: 'Slot taken',
      code: 'SLOT_UNAVAILABLE',
      details: { slot: '10:00' },
      isOperational: true,
      name: 'ApiError',
    });
  });

  it.each([
    ['badRequest', 400, 'BAD_REQUEST'],
    ['validation', 400, 'VALIDATION_ERROR'],
    ['unauthorized', 401, 'UNAUTHORIZED'],
    ['forbidden', 403, 'FORBIDDEN'],
    ['notFound', 404, 'NOT_FOUND'],
    ['conflict', 409, 'CONFLICT'],
    ['unprocessable', 422, 'BUSINESS_RULE_VIOLATION'],
    ['tooManyRequests', 429, 'RATE_LIMITED'],
    ['internal', 500, 'INTERNAL_ERROR'],
  ] as const)('%s() → %i %s', (helper, status, code) => {
    const err = ApiError[helper]('msg', { a: 1 });
    expect(err).toMatchObject({ statusCode: status, code, message: 'msg', details: { a: 1 } });
    // Helper status must agree with the §16 table.
    expect(ERROR_HTTP_STATUS[code]).toBe(status);
  });

  it('keeps ERROR_CODES frozen', () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    expect(Object.keys(ERROR_CODES).sort()).toEqual(Object.keys(ERROR_HTTP_STATUS).sort());
  });
});
