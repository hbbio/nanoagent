import { describe, expect, it } from "bun:test";

import { type TypedSchema, applySchema } from "./schema";

const schema = {
  type: "object",
  required: ["name", "age"],
  properties: {
    name: { type: "string" },
    age: { type: "integer" },
    active: { type: "boolean", default: true },
    level: {
      type: "string",
      enum: ["beginner", "advanced"],
      default: "beginner"
    },
    score: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
    meta: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        info: { type: "string", default: "n/a" }
      }
    }
  }
} satisfies TypedSchema<{
  name: string;
  age: number;
  active?: boolean;
  level?: string;
  score?: number;
  tags?: string[];
  meta?: { id: string; info?: string };
}>;

describe("applySchema", () => {
  it("applies default values", () => {
    const result = applySchema(schema, { name: "Alice", age: 30 });
    expect(result.active).toBe(true);
    expect(result.level).toBe("beginner");
  });

  it("coerces basic types", () => {
    const result = applySchema(schema, {
      name: "Bob",
      age: "42",
      score: "99.5",
      active: "false"
    });
    expect(result.age).toBe(42);
    expect(result.score).toBeCloseTo(99.5);
    expect(result.active).toBe(false);
  });

  it("validates required properties", () => {
    expect(() => applySchema(schema, { name: "Eve" })).toThrow(
      /Missing required property 'age'/
    );
  });

  it("validates enum values", () => {
    expect(() =>
      applySchema(schema, {
        name: "Dan",
        age: 22,
        level: "expert"
      })
    ).toThrow(/Invalid value for property 'level'/);
  });

  it("validates nested object and applies defaults", () => {
    const result = applySchema(schema, {
      name: "Leo",
      age: 50,
      meta: { id: "x123" }
    });
    // @ts-expect-error defined
    expect(result.meta.info).toBe("n/a");
  });

  it("throws on nested missing required", () => {
    expect(() =>
      applySchema(schema, {
        name: "Leo",
        age: 50,
        meta: {}
      })
    ).toThrow(/Missing required property 'id'/);
  });

  it("validates array items", () => {
    const result = applySchema(schema, {
      name: "Ada",
      age: 28,
      tags: ["alpha", "beta"]
    });
    expect(result.tags).toEqual(["alpha", "beta"]);
  });

  it("rejects invalid types", () => {
    expect(() =>
      applySchema(schema, { name: "Eli", age: "not-a-number" })
    ).toThrow(/Invalid type for property 'age'/);
  });

  it("ignores unknown fields", () => {
    const result = applySchema(schema, {
      name: "Unknown",
      age: 21,
      // @ts-expect-error extra field not in schema
      extra: "value"
    });
    expect(result).not.toHaveProperty("extra");
  });
});
