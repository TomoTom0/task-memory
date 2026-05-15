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
});
