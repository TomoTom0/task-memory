import { defineConfig, Plugin } from 'vitest/config';
import { readFileSync } from 'fs';

function rawMdPlugin(): Plugin {
    return {
        name: 'raw-md',
        transform(code, id) {
            if (id.endsWith('.md')) {
                const content = readFileSync(id, 'utf-8');
                return { code: `export default ${JSON.stringify(content)}`, map: null };
            }
        },
    };
}

export default defineConfig({
    plugins: [rawMdPlugin()],
    test: {
        environment: 'node',
        // tmp/ はスクラッチ領域（作業ログ・採取物・テスト残留物）であり、テスト探索対象外とする。
        // 残留dirに読み取り権限が無い場合などのglob走査失敗を防ぐ（defaultのexcludeは指定で置換されるため再掲）
        exclude: ['**/node_modules/**', '**/dist/**', 'tmp/**'],
        pool: 'forks',
        isolate: true,
        fileParallelism: true,                          // テスト隔離の前提（defaultと同一）の明示
        poolOptions: { forks: { singleFork: false } },  // 同上（docs/design/test-isolation.md）
        setupFiles: ['./test/setup.ts'],
        globalSetup: ['./test/global-setup.ts'],
    },
});
