import { describe, expect, it } from "bun:test";

import { stringify } from "./json";

describe("stringify", () => {
  it("serializes primitives correctly", () => {
    expect(stringify(null)).toBe("null");
    expect(stringify(true)).toBe("true");
    expect(stringify(false)).toBe("false");
    expect(stringify(42)).toBe("42");
    expect(stringify("hello")).toBe(JSON.stringify("hello"));
    expect(stringify(123456789n)).toBe('"123456789"');
  });

  it("serializes arrays correctly", () => {
    expect(stringify([1, 2, 3])).toBe(
      `[
  1,
  2,
  3
]`
    );
  });

  it("serializes arrays with undefined, function, symbol as null", () => {
    const arr = [1, undefined, () => {}, Symbol("s"), 5];
    expect(stringify(arr)).toBe(
      `[
  1,
  null,
  null,
  null,
  5
]`
    );
  });

  it("serializes objects correctly", () => {
    expect(stringify({ a: 1, b: "hi" })).toBe(
      `{
  "a": 1,
  "b": "hi"
}`
    );
  });

  it("serializes objects with bigints", () => {
    expect(stringify({ a: 123n })).toBe(
      `{
  "a": "123"
}`
    );
  });

  it("skips function and symbol properties in objects", () => {
    const obj = {
      a: 1,
      b: () => {},
      c: Symbol("c"),
      d: 2
    };
    expect(stringify(obj)).toBe(
      `{
  "a": 1,
  "d": 2
}`
    );
  });

  it("serializes nested objects and arrays", () => {
    expect(stringify({ a: [1, { b: 2n }] })).toBe(
      `{
  "a": [
    1,
    {
      "b": "2"
    }
  ]
}`
    );
  });

  it("throws on circular structures", () => {
    const obj = { a: 1 } as Record<string, unknown>;
    obj.self = obj;
    expect(() => stringify(obj)).toThrow(TypeError);
  });
});
