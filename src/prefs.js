// Tray Collapse 设置界面 — GTK4 / libadwaita (GNOME 42)
// 运行在独立进程，读不到 Shell 的 statusArea，
// 因此图标列表来自扩展进程写入的 gsettings: known-indicators(JSON)。

const { Adw, Gio, GLib, Gtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { readKnownIndicators } = Me.imports.indicatorSettings;

function init() {}

// 造一个「标题 + 数字微调框」行；spin 为 int，绑定到 settings 的某个 int key。
function makeSpinRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.ActionRow({ title, subtitle });
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            lower, upper, step_increment: 1, page_increment: 4,
        }),
        valign: Gtk.Align.CENTER,
    });
    // 双向绑定也能接收窗口外修改的数值。
    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(spin);
    row.activatable_widget = spin;
    return row;
}

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
    // 先写目标列表，减少切换时落入默认状态的中间过程。
    if (collapse) {
        settings.set_strv('collapsed-ids', collapsed);
        settings.set_strv('pinned-ids', pinned);
    } else {
        settings.set_strv('pinned-ids', pinned);
        settings.set_strv('collapsed-ids', collapsed);
    }
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

    // —— 间距 ——
    const spacing = new Adw.PreferencesGroup({
        title: '间距',
        description: '调整托盘图标之间的水平距离（单位像素）',
    });
    page.add(spacing);

    spacing.add(makeSpinRow(settings, 'drawer-spacing',
        '抽屉图标间距', '展开后，抽屉里各图标之间的距离', 0, 40));

    spacing.add(makeSpinRow(settings, 'panel-hpadding',
        '顶栏图标内边距', '每个托盘图标左右的留白，调小即收紧间距（主题默认 12）',
        0, 24));

    // —— 图标列表 ——
    const group = new Adw.PreferencesGroup({
        title: '托盘图标',
        description: '开 = 收进抽屉，关 = 留在顶栏；新图标和设置变化会自动刷新',
    });
    page.add(group);

    let rows = [];
    let switches = [];
    let syncing = false;

    function syncSwitches() {
        // 程序同步开关时不写回配置，避免把默认值固化成用户的明确选择。
        syncing = true;
        try {
            for (const { id, widget } of switches)
                widget.active = isCollapsed(settings, id);
        } finally {
            syncing = false;
        }
    }

    function rebuildRows() {
        for (const row of rows)
            group.remove(row);
        rows = [];
        switches = [];

        const known = readKnownIndicators(settings);
        known.sort((a, b) => a.title.localeCompare(b.title));
        if (known.length === 0) {
            const row = new Adw.ActionRow({
                title: '还没发现任何托盘图标',
                subtitle: '启用扩展后，让程序的托盘图标出现一次，本列表会自动更新',
            });
            group.add(row);
            rows.push(row);
            return;
        }

        for (const entry of known) {
            // 应用标题来自外部进程，转义后才能交给 Adw 的 Pango 标记解析。
            const row = new Adw.ActionRow({
                title: GLib.markup_escape_text(entry.title, -1),
                subtitle: GLib.markup_escape_text(entry.id, -1),
            });
            const widget = new Gtk.Switch({
                active: isCollapsed(settings, entry.id),
                valign: Gtk.Align.CENTER,
            });
            widget.connect('notify::active', () => {
                if (!syncing)
                    setCollapsed(settings, entry.id, widget.active);
            });
            row.add_suffix(widget);
            row.activatable_widget = widget;
            group.add(row);
            rows.push(row);
            switches.push({ id: entry.id, widget });
        }
    }

    rebuildRows();
    const signalIds = [
        settings.connect('changed::known-indicators', rebuildRows),
        settings.connect('changed::default-collapse', syncSwitches),
        settings.connect('changed::collapsed-ids', syncSwitches),
        settings.connect('changed::pinned-ids', syncSwitches),
    ];

    // 窗口关闭后断开手动连接，避免后台刷新已经关闭的控件。
    window.connect('close-request', () => {
        for (const id of signalIds)
            settings.disconnect(id);
        signalIds.length = 0;
        return false;
    });
}
