// Shell 与设置窗口共用的配置读取；这里只处理数据，不修改用户设置。

// legacy:<窗口类>:<进程号> 的进程号每次启动都会变化，匹配时去掉它。
function canonicalId(id) {
    const match = /^legacy:(.+):\d+$/.exec(id);
    return match ? `legacy:${match[1]}` : id;
}

function readKnownIndicators(settings) {
    let known;
    try {
        known = JSON.parse(settings.get_string('known-indicators'));
    } catch (error) {
        logError(error, 'TrayCollapse: 无法解析已知图标配置');
        return [];
    }

    // GSettings 只保证字符串类型，手动导入的 JSON 仍可能不是图标数组。
    if (!Array.isArray(known)) {
        log('TrayCollapse: 已知图标配置必须是数组');
        return [];
    }

    const entries = [];
    for (const entry of known) {
        if (!entry || typeof entry.id !== 'string' || !entry.id) {
            log('TrayCollapse: 跳过缺少有效 id 的图标记录');
            continue;
        }

        const title = typeof entry.title === 'string' && entry.title
            ? entry.title : entry.id;
        const peers = Array.isArray(entry.peers)
            ? entry.peers.filter(id => typeof id === 'string' && id) : [];
        entries.push({ id: entry.id, title, peers });
    }
    return entries;
}
