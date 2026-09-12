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
- タスク: TASK-7（旧DBのTASK-30 (closed)から起票し直し。v0.6.0で対応決定）
- 関連ファイル: src/store.ts

## 対応済み（TASK-7 / v0.6.0）

`findGitPath(resolved)` による遡上に加え、相対パスの `resolve()` 絶対化と `existsSync` ガード（実在しないパス指定で祖先の別repoへ誤解決する事故の防止）を実装。ワークスペース境界の強制（許可root検証等）は要件が立った時点で別途検討する。
