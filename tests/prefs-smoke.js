// 使用真实 GTK4/Adw 和内存 GSettings，验证设置窗口的跨控件同步。
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
const { Adw, Gio, GLib, Gtk } = imports.gi;
const ByteArray = imports.byteArray;

if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory')
    throw new Error('设置窗口测试必须使用 GSETTINGS_BACKEND=memory');

const sourceDir = GLib.build_filenamev([GLib.get_current_dir(), 'src']);
imports.searchPath.unshift(sourceDir);
const settings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.tray-collapse' });
const [, bytes] = Gio.File.new_for_path(`${sourceDir}/prefs.js`).load_contents(null);
const loadPrefs = new Function('imports', `${ByteArray.toString(bytes)}\nreturn fillPreferencesWindow;`);
const fillPreferencesWindow = loadPrefs({
    gi: imports.gi,
    misc: {
        extensionUtils: {
            getSettings: () => settings,
            getCurrentExtension: () => ({
                path: sourceDir,
                imports: { indicatorSettings: imports.indicatorSettings, characters: imports.characters },
            }),
        },
    },
});

function check(condition, message) {
    if (!condition)
        throw new Error(message);
}

function findWidget(root, predicate) {
    if (predicate(root))
        return root;
    for (let child = root.get_first_child(); child; child = child.get_next_sibling()) {
        const found = findWidget(child, predicate);
        if (found)
            return found;
    }
    return null;
}

function row(window, title) {
    return findWidget(window, widget => widget instanceof Adw.ActionRow && widget.title === title);
}

Adw.init();
const window = new Adw.PreferencesWindow();
fillPreferencesWindow(window);
check(row(window, '还没发现任何托盘图标'), '初始空状态未展示');

// 四个角色可在同一窗口直接选择，外部修改也会同步选中状态。
const characterRows = ['樱桃 · 元气少女', '月白 · 银发猫耳', '薄荷 · 森林精灵', '琥珀 · 狐耳少女'];
for (const title of characterRows)
    check(row(window, title), `缺少角色预览：${title}`);
check(row(window, characterRows[0]).activatable_widget.active, '默认角色未选中');
row(window, characterRows[2]).activatable_widget.active = true;
check(settings.get_string('character-id') === 'mint', '角色选择未保存');
settings.set_string('character-id', 'luna');
check(row(window, characterRows[1]).activatable_widget.active, '外部角色变化未同步');
check(!row(window, characterRows[2]).activatable_widget.active, '角色未保持单选');

// 新图标到来后不重开窗口；特殊字符仍能作为普通标题展示。
settings.set_string('known-indicators', JSON.stringify([{ id: 'app&1', title: '<Proxy> & Test' }]));
const appRow = row(window, '&lt;Proxy&gt; &amp; Test');
check(appRow, '新图标没有实时出现或标题未转义');
// Adw 1.1 的 subtitle getter 返回解析后的文字；标题 getter 保留标记。
check(appRow.subtitle === 'app&1', '图标 id 未按原文字展示');
const appSwitch = appRow.activatable_widget;
check(!appSwitch.active, '默认状态错误');
settings.set_boolean('default-collapse', true);
check(appSwitch.active, '默认值变化未更新图标开关');
check(settings.get_strv('collapsed-ids').length === 0, '同步开关意外产生明确收纳选择');
check(settings.get_strv('pinned-ids').length === 0, '同步开关意外产生明确常驻选择');

// 用户操作应写入互斥的明确选择，外部修改也要反映到开关。
appSwitch.active = false;
check(settings.get_strv('pinned-ids').includes('app&1'), '常驻选择未保存');
settings.set_strv('collapsed-ids', ['app&1']);
check(appSwitch.active, '外部收纳选择未同步');
appSwitch.active = false;
check(!settings.get_strv('collapsed-ids').includes('app&1'), '旧收纳选择未移除');

const spin = row(window, '顶栏图标内边距').activatable_widget;
settings.set_int('panel-hpadding', 5);
check(spin.get_value_as_int() === 5, '外部间距变化未同步');
spin.set_value(8);
check(settings.get_int('panel-hpadding') === 8, '间距操作未保存');

settings.set_string('known-indicators', '{}');
check(row(window, '还没发现任何托盘图标'), '损坏配置未安全展示空状态');
window.emit('close-request');
window.destroy();
settings.set_boolean('default-collapse', false);
print('真实 GTK4/Adw 设置窗口检查通过');
