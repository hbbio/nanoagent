# 🧾 Coding Guidelines

These guidelines define the baseline quality expected in all code contributions. They reflect current best practices, ensure consistency across the project, and aim to make code easier to read, maintain, and evolve.

### 📌 Syntax & Language Features

1. **Use modern JavaScript/TypeScript (ES2020+)**
   - Always use `const` and `let`. Never use `var`.
   - Prefer concise arrow functions with return values:  
     ```ts
     const f = (): T => ...
     ```
   - Prefer object and array destructuring when appropriate.

2. **Prefer template literals**
   - Use backticks (`` ` ``) instead of string concatenation or multi-line strings with `+`.
   - Example:
     ```ts
     const msg = `Hello, ${name}!`;
     ```

3. **Avoid `.forEach`**
   - Use `for (const x of y)` loops for clarity, control flow, and early returns.
   - This also avoids confusion with `async` operations and side effects.

### 📦 Imports & Dependencies

4. **Trim unused imports**
   - Double-check that every imported symbol is actually used in the file.
   - Remove leftovers from refactors or copy-pastes.

5. **Sort imports logically**
   - Group and order imports: external modules, internal modules, types.
   - Prefer `import type` for types, especially with `isolatedModules`.

### ✨ Code Style & Cleanliness

6. **Write clean, small functions**
   - One function = one clear task. Avoid nesting too deeply.
   - Use guard clauses early to simplify logic.

7. **Use meaningful, minimal names**
   - Avoid over-naming: `getUserDataFromAPIResponse` → `getUser`
   - Prefer clarity over abbreviation, but brevity over verbosity.

8. **Write code that reads top-down**
   - Arrange code so that the high-level flow is visible at the top of the file.
   - Put helper functions lower unless they’re reused widely.

9. **Avoid cleverness**
   - Don't compress logic unnecessarily. Prefer clarity.
   - Avoid implicit coercions or exotic syntax tricks.

### ✅ Linting & Formatting

10. **All code must pass [`biome`](https://biomejs.dev/) (v1.9.4+)**
    - No unused variables.
    - No `any` unless justified with a comment.
    - Proper indentation and whitespace.
    - Sorted keys in objects where appropriate.

11. **No top-level async/await unless in ESM environments**
    - Use `void (async () => { ... })()` if needed.
    - Otherwise, isolate async logic into named functions.

### 💡 Good Example

Here’s a representative snippet that reflects our standards:

```ts
const hasTwoAssistantInRow = (messages: readonly Message[]) =>
  messages.length > 1 &&
  isAssistantMessage(messages[messages.length - 1]) &&
  isAssistantMessage(messages[messages.length - 2]);
```

This is good because:
- It’s short, declarative, and readable.
- It uses `readonly` for immutability.
- It uses descriptive names without redundancy.
- No unnecessary variables or early returns.

---

If a rule isn’t written here, follow the principle: *Would this be obvious and readable to someone who didn’t write it, a month later?*