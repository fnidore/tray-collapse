// Tray Collapse 托盘折叠 — GNOME Shell 42
// 把 AppIndicator 托盘图标收进顶栏的可折叠区域，并支持逐个选择「收纳 / 常驻」。
//
// 设计要点（为什么不用弹出菜单）：
//   被收纳的图标本身是面板按钮（PanelMenu.Button），如果塞进弹出菜单里，
//   点击它会先关闭外层菜单，导致图标自己的菜单弹不出来。
//   因此这里把「抽屉」做成一个直接放在顶栏里的盒子(_drawerBox)：
//     - 收起：盒子隐藏(visible=false)，不占顶栏空间；
//     - 展开：盒子显示，图标原地内联出现，仍是面板原生按钮，点击行为完全正常。
//
// 机制：appindicator 把每个图标注册为 Main.panel.statusArea['appindicator-<uniqueId>']，
//   其 ._indicator.id 是应用上报的稳定 ID（跨重启不变），作白名单匹配键；
//   .container 是图标实体，移入 _drawerBox / 移回 _rightBox 即实现收纳 / 放出。
//   设置界面在独立进程读不到 statusArea，故扩展把见过的图标写进
//   gsettings 的 known-indicators(JSON) 供其渲染列表（跨进程桥接）。

const { Clutter, GLib, GObject, St } = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const ExtensionUtils = imports.misc.extensionUtils;

const APPINDICATOR_PREFIX = 'appindicator-';

// 稳定标识：优先 AppIndicator 上报的 id，其次 title，最后 uniqueId 兜底
function indicatorId(indicator) {
    const ind = indicator._indicator;
    if (ind) {
        if (ind.id)
            return String(ind.id);
        if (ind.title)
            return String(ind.title);
    }
    return String(indicator.uniqueId || '');
}

function indicatorTitle(indicator) {
    const ind = indicator._indicator;
    if (ind && ind.title)
        return String(ind.title);
    return indicatorId(indicator);
}

const TrayCollapseButton = GObject.registerClass(
class TrayCollapseButton extends PanelMenu.Button {
    _init(settings) {
        // dontCreateMenu=true：不用弹出菜单，点击只切换抽屉显隐
        super._init(0.0, 'TrayCollapse', true);
        this._settings = settings;
        this._expanded = false;

        this._icon = new St.Icon({
            icon_name: 'view-more-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        // 抽屉盒子：放进顶栏（由 Extension.enable 插入 _rightBox），靠显隐折叠
        this._drawerBox = new St.BoxLayout({
            style_class: 'tray-collapse-drawer',
            visible: false,
        });

        this._moved = new Map();       // container -> destroy 信号 id
        this._timeouts = new Set();
        this._suppressAdded = false;   // 搬图标回顶栏时抑制自身 actor-added 回环

        this._settingsIds = [
            this._settings.connect('changed::collapsed-ids', () => this._apply()),
            this._settings.connect('changed::pinned-ids', () => this._apply()),
            this._settings.connect('changed::default-collapse', () => this._apply()),
        ];

        // 顶栏右盒新增子节点（新程序弹托盘图标）时整体重扫
        this._addedId = Main.panel._rightBox.connect('actor-added', () => {
            if (!this._suppressAdded)
                this._scheduleRescan(80);
        });

        // 点 ⋯ 切换抽屉
        this.connect('button-press-event', () => {
            this._toggle();
            return Clutter.EVENT_STOP;
        });

        // 启动竞态：appindicator 图标开机后陆续注册，分多次延迟补扫兜住
        [0, 800, 2000, 4000, 8000].forEach(ms => this._scheduleRescan(ms));
    }

    get drawerBox() {
        return this._drawerBox;
    }

    _toggle() {
        this._expanded = !this._expanded;
        this._drawerBox.visible = this._expanded;
        this._icon.icon_name = this._expanded
            ? 'pan-start-symbolic' : 'view-more-symbolic';
    }

    // 当前所有 appindicator：[{indicator, id, title, container}]
    _appindicators() {
        const out = [];
        const statusArea = Main.panel.statusArea;
        for (const key in statusArea) {
            if (!key.startsWith(APPINDICATOR_PREFIX))
                continue;
            const indicator = statusArea[key];
            if (!indicator || !indicator.container)
                continue;
            out.push({
                indicator,
                id: indicatorId(indicator),
                title: indicatorTitle(indicator),
                container: indicator.container,
            });
        }
        return out;
    }

    // 是否收纳：collapsed 优先 > pinned > 默认值
    _shouldCollapse(id) {
        if (this._settings.get_strv('collapsed-ids').includes(id))
            return true;
        if (this._settings.get_strv('pinned-ids').includes(id))
            return false;
        return this._settings.get_boolean('default-collapse');
    }

    _apply() {
        const items = this._appindicators();
        this._recordKnown(items);
        for (const it of items) {
            if (this._shouldCollapse(it.id))
                this._moveIn(it.container);
            else
                this._moveOut(it.container);
        }
    }

    // 把见过的图标写进 known-indicators(JSON)，供设置界面读取
    _recordKnown(items) {
        let known = [];
        try {
            known = JSON.parse(this._settings.get_string('known-indicators')) || [];
        } catch (e) {
            known = [];
        }
        const map = new Map(known.map(k => [k.id, k.title]));
        let changed = false;
        for (const it of items) {
            if (!it.id)
                continue;
            if (map.get(it.id) !== it.title) {
                map.set(it.id, it.title);
                changed = true;
            }
        }
        if (changed) {
            const arr = [...map].map(([id, title]) => ({ id, title }));
            this._settings.set_string('known-indicators', JSON.stringify(arr));
        }
    }

    _scheduleRescan(ms) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            this._apply();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    _moveIn(container) {
        if (this._moved.has(container))
            return;
        const parent = container.get_parent();
        if (parent)
            parent.remove_child(container);
        this._drawerBox.add_child(container);
        const destroyId = container.connect('destroy',
            () => this._moved.delete(container));
        this._moved.set(container, destroyId);
    }

    _moveOut(container) {
        if (!this._moved.has(container))
            return;
        this._detach(container);
        if (!container.get_parent()) {
            this._suppressAdded = true;
            Main.panel._rightBox.insert_child_at_index(container, 0);
            this._suppressAdded = false;
        }
    }

    // 从抽屉摘出 container 并断开 destroy 信号（不负责放回顶栏）
    _detach(container) {
        const destroyId = this._moved.get(container);
        if (destroyId)
            container.disconnect(destroyId);
        this._moved.delete(container);
        if (this._drawerBox.contains(container))
            this._drawerBox.remove_child(container);
    }

    _restoreAll() {
        for (const container of [...this._moved.keys()]) {
            try {
                this._detach(container);
                if (!container.get_parent()) {
                    this._suppressAdded = true;
                    Main.panel._rightBox.insert_child_at_index(container, 0);
                    this._suppressAdded = false;
                }
            } catch (e) {
                // container 可能已被销毁，忽略
            }
        }
        this._moved.clear();
    }

    destroy() {
        if (this._addedId) {
            Main.panel._rightBox.disconnect(this._addedId);
            this._addedId = 0;
        }
        for (const sid of this._settingsIds || [])
            this._settings.disconnect(sid);
        this._settingsIds = [];
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();

        this._restoreAll();

        // 移除抽屉盒子
        if (this._drawerBox) {
            const parent = this._drawerBox.get_parent();
            if (parent)
                parent.remove_child(this._drawerBox);
            this._drawerBox.destroy();
            this._drawerBox = null;
        }

        super.destroy();
    }
});

class Extension {
    enable() {
        this._settings = ExtensionUtils.getSettings();
        this._indicator = new TrayCollapseButton(this._settings);
        // ⋯ 按钮放右盒最靠左（紧挨时钟）
        Main.panel.addToStatusArea('tray-collapse', this._indicator, 0, 'right');
        // 抽屉盒子插在 ⋯ 左侧：展开时图标朝时钟方向铺开
        Main.panel._rightBox.insert_child_at_index(this._indicator.drawerBox, 0);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}

function init() {
    return new Extension();
}
