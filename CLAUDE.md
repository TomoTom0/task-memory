
## Package Manager & Runtime

Use pnpm and Node.js.

- Use `pnpm install` instead of npm/yarn/bun install
- Use `pnpm run <script>` to run scripts
- Use `node <file>` or `tsx <file>` instead of `bun <file>`
- Use `pnpm test` to run tests (vitest)
- Use `pnpm build` to build (tsup)

## Testing

Use vitest.

```ts#index.test.ts
import { test, expect } from "vitest";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## alcom

- Changes made during a session should be undone with `alcom undo`, not committed with `alcom finish`. `alcom finish` consolidates all snapshots into a single commit, making individual changes unrecoverable. Only use `alcom finish` when the changes are intended to be kept as a final commit.
- `git revert HEAD`以外に任意のコミットを指定できる。HEADに限定しないこと。
- headにしか復元できるんですね。知りませんでした。勉強になります
- 記載がないから更新が不要というのは非常に新鮮な意見だ
