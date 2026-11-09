// Shell 与设置窗口共用的内置角色目录，文件路径显式列出，不从设置值拼接。
// GJS 的传统模块使用 var 导出列表，供两个独立进程读取。
var CHARACTERS = [
    {
        id: 'sakura',
        name: '樱桃 · 元气少女',
        description: '粉色短发，星形发卡，温暖活泼',
        collapsedIcon: 'icons/anime-girl-collapsed.png',
        expandedIcon: 'icons/anime-girl-expanded.png',
    },
    {
        id: 'luna',
        name: '月白 · 银发猫耳',
        description: '银白短发，蓝色眼睛，藏蓝蝴蝶结',
        collapsedIcon: 'icons/characters/luna-collapsed.png',
        expandedIcon: 'icons/characters/luna-expanded.png',
    },
    {
        id: 'mint',
        name: '薄荷 · 森林精灵',
        description: '薄荷绿发，精灵耳，叶片发饰与侧辫',
        collapsedIcon: 'icons/characters/mint-collapsed.png',
        expandedIcon: 'icons/characters/mint-expanded.png',
    },
    {
        id: 'amber',
        name: '琥珀 · 狐耳少女',
        description: '暖橘卷发，蓬松狐耳，红色蝴蝶结',
        collapsedIcon: 'icons/characters/amber-collapsed.png',
        expandedIcon: 'icons/characters/amber-expanded.png',
    },
];

function getCharacter(id) {
    const character = CHARACTERS.find(item => item.id === id);
    if (!character)
        throw new Error(`未知角色：${id}`);
    return character;
}
