# Branch Protection Rules

このドキュメントでは、リポジトリのブランチ保護ルールの設定方法を説明します。

## 保護対象ブランチ

- `main`: 本番環境用ブランチ
- `dev`: 開発環境用ブランチ

## 設定手順

### 1. GitHub リポジトリの Settings にアクセス

1. リポジトリページで `Settings` タブをクリック
2. 左サイドバーの `Branches` をクリック

### 2. main ブランチの保護ルール

`Add branch protection rule` をクリックし、以下の設定を行います：

#### Branch name pattern
```
main
```

#### 必須設定項目

- [x] **Require a pull request before merging**
  - [x] Require approvals: 0 (またはチームの要件に応じて設定)
  - [x] Dismiss stale pull request approvals when new commits are pushed
  - [x] Require review from Code Owners (Code Ownersファイルがある場合)

- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - **Required status checks:**
    - `Check PR Source Branch / check-source` (GitHub Actions)

- [x] **Require conversation resolution before merging**
  - すべてのレビューコメントを解決してからマージ

- [x] **Require signed commits**
  - 署名されたコミットのみを許可

- [x] **Require linear history**
  - マージコミットを禁止し、リベースまたはスカッシュマージのみ許可（オプション）

- [x] **Do not allow bypassing the above settings**
  - 管理者も含めてすべてのユーザーに適用

- [x] **Restrict who can push to matching branches**
  - 直接pushを完全に禁止（空のリストのまま）

- [x] **Allow force pushes: Specify who can force push**
  - 無効（デフォルト）

- [x] **Allow deletions**
  - 無効（デフォルト）

### 3. dev ブランチの保護ルール

`Add branch protection rule` をクリックし、以下の設定を行います：

#### Branch name pattern
```
dev
```

#### 必須設定項目

- [x] **Require a pull request before merging**
  - [x] Require approvals: 0 (またはチームの要件に応じて設定)
  - [x] Dismiss stale pull request approvals when new commits are pushed

- [x] **Require conversation resolution before merging**
  - すべてのレビューコメントを解決してからマージ

- [x] **Require signed commits**
  - 署名されたコミットのみを許可

- [x] **Do not allow bypassing the above settings**
  - 管理者も含めてすべてのユーザーに適用

- [x] **Restrict who can push to matching branches**
  - 直接pushを完全に禁止（空のリストのまま）

- [x] **Allow force pushes: Specify who can force push**
  - 無効（デフォルト）

- [x] **Allow deletions**
  - 無効（デフォルト）

## ブランチ戦略

### ワークフロー

1. **機能開発**: `feature/*` ブランチを作成
2. **devへのPR**: 機能ブランチから `dev` へPRを作成
   - レビューコメントをすべて解決
   - 署名されたコミットのみ
   - PR経由でのみマージ可能
3. **mainへのPR**: `dev` ブランチから `main` へPRを作成
   - devからのPRのみ許可（GitHub Actionsで検証）
   - レビューコメントをすべて解決
   - 署名されたコミットのみ
   - PR経由でのみマージ可能

### PR制約（GitHub Actionsで実装）

- **mainへのPR**: `dev` ブランチからのみ許可
- **devへのPR**: 制限なし（任意のブランチから可能）

## 署名されたコミットの設定

### GPGキーの設定

1. GPGキーを生成（まだ持っていない場合）:
   ```bash
   gpg --full-generate-key
   ```

2. GPGキーをリスト表示:
   ```bash
   gpg --list-secret-keys --keyid-format=long
   ```

3. 公開鍵をエクスポート:
   ```bash
   gpg --armor --export YOUR_KEY_ID
   ```

4. GitHubにGPGキーを追加:
   - GitHub Settings → SSH and GPG keys → New GPG key

5. Gitの設定:
   ```bash
   git config --global user.signingkey YOUR_KEY_ID
   git config --global commit.gpgsign true
   ```

## トラブルシューティング

### 署名されていないコミットを修正

```bash
# 直前のコミットに署名を追加
git commit --amend --no-edit -S

# 複数のコミットに署名を追加（インタラクティブリベース）
git rebase -i HEAD~N --exec "git commit --amend --no-edit -S"
```

### GitHub Actionsのステータスチェックが失敗

- PRのソースブランチが `dev` であることを確認
- ワークフローファイル (`.github/workflows/check-pr-source.yml`) が存在することを確認
- GitHub Actionsのログでエラーメッセージを確認

## 注意事項

- これらの設定により、すべてのブランチへの直接pushが禁止されます
- 管理者も含めてすべてのユーザーがPRを作成してマージする必要があります
- 署名されていないコミットは拒否されます
- mainへのPRはdevブランチからのみ許可されます
