import { mongo, Types } from 'mongoose';
import { canonicalJson } from '../../src/utils/canonicalJson.js';

describe('canonicalJson', () => {
  it('sorts object keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}',
    );
  });

  it('gives the same string regardless of insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it('writes dates as ISO strings and ObjectIds as hex strings', () => {
    const id = new Types.ObjectId('64b000000000000000000001');
    expect(canonicalJson({ at: new Date('2026-09-23T10:00:00.123Z'), id })).toBe(
      '{"at":"2026-09-23T10:00:00.123Z","id":"64b000000000000000000001"}',
    );
  });

  it('drops undefined properties and keeps nulls; undefined array items become null', () => {
    expect(canonicalJson({ a: undefined, b: null, c: [undefined, 1] })).toBe(
      '{"b":null,"c":[null,1]}',
    );
  });

  it('handles primitives, nested arrays and bigint', () => {
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(3)).toBe('3');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson([[1, [2]], true])).toBe('[[1,[2]],true]');
    expect(canonicalJson({ n: 10n })).toBe('{"n":"10"}');
  });

  it("treats the driver's ObjectId (lean reads) like Mongoose's", () => {
    const hex = '64b0000000000000000000aa';
    expect(canonicalJson(new Types.ObjectId(hex))).toBe(canonicalJson(new mongo.ObjectId(hex)));
  });
});
