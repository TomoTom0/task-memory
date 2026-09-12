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
        pool: 'forks',
        isolate: true,
        fileParallelism: true,                          // テスト隔離の前提（defaultと同一）の明示
        poolOptions: { forks: { singleFork: false } },  // 同上（docs/design/test-isolation.md）
        setupFiles: ['./test/setup.ts'],
        globalSetup: ['./test/global-setup.ts'],
    },
});
