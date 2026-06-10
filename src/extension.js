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

// legacy 托盘图标的 id 形如 legacy:<窗口类>:<进程号>（appindicator 的
// indicatorStatusIcon.js 生成），进程号每次重启都变，砍掉它才是稳定匹配键
function canonicalId(id) {
    const m = /^legacy:(.+):\d+$/.exec(String(id));
    return m ? `legacy:${m[1]}` : String(id);
}

// 稳定标识：优先 AppIndicator 上报的 id，其次 title，最后 uniqueId 兜底
function indicatorId(indicator) {
    const ind = indicator._indicator;
    if (ind) {
        if (ind.id)
            return canonicalId(ind.id);
        if (ind.title)
            return String(ind.title);
    }
    return canonicalId(indicator.uniqueId || '');
}

function indicatorTitle(indicator) {
    const ind = indicator._indicator;
    if (ind && ind.title)
        return String(ind.title);
    const id = indicatorId(indicator);
    // legacy 图标没有 title，用窗口类当标题（legacy:fcitx → fcitx）
    return id.startsWith('legacy:') ? id.slice('legacy:'.length) : id;
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
        this._spacers = new Map();     // container -> spacer actor
        this._padded = new Set();      // 被覆盖过内边距的 indicator（禁用时还原）
        this._timeouts = new Set();
        this._suppressAdded = false;   // 搬图标回顶栏时抑制自身 actor-added 回环

        this._settingsIds = [
            this._settings.connect('changed::collapsed-ids', () => this._apply()),
            this._settings.connect('changed::pinned-ids', () => this._apply()),
            this._settings.connect('changed::default-collapse', () => this._apply()),
            this._settings.connect('changed::drawer-spacing',
                () => this._applyDrawerSpacing()),
            this._settings.connect('changed::panel-hpadding',
                () => this._applyPanelPadding()),
        ];

        this._applyDrawerSpacing();

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

    _applyDrawerSpacing() {
        const px = this._settings.get_int('drawer-spacing');
        for (const spacer of this._spacers.values())
            spacer.set_width(px);
    }

    // 顶栏图标的「宽间距」来自主题：每个 panel-button 左右各 12px 内边距
    // （Yaru 的 -natural-hpadding），与 appindicator 的 icon-spacing 无关
    // （Ubuntu 22.04 打包的旧版 appindicator 没实现该键）。
    // 这里用内联样式逐个覆盖托盘图标按钮的内边距；禁用时 set_style(null) 还原。
    _applyPanelPadding() {
        const px = this._settings.get_int('panel-hpadding');
        for (const it of this._appindicators()) {
            it.indicator.set_style(
                `-natural-hpadding: ${px}px; -minimum-hpadding: ${px}px;`);
            this._padded.add(it.indicator);
        }
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
        this._applyPanelPadding();
    }

    // 把见过的图标写进 known-indicators(JSON)，供设置界面读取。
    // 顺带做去重：
    //   1) 存量清洗：旧版本记录过带 PID 的 legacy id（legacy:fcitx:4315），
    //      规范化后合并重复项、重算标题；
    //   2) 同名清扫：个别应用（如 com.follow.clash）违反 SNI 规范，每次启动
    //      乱报随机 id 但 title 稳定——同 title 且「不在线」的旧条目视为
    //      同一应用留下的旧身份，删除并把收纳设置迁给当前 id；
    //   3) peers 保护：同 title 的图标若「同时在线」过（如两个「更新通知」
    //      其实是不同应用），互记为 peers 并持久化，永不合并。
    _recordKnown(items) {
        let known = [];
        try {
            known = JSON.parse(this._settings.get_string('known-indicators')) || [];
        } catch (e) {
            known = [];
        }
        let changed = false;

        // 存量清洗：id 规范化合并 legacy 重复项，丑标题按新 id 重算
        const map = new Map();   // id -> { title, peers: Set }
        for (const k of known) {
            const id = canonicalId(k.id);
            let title = k.title;
            if (id.startsWith('legacy:') && String(title).startsWith('legacy:'))
                title = id.slice('legacy:'.length);
            if (id !== k.id || title !== k.title)
                changed = true;
            if (!map.has(id))
                map.set(id, { title, peers: new Set(k.peers || []) });
        }
        this._canonicalizeList('collapsed-ids');
        this._canonicalizeList('pinned-ids');

        const liveIds = new Set(items.map(it => it.id).filter(Boolean));

        // 同时在线的同名图标 → 真·不同应用，互记 peers
        const byTitle = new Map();
        for (const it of items) {
            if (!it.id)
                continue;
            if (!byTitle.has(it.title))
                byTitle.set(it.title, []);
            byTitle.get(it.title).push(it.id);
        }

        for (const it of items) {
            if (!it.id)
                continue;
            if (!map.has(it.id)) {
                map.set(it.id, { title: it.title, peers: new Set() });
                changed = true;
            }
            const entry = map.get(it.id);
            if (entry.title !== it.title) {
                entry.title = it.title;
                changed = true;
            }
            for (const peer of byTitle.get(it.title)) {
                if (peer !== it.id && !entry.peers.has(peer)) {
                    entry.peers.add(peer);
                    changed = true;
                }
            }

            // 同名清扫：不在线、又不是 peers 的同 title 旧条目 → 旧身份，合并掉。
            // 当前 id 已有明确设置则只清不迁，避免旧设置覆盖用户现在的选择。
            const hasExplicit =
                this._settings.get_strv('collapsed-ids').includes(it.id) ||
                this._settings.get_strv('pinned-ids').includes(it.id);
            for (const [oldId, old] of [...map]) {
                if (oldId === it.id || old.title !== it.title)
                    continue;
                if (liveIds.has(oldId) || entry.peers.has(oldId) ||
                    old.peers.has(it.id))
                    continue;
                map.delete(oldId);
                if (hasExplicit) {
                    this._removeFromList('collapsed-ids', oldId);
                    this._removeFromList('pinned-ids', oldId);
                } else {
                    this._renameInList('collapsed-ids', oldId, it.id);
                    this._renameInList('pinned-ids', oldId, it.id);
                }
                changed = true;
            }
        }

        if (changed) {
            const arr = [...map].map(([id, v]) =>
                ({ id, title: v.title, peers: [...v.peers] }));
            this._settings.set_string('known-indicators', JSON.stringify(arr));
        }
    }

    // 列表里的 id 全部规范化并去重（存量数据清洗，无变化则不写回）
    _canonicalizeList(key) {
        const arr = this._settings.get_strv(key);
        const out = [...new Set(arr.map(canonicalId))];
        if (out.length !== arr.length || out.some((v, i) => v !== arr[i]))
            this._settings.set_strv(key, out);
    }

    // 应用乱报随机 id 时迁移设置：把列表里的 oldId 换成 newId（不重复添加）
    _renameInList(key, oldId, newId) {
        const arr = this._settings.get_strv(key);
        if (!arr.includes(oldId))
            return;
        const out = arr.filter(x => x !== oldId);
        if (!out.includes(newId))
            out.push(newId);
        this._settings.set_strv(key, out);
    }

    // 清掉列表里某个失效 id（不迁移）
    _removeFromList(key, id) {
        const arr = this._settings.get_strv(key);
        if (arr.includes(id))
            this._settings.set_strv(key, arr.filter(x => x !== id));
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
        const px = this._settings.get_int('drawer-spacing');
        const spacer = new St.Bin({ width: px });
        this._drawerBox.add_child(spacer);
        this._spacers.set(container, spacer);
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
        const spacer = this._spacers.get(container);
        if (spacer) {
            spacer.destroy();
            this._spacers.delete(container);
        }
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

        // 还原被覆盖的顶栏图标内边距，交还给主题
        for (const indicator of this._padded) {
            try {
                indicator.set_style(null);
            } catch (e) {
                // indicator 可能已被销毁，忽略
            }
        }
        this._padded.clear();

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
