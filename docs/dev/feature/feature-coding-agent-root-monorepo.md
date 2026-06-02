# CODING_AGENT_ROOTのmonorepo対応

## 現状
`resolveGitPath()`で`CODING_AGENT_ROOT`が指定された場合、`join(agentRoot, '.git')`で直下の`.git`のみをチェックしている。monorepoのサブディレクトリから実行した場合、親ディレクトリに`.git`があっても`NotGitError`になる。

## 問題点
- monorepo環境でCODING_AGENT_ROOTをサブディレクトリに設定した場合、gitリポジトリ内であってもエラーになる
- `findGitPath()`を使えば上層ディレクトリの`.git`を検出可能

## 改善案
```typescript
export function resolveGitPath(): string | null {
    const agentRoot = process.env.CODING_AGENT_ROOT;
    if (agentRoot) {
        return findGitPath(agentRoot);
    }
    return findGitPath(process.cwd());
}
```

## 優先度
low

## 関連
- PR: #29
- Thread ID: PRRT_kwDOQkMxZc6GYap6
- タスク: TASK-30 (closed)
- 関連ファイル: src/store.ts
