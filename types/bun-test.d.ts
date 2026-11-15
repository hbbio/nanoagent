/** The bun:test APIs used by this repository, without an @types/bun dependency. */
declare module "bun:test" {
  type TestBody = () => void;

  export function describe(name: string, body: () => void): void;
  export function beforeAll(body: TestBody): void;
  export function afterAll(body: TestBody): void;
  export function beforeEach(body: TestBody): void;
  export function afterEach(body: TestBody): void;

  export const it: {
    (
      name: string,
      body: TestBody,
      options?: number | { timeout?: number }
    ): void;
    each<T>(
      cases: readonly T[]
    ): (name: string, body: (value: T) => void) => void;
  };

  interface Matchers {
    readonly not: Matchers;
    readonly resolves: Matchers;
    readonly rejects: Matchers;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toMatchObject(expected: unknown): void;
    toMatch(expected: string | RegExp): void;
    toBeTruthy(): void;
    toBeUndefined(): void;
    toBeInstanceOf(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toHaveProperty(name: string, expected?: unknown): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledTimes(expected: number): void;
    toThrow(expected?: unknown): void;
  }

  export const expect: {
    (actual: unknown): Matchers;
    any(expectedClass: unknown): unknown;
  };

  type Callable = (...args: never[]) => unknown;

  interface Spy<F extends Callable> {
    (...args: Parameters<F>): ReturnType<F>;
    readonly mock: { calls: Parameters<F>[] };
    mockResolvedValue(value: Awaited<ReturnType<F>>): this;
    mockResolvedValueOnce(value: Awaited<ReturnType<F>>): this;
    mockImplementation(implementation: F): this;
    mockRestore(): void;
  }

  export function spyOn<T extends object, K extends keyof T>(
    object: T,
    method: K
  ): Spy<Extract<T[K], Callable>>;
}
