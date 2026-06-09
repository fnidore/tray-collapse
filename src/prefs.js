// Tray Collapse 设置界面 — GTK4 / libadwaita (GNOME 42)
// 运行在独立进程，读不到 Shell 的 statusArea，
// 因此图标列表来自扩展进程写入的 gsettings: known-indicators(JSON)。

const { Adw, Gio, Gtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

function init() {}

// 某 id 当前是否处于「收纳」状态：collapsed 优先 > pinned > 默认值
function isCollapsed(settings, id) {
    if (settings.get_strv('collapsed-ids').includes(id))
        return true;
    if (settings.get_strv('pinned-ids').includes(id))
        return false;
    return settings.get_boolean('default-collapse');
}

// 写入用户的明确选择：收纳→collapsed-ids，常驻→pinned-ids（互斥）
function setCollapsed(settings, id, collapse) {
    const collapsed = settings.get_strv('collapsed-ids').filter(x => x !== id);
    const pinned = settings.get_strv('pinned-ids').filter(x => x !== id);
    if (collapse)
        collapsed.push(id);
    else
        pinned.push(id);
    settings.set_strv('collapsed-ids', collapsed);
    settings.set_strv('pinned-ids', pinned);
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings();
    const page = new Adw.PreferencesPage();
    window.add(page);

    // —— 通用 ——
    const general = new Adw.PreferencesGroup({ title: '通用' });
    page.add(general);

    const defaultRow = new Adw.ActionRow({
        title: '新图标默认收进抽屉',
        subtitle: '关闭：新出现的图标先留在顶栏，需要时再来下面逐个收纳',
    });
    const defaultSwitch = new Gtk.Switch({
        active: settings.get_boolean('default-collapse'),
        valign: Gtk.Align.CENTER,
    });
    settings.bind('default-collapse', defaultSwitch, 'active',
        Gio.SettingsBindFlags.DEFAULT);
    defaultRow.add_suffix(defaultSwitch);
    defaultRow.activatable_widget = defaultSwitch;
    general.add(defaultRow);

    // —— 图标列表 ——
    const group = new Adw.PreferencesGroup({
        title: '托盘图标',
        description: '开 = 收进抽屉，关 = 留在顶栏（修改「默认」后请重开本窗口刷新状态）',
    });
    page.add(group);

    let known = [];
    try {
        known = JSON.parse(settings.get_string('known-indicators')) || [];
    } catch (e) {
        known = [];
    }

    if (known.length === 0) {
        group.add(new Adw.ActionRow({
            title: '还没发现任何托盘图标',
            subtitle: '启用扩展后，让各程序的托盘图标出现一次即会自动记录，再回来设置',
        }));
        return;
    }

    known.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
    for (const k of known) {
        const row = new Adw.ActionRow({
            title: k.title || k.id,
            subtitle: k.id,
        });
        const sw = new Gtk.Switch({
            active: isCollapsed(settings, k.id),
            valign: Gtk.Align.CENTER,
        });
        sw.connect('notify::active',
            () => setCollapsed(settings, k.id, sw.active));
        row.add_suffix(sw);
        row.activatable_widget = sw;
        group.add(row);
    }
}
