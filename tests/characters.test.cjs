const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourceDir = path.resolve(__dirname, '../src');
const characters = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(sourceDir, 'characters.js'), 'utf8'), characters);

test('角色目录包含四个独立选择，拒绝未知角色 id', () => {
    assert.equal(characters.CHARACTERS.length, 4);
    const ids = characters.CHARACTERS.map(character => character.id);
    assert.equal(new Set(ids).size, 4);
    assert.equal(characters.getCharacter('sakura').name, '樱桃 · 元气少女');
    assert.throws(() => characters.getCharacter('../outside'), /未知角色/);
});

test('每个角色的两种表情均存在，并使用相同大小的 PNG 画布', () => {
    for (const character of characters.CHARACTERS) {
        assert.equal(characters.getCharacter(character.id), character);
        for (const icon of [character.collapsedIcon, character.expandedIcon]) {
            const data = fs.readFileSync(path.join(sourceDir, icon));
            assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
            assert.equal(data.readUInt32BE(16), 128);
            assert.equal(data.readUInt32BE(20), 128);
        }
    }
});
