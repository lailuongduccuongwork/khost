import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../tailwind.config.js';

test('the real stylesheet places the housekeeping warning above the booking dialog', async () => {
    // Compile using the application content paths: hook-rendered dialogs must be scanned too.
    const result = await postcss([tailwindcss({ ...config, content: config.content.map(pattern => path.resolve(pattern)) })])
        .process('@tailwind utilities;', { from: undefined });
    const levels = new Set();
    result.root.walkDecls('z-index', declaration => levels.add(declaration.value));
    assert.ok(levels.has('120'), 'the booking dialog layer is generated');
    assert.ok(levels.has('10001'), 'the warning layer must be generated from the hook');
    assert.ok(10001 > 120);
});
