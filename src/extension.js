// Tray Collapse 托盘折叠 — GNOME Shell 42
// 把 AppIndicator 托盘图标收进顶栏的可折叠区域，并支持逐个选择「收纳 / 常驻」。
//
// 设计要点（为什么不用弹出菜单）：
//   被收纳的图标本身是面板按钮（PanelMenu.Button），如果塞进弹出菜单里，
//   点击它会先关闭外层菜单，导致图标自己的菜单弹不出来。
//   抽屉里的图标仍是原生面板按钮，动画只改变裁剪区域和透明度：
//     - 收起：动画结束后隐藏外层，不占顶栏空间；
//     - 展开：从按钮向左展开，内容保持原尺寸，菜单仍由原生按钮处理。
//
// 机制：appindicator 把每个图标注册为 Main.panel.statusArea['appindicator-<uniqueId>']，
//   其 ._indicator.id 是应用上报的稳定 ID（跨重启不变），作白名单匹配键；
//   .container 是图标实体，移入 _drawerBox / 移回原面板区域即实现收纳 / 放出。
//   设置界面在独立进程读不到 statusArea，故扩展把见过的图标写进
//   gsettings 的 known-indicators(JSON) 供其渲染列表（跨进程桥接）。

const { Clutter, Gio, GLib, GObject, St } = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { canonicalId, readKnownIndicators } = Me.imports.indicatorSettings;

const APPINDICATOR_PREFIX = 'appindicator-';

// 稳定标识：优先 AppIndicator 上报的 id，其次 title，最后 uniqueId 兜底
function indicatorId(indicator) {
    const ind = indicator._indicator;
    if (ind) {
        if (ind.id)
            return canonicalId(String(ind.id));
        if (ind.title)
            return String(ind.title);
    }
    return canonicalId(String(indicator.uniqueId || ''));
}

function indicatorTitle(indicator) {
    const ind = indicator._indicator;
    if (ind && ind.title)
        return String(ind.title);
    const id = indicatorId(indicator);
    // legacy 图标没有 title，用窗口类当标题（legacy:fcitx → fcitx）
    return id.startsWith('legacy:') ? id.slice('legacy:'.length) : id;
}

// 动画期间保持完整布局宽度，只裁剪内容，避免相邻图标逐帧重新排版。
const TrayDrawer = GObject.registerClass({
    Properties: {
        'reveal': GObject.ParamSpec.double(
            'reveal', 'Reveal', 'Visible width fraction',
            GObject.ParamFlags.READWRITE, 0, 1, 0),
    },
}, class TrayDrawer extends St.Widget {
    _init(content) {
        super._init({
            clip_to_allocation: true,
            visible: false,
            opacity: 0,
        });
        this._content = content;
        this._reveal = 0;
        this._allocatedWidth = 0;
        this._allocatedHeight = 0;
        this.add_child(content);
    }

    get reveal() {
        return this._reveal || 0;
    }

    set reveal(value) {
        this._reveal = value;
        this._updateClip();
    }

    vfunc_get_preferred_width(forHeight) {
        if (!this._content)
            return [0, 0];
        return this._content.get_preferred_width(forHeight);
    }

    vfunc_get_preferred_height(_forWidth) {
        if (!this._content)
            return [0, 0];
        return this._content.get_preferred_height(-1);
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        if (!this._content)
            return;

        // 内容一次分配到最终尺寸，不能让动画进度改变面板的宽度取整结果。
        const width = box.x2 - box.x1;
        const height = box.y2 - box.y1;
        this._allocatedWidth = width;
        this._allocatedHeight = height;
        const contentBox = new Clutter.ActorBox();
        contentBox.x1 = 0;
        contentBox.x2 = width;
        contentBox.y1 = 0;
        contentBox.y2 = height;
        this._content.allocate(contentBox);
        this._updateClip();
    }

    _updateClip() {
        if (!this._content)
            return;

        // 裁剪只影响绘制和点击范围，不向父容器请求重新布局。
        if (this.reveal >= 1) {
            this._content.remove_clip();
            return;
        }
        const visibleWidth = this._allocatedWidth * this.reveal;
        this._content.set_clip(
            this._allocatedWidth - visibleWidth,
            0,
            visibleWidth,
            this._allocatedHeight);
    }
});

const TrayCollapseButton = GObject.registerClass(
class TrayCollapseButton extends PanelMenu.Button {
    _init(settings) {
        // dontCreateMenu=true：不用弹出菜单，点击只切换抽屉显隐
        super._init(0.0, '展开托盘图标', true);
        this._settings = settings;
        this._expanded = false;

        // 左箭头表示向时钟方向展开，右箭头表示收回；颜色跟随主题。
        this._iconCollapsed = Gio.icon_new_for_string(
            `${Me.path}/icons/tray-collapse-symbolic.svg`);
        this._iconExpanded = Gio.icon_new_for_string(
            `${Me.path}/icons/tray-expand-symbolic.svg`);

        // 单个方向箭头保留 22px 尺寸，让可见高度接近旁边的托盘图标。
        this._icon = new St.Icon({
            gicon: this._iconCollapsed,
            icon_size: 22,
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        // 直接使用原生面板按钮，保留图标两侧的完整点击区域。
        this.add_style_class_name('tray-collapse-button');

        // 内容盒子保存原生图标，外层裁剪容器由 enable 插入顶栏。
        this._drawerBox = new St.BoxLayout({
            style_class: 'tray-collapse-drawer',
        });
        this._drawer = new TrayDrawer(this._drawerBox);

        // 收纳期间保留不可见的位置标记，恢复时保持原区域与相邻顺序。
        this._moved = new Map();
        this._spacers = new Map();
        this._padded = new Map();
        this._timeouts = new Set();
        this._rescanId = 0;
        this._applying = false;
        this._suppressAdded = false;
        this._panelBoxes = [
            Main.panel._leftBox,
            Main.panel._centerBox,
            Main.panel._rightBox,
        ];

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

        // AppIndicator 可配置在三个区域，任一区域新增图标都需要补扫。
        this._addedIds = this._panelBoxes.map(box => {
            const id = box.connect('actor-added', () => {
                if (!this._suppressAdded)
                    this._scheduleRescan(80);
            });
            return [box, id];
        });

        // 左键切换抽屉，右键继续交给面板处理。
        this.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            this._toggle();
            return Clutter.EVENT_STOP;
        });

        // PanelMenu.Button 不带弹出菜单时，由扩展处理键盘激活。
        this.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape && this._expanded) {
                this._toggle();
                return Clutter.EVENT_STOP;
            }
            if (![Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_space].includes(key))
                return Clutter.EVENT_PROPAGATE;
            this._toggle();
            return Clutter.EVENT_STOP;
        });

        // 启动竞态：appindicator 图标开机后陆续注册，分多次延迟补扫兜住
        [0, 800, 2000, 4000, 8000].forEach(ms => this._scheduleRescan(ms));
    }

    get drawerBox() {
        return this._drawerBox;
    }

    get drawerActor() {
        return this._drawer;
    }

    _applyDrawerSpacing() {
        const px = this._settings.get_int('drawer-spacing');
        for (const spacer of this._spacers.values())
            spacer.set_width(px);
    }

    // 顶栏图标的「宽间距」来自主题：每个 panel-button 左右各 12px 内边距
    // （Yaru 的 -natural-hpadding），与 appindicator 的 icon-spacing 无关
    // （Ubuntu 22.04 打包的旧版 appindicator 没实现该键）。
    // 保存原内联样式及销毁连接，禁用时还原，退出的程序及时释放引用。
    _applyPanelPadding() {
        const px = this._settings.get_int('panel-hpadding');
        for (const it of this._appindicators()) {
            const indicator = it.indicator;
            if (!this._padded.has(indicator)) {
                const style = indicator.get_style();
                const destroyId = indicator.connect('destroy', () => {
                    this._padded.delete(indicator);
                });
                this._padded.set(indicator, { style, destroyId });
            }
            const original = this._padded.get(indicator).style;
            const prefix = original ? `${original}; ` : '';
            indicator.set_style(
                `${prefix}-natural-hpadding: ${px}px; -minimum-hpadding: ${px}px;`);
        }
    }

    _toggle() {
        this._expanded = !this._expanded;
        this._icon.gicon = this._expanded
            ? this._iconExpanded : this._iconCollapsed;
        // 读屏名称说明当前可执行的动作，不要求用户辨认图形方向。
        this.accessible_name = this._expanded ? '收起托盘图标' : '展开托盘图标';
        // 保留打开状态的样式钩子，当前主题以箭头方向区分展开与收起。
        if (this._expanded)
            this.add_style_pseudo_class('checked');
        else
            this.remove_style_pseudo_class('checked');
        this._animateDrawer();
    }

    _animateDrawer() {
        const drawer = this._drawer;
        const expanded = this._expanded;
        // 连续点击从当前进度反向运行，取消旧动画后不再执行它的完成回调。
        drawer.remove_all_transitions();

        // 遵循桌面的动画开关；空抽屉直接切换，不做无内容的过渡。
        if (!St.Settings.get().enable_animations || this._moved.size === 0) {
            drawer.reveal = expanded ? 1 : 0;
            drawer.opacity = expanded ? 255 : 0;
            drawer.visible = expanded;
            return;
        }

        drawer.visible = true;
        const duration = expanded ? 220 : 160;
        const mode = expanded
            ? Clutter.AnimationMode.EASE_OUT_CUBIC
            : Clutter.AnimationMode.EASE_IN_CUBIC;
        drawer.ease_property('reveal', expanded ? 1 : 0, { duration, mode });
        drawer.ease({
            opacity: expanded ? 255 : 0,
            duration,
            mode,
            onComplete: () => {
                // 收起过渡结束后才隐藏，确保顶栏最终不再为抽屉留空。
                if (this._expanded === expanded)
                    drawer.visible = expanded;
            },
        });
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
        // 配置迁移会同步发出 changed，避免用尚未写完的中间状态重入。
        if (this._applying)
            return;
        this._applying = true;
        try {
            this._applyIndicators();
        } finally {
            this._applying = false;
        }
    }

    _applyIndicators() {
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
        const known = readKnownIndicators(this._settings);
        const collapsed = new Set(this._settings.get_strv('collapsed-ids').map(canonicalId));
        const pinned = new Set(this._settings.get_strv('pinned-ids').map(canonicalId));

        // 存量清洗：id 规范化合并 legacy 重复项，丑标题按新 id 重算
        const map = new Map();
        for (const k of known) {
            const id = canonicalId(k.id);
            let title = k.title;
            if (id.startsWith('legacy:') && String(title).startsWith('legacy:'))
                title = id.slice('legacy:'.length);
            if (!map.has(id))
                map.set(id, { title, peers: new Set() });
            // 重复记录的 peers 也要合并并规范化，不能丢掉防误合并信息。
            for (const peer of k.peers.map(canonicalId)) {
                if (peer !== id)
                    map.get(id).peers.add(peer);
            }
        }

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
            }
            const entry = map.get(it.id);
            if (entry.title !== it.title) {
                entry.title = it.title;
            }
            for (const peer of byTitle.get(it.title)) {
                if (peer !== it.id && !entry.peers.has(peer)) {
                    entry.peers.add(peer);
                }
            }

            // 同名清扫：不在线、又不是 peers 的同 title 旧条目 → 旧身份，合并掉。
            // 当前 id 已有明确设置则只清不迁，避免旧设置覆盖用户现在的选择。
            // 多个同名应用在线时无法判断旧身份归属，保留历史记录与选择。
            if (new Set(byTitle.get(it.title)).size > 1)
                continue;
            for (const [oldId, old] of [...map]) {
                if (oldId === it.id || old.title !== it.title)
                    continue;
                if (liveIds.has(oldId) || entry.peers.has(oldId) ||
                    old.peers.has(it.id))
                    continue;
                map.delete(oldId);
                const hasExplicit = collapsed.has(it.id) || pinned.has(it.id);
                if (!hasExplicit) {
                    if (collapsed.has(oldId))
                        collapsed.add(it.id);
                    else if (pinned.has(oldId))
                        pinned.add(it.id);
                }
                collapsed.delete(oldId);
                pinned.delete(oldId);

                // 身份变化后仍继承旧 peers，并更新其他应用保存的反向关系。
                for (const peer of old.peers)
                    entry.peers.add(peer);
                for (const value of map.values()) {
                    if (value.peers.delete(oldId))
                        value.peers.add(it.id);
                }
            }
        }

        // 全部迁移计算结束后再写配置，避免交叉写入覆盖用户选择。
        for (const [key, ids] of [['collapsed-ids', collapsed], ['pinned-ids', pinned]]) {
            const out = [...ids];
            const before = this._settings.get_strv(key);
            if (out.length !== before.length || out.some((id, i) => id !== before[i]))
                this._settings.set_strv(key, out);
        }
        const entries = [...map].map(([id, value]) =>
            ({ id, title: value.title, peers: [...value.peers] }));
        const serialized = JSON.stringify(entries);
        if (serialized !== this._settings.get_string('known-indicators'))
            this._settings.set_string('known-indicators', serialized);
    }

    _scheduleRescan(ms) {
        // 连续的 actor-added 只排一个补扫，启动阶段的定时补扫仍独立保留。
        if (ms === 80 && this._rescanId)
            return;
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            if (this._rescanId === id)
                this._rescanId = 0;
            this._apply();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        if (ms === 80)
            this._rescanId = id;
    }

    _moveIn(container) {
        if (this._moved.has(container) && container.get_parent() === this._drawerBox)
            return;
        // AppIndicator 改变顶栏区域时会自行搬走图标；以新位置重新记录。
        if (this._moved.has(container))
            this._detach(container);
        const parent = container.get_parent();
        if (!this._panelBoxes.includes(parent))
            return;

        const placeholder = new St.Bin({ visible: false });
        const index = parent.get_children().indexOf(container);
        this._suppressAdded = true;
        try {
            parent.insert_child_at_index(placeholder, index);
            parent.remove_child(container);
        } finally {
            this._suppressAdded = false;
        }
        this._drawerBox.add_child(container);
        const px = this._settings.get_int('drawer-spacing');
        const spacer = new St.Bin({ width: px });
        this._drawerBox.add_child(spacer);
        this._spacers.set(container, spacer);
        // 图标退出时一起销毁间隔与位置标记，不留下空白和失效引用。
        const destroyId = container.connect('destroy', () => {
            this._moved.delete(container);
            this._spacers.delete(container);
            spacer.destroy();
            placeholder.destroy();
        });
        this._moved.set(container, { destroyId, placeholder });
    }

    _moveOut(container) {
        if (!this._moved.has(container))
            return;
        const { placeholder } = this._moved.get(container);
        const parent = placeholder.get_parent() || Main.panel._rightBox;
        // 已由上游搬回面板的图标不再挪动，只清理扩展自己的记录。
        if (container.get_parent() === this._drawerBox) {
            this._suppressAdded = true;
            try {
                this._drawerBox.remove_child(container);
                const index = parent.get_children().indexOf(placeholder);
                parent.insert_child_at_index(container, index);
            } finally {
                this._suppressAdded = false;
            }
        }
        this._detach(container);
    }

    // 只清理位置标记、间隔和销毁连接；容器的搬运由调用方处理。
    _detach(container) {
        const { destroyId, placeholder } = this._moved.get(container);
        if (destroyId)
            container.disconnect(destroyId);
        this._moved.delete(container);
        placeholder.destroy();
        const spacer = this._spacers.get(container);
        if (spacer) {
            spacer.destroy();
            this._spacers.delete(container);
        }
    }

    _restoreAll() {
        for (const container of [...this._moved.keys()]) {
            this._moveOut(container);
        }
        this._moved.clear();
    }

    destroy() {
        // 先取消动画回调，再还原图标，避免禁用后仍访问抽屉。
        this._drawer.remove_all_transitions();
        for (const [box, id] of this._addedIds)
            box.disconnect(id);
        this._addedIds = [];
        for (const sid of this._settingsIds || [])
            this._settings.disconnect(sid);
        this._settingsIds = [];
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();

        this._restoreAll();

        // 还原被覆盖的顶栏图标内边距，交还给主题
        for (const [indicator, original] of this._padded) {
            indicator.disconnect(original.destroyId);
            indicator.set_style(original.style);
        }
        this._padded.clear();

        // 移除抽屉盒子
        if (this._drawer) {
            const parent = this._drawer.get_parent();
            if (parent)
                parent.remove_child(this._drawer);
            this._drawer.destroy();
            this._drawer = null;
            this._drawerBox = null;
        }

        super.destroy();
    }
});

class Extension {
    enable() {
        this._settings = ExtensionUtils.getSettings();
        this._indicator = new TrayCollapseButton(this._settings);
        // 折叠按钮放右盒最靠左（紧挨时钟）。
        Main.panel.addToStatusArea('tray-collapse', this._indicator, 0, 'right');
        // 抽屉盒子插在按钮左侧，展开时图标朝时钟方向铺开。
        Main.panel._rightBox.insert_child_at_index(this._indicator.drawerActor, 0);
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
