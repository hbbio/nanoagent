/**
 * Custom rule for the JSON stringifier.
 */
export interface CustomRule<T> {
  test: (v: unknown) => v is T;
  output: (v: T) => unknown;
}

/**
 * Like `JSON.stringify` but supports bigint, omits non-serialisable values,
 * detects cycles, pretty-prints with 2-space indents and sorts object keys
 * alphabetically so the output is deterministic.
 */
export const stringify = (
  value: unknown,
  options?: { noFail?: boolean; customRules?: CustomRule<unknown>[] }
): string => {
  const seen = new Set<object>();
  const indentUnit = "  "; // 2 spaces

  const serialize = (val: unknown, level: number): string => {
    if (val === null) return "null";

    const type = typeof val;

    if (type === "number" || type === "boolean") return String(val);
    if (type === "string") return JSON.stringify(val);
    if (type === "bigint") return `"${val?.toString()}"`;
    if (type === "function" || type === "symbol" || type === "undefined") {
      return undefined as never;
    }

    if (Array.isArray(val)) {
      if (val.length === 0) return "[]";
      const nextLevel = level + 1;
      const items = val.map((el) => {
        const out = serialize(el, nextLevel);
        return `${indentUnit.repeat(nextLevel)}${out ?? "null"}`;
      });
      return `[\n${items.join(",\n")}\n${indentUnit.repeat(level)}]`;
    }

    if (type === "object") {
      for (const rule of options?.customRules || [])
        if (rule.test(val)) return serialize(rule.output(val), level);
      if (seen.has(val as object)) {
        if (options?.noFail) return serialize(undefined, level);
        throw new TypeError("Converting circular structure to JSON");
      }
      seen.add(val as object);

      const keys = Object.keys(val as object).sort();
      const entries: string[] = [];

      for (const k of keys) {
        const v = (val as Record<string, unknown>)[k];
        const out = serialize(v, level + 1);
        if (out === undefined) continue;
        entries.push(
          `${indentUnit.repeat(level + 1)}${JSON.stringify(k)}: ${out}`
        );
      }

      seen.delete(val as object);

      if (entries.length === 0) return "{}";
      return `{\n${entries.join(",\n")}\n${indentUnit.repeat(level)}}`;
    }

    return undefined as never;
  };

  return serialize(value, 0);
};
