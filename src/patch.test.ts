import { describe, expect, it } from "bun:test";

import { composePatches as composeMessagePatches } from "./message";
import { type ChatMemory, composePatches as composeToolPatches } from "./tool";

for (const [name, composePatches] of [
  ["message", composeMessagePatches],
  ["tool", composeToolPatches]
] as const) {
  describe(`${name}.composePatches`, () => {
    it("composes changes to different keys", () => {
      const memory = { first: 0, second: 0 };
      const result = composePatches(memory, [
        (state) => ({ ...state, first: 1 }),
        undefined,
        (state) => ({ ...state, second: state.first + 1 })
      ]);

      expect(result).toEqual({ first: 1, second: 2 });
      expect(memory).toEqual({ first: 0, second: 0 });
    });

    it("allows a no-op patch after a change", () => {
      expect(
        composePatches({ value: 0 }, [
          (state) => ({ ...state, value: 1 }),
          (state) => state
        ])
      ).toEqual({ value: 1 });
    });

    it("rejects changes to the same key", () => {
      expect(() =>
        composePatches({ value: 0 }, [
          (state) => ({ ...state, value: 1 }),
          (state) => ({ ...state, value: 0 })
        ])
      ).toThrow("Memory‑patch conflict on key 'value'");
    });

    it("detects deletion followed by re-creation", () => {
      const memory: ChatMemory = { value: 1 };
      expect(() =>
        composePatches(memory, [
          () => ({}),
          (state) => ({ ...state, value: 2 })
        ])
      ).toThrow("Memory‑patch conflict on key 'value'");
    });

    it("tracks an added undefined property", () => {
      const memory: ChatMemory = {};
      expect(() =>
        composePatches(memory, [
          (state) => ({ ...state, value: undefined }),
          (state) => ({ ...state, value: 1 })
        ])
      ).toThrow("Memory‑patch conflict on key 'value'");
    });
  });
}
