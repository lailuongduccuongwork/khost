import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Run the actual application modules with an in-memory Firebase adapter. Never load .env.local.
export function createLoader(mocks = {}, append = {}) {
    const cache = new Map();
    return function load(file) {
        file = path.resolve(file);
        if (cache.has(file)) return cache.get(file).exports;
        const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.env', '({})') + (append[file] || '');
        const { outputText } = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        });
        const module = { exports: {} };
        cache.set(file, module);
        const require = (name) => {
            if (name in mocks) return mocks[name];
            if (!name.startsWith('.')) throw new Error(`Unexpected dependency: ${name}`);
            return load(path.resolve(path.dirname(file), `${name}.ts`));
        };
        new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
        return module.exports;
    };
}
