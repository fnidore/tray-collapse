const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// 用同步信号替身模拟 GSettings 重入和 actor 生命周期，不连接当前桌面。
class Signals {
    constructor() {
        this.handlers = new Map();
        this.nextId = 1;
    }

    connect(name, callback) {
        const id = this.nextId++;
        this.handlers.set(id, { name, callback });
        return id;
    }

    disconnect(id) {
        assert.ok(this.handlers.delete(id), `未知信号 ${id}`);
    }

    emit(name, ...args) {
        for (const handler of [...this.handlers.values()]) {
            if (handler.name === name)
                handler.callback(this, ...args);
        }
    }
}

class Actor extends Signals {
    constructor(props = {}) {
        super();
        Object.assign(this, props);
        this.children = [];
        this.parent = null;
        this.style = null;
        this.destroyed = false;
        this.visible = props.visible ?? true;
        this.opacity = 255;
        this.scale_x = 1;
        this.scale_y = 1;
        this.translation_x = 0;
        this.translation_y = 0;
        this.rotation_angle_z = 0;
        this.transitions = new Map();
    }

    _init(props = {}) { Object.assign(this, props); }
    queue_relayout() {
        this.layoutRequests = (this.layoutRequests || 0) + 1;
    }
    set_clip(x, y, width, height) { this.clip = { x, y, width, height }; }
    remove_clip() { this.clip = null; }
    set_allocation(box) { this.allocation = box; }
    allocate(box) { this.allocation = box; }
    get_preferred_width() { return [40, 100]; }
    get_preferred_height() { return [24, 24]; }
    set_pivot_point(x, y) { this.pivot = { x, y }; }
    remove_all_transitions() { this.transitions.clear(); }
    ease_property(property, target, params) {
        this.transitions.set(property, { target, ...params });
    }
    ease(params) {
        let first = true;
        for (const [property, target] of Object.entries(params)) {
            if (['duration', 'mode', 'onComplete'].includes(property))
                continue;
            this.transitions.set(property, {
                target,
                duration: params.duration,
                mode: params.mode,
                onComplete: first ? params.onComplete : undefined,
            });
            first = false;
        }
    }
    finishAnimations() {
        const transitions = [...this.transitions];
        this.transitions.clear();
        const callbacks = [];
        for (const [property, transition] of transitions) {
            this[property] = transition.target;
            if (transition.onComplete)
                callbacks.push(transition.onComplete);
        }
        for (const callback of callbacks)
            callback();
    }

    get_parent() { return this.parent; }
    get_children() { return [...this.children]; }
    get_style() { return this.style; }
    set_style(style) { this.style = style; }
    set_width(width) { this.width = width; }
    add_style_class_name() {}
    add_style_pseudo_class() {}
    remove_style_pseudo_class() {}

    add_child(child) {
        this.insert_child_at_index(child, -1);
    }

    insert_child_at_index(child, index) {
        assert.equal(child.parent, null);
        assert.equal(child.destroyed, false);
        if (index < 0)
            index = this.children.length;
        this.children.splice(index, 0, child);
        child.parent = this;
        this.emit('actor-added', child);
    }

    remove_child(child) {
        assert.equal(child.parent, this);
        this.children.splice(this.children.indexOf(child), 1);
        child.parent = null;
    }

    destroy() {
        if (this.destroyed)
            return;
        this.emit('destroy');
        for (const child of [...this.children])
            child.destroy();
        if (this.parent)
            this.parent.remove_child(this);
        this.handlers.clear();
        this.destroyed = true;
    }
}

class Button extends Actor {
    _init() {}
}

class Settings extends Signals {
    constructor(values = {}) {
        super();
        this.values = {
            'character-id': 'sakura',
            'known-indicators': '[]',
            'collapsed-ids': [],
            'pinned-ids': [],
            'default-collapse': false,
            'panel-hpadding': 12,
            'drawer-spacing': 12,
            ...values,
        };
        this.writes = 0;
    }

    get_strv(key) { return [...this.values[key]]; }
    get_string(key) { return this.values[key]; }
    get_boolean(key) { return this.values[key]; }
    get_int(key) { return this.values[key]; }
    set_strv(key, value) { this.set(key, [...value]); }
    set_string(key, value) { this.set(key, value); }

    set(key, value) {
        assert.ok(this.writes++ < 100, '配置写入发生循环');
        this.values[key] = value;
        this.emit(`changed::${key}`);
    }
}

function fixture(values = {}) {
    const animationSettings = { enable_animations: false };
    const panel = {
        _leftBox: new Actor(),
        _centerBox: new Actor(),
        _rightBox: new Actor(),
        statusArea: {},
    };
    const sources = new Map();
    const settings = new Settings(values);
    let nextSource = 1;
    const sourceDir = path.resolve(__dirname, '../src');
    const shared = vm.createContext({ log() {}, logError() {} });
    vm.runInContext(fs.readFileSync(`${sourceDir}/indicatorSettings.js`, 'utf8'), shared);
    const characters = vm.createContext({});
    vm.runInContext(fs.readFileSync(`${sourceDir}/characters.js`, 'utf8'), characters);
    const context = vm.createContext({
        imports: {
            gi: {
                Clutter: {
                    KEY_Return: 65293,
                    KEY_KP_Enter: 65421,
                    KEY_space: 32,
                    KEY_Escape: 65307,
                    EVENT_STOP: true,
                    EVENT_PROPAGATE: false,
                    ActorBox: class {},
                    AnimationMode: {
                        EASE_OUT_CUBIC: 1,
                        EASE_IN_CUBIC: 2,
                        EASE_OUT_QUAD: 3,
                        EASE_IN_OUT_QUAD: 4,
                        EASE_OUT_SINE: 5,
                    },
                },
                Gio: { icon_new_for_string: value => value },
                GLib: {
                    timeout_add(_priority, delay, callback) {
                        const id = nextSource++;
                        sources.set(id, { delay, callback });
                        return id;
                    },
                    source_remove(id) { sources.delete(id); },
                },
                GObject: {
                    ParamSpec: { double: () => ({}) },
                    ParamFlags: { READWRITE: 1 },
                    registerClass(metadata, definition) {
                        const Registered = definition || metadata;
                        return class extends Registered {
                            constructor(...args) {
                                super();
                                if (args.length)
                                    this._init(...args);
                            }
                        };
                    },
                },
                St: {
                    Icon: Actor, BoxLayout: Actor, Bin: Actor, Widget: Actor,
                    Settings: { get: () => animationSettings },
                },
            },
            ui: { main: { panel }, panelMenu: { Button } },
            misc: {
                extensionUtils: {
                    getCurrentExtension: () => ({
                        path: sourceDir,
                        imports: { indicatorSettings: shared, characters },
                    }),
                },
            },
        },
    });
    vm.runInContext(fs.readFileSync(`${sourceDir}/extension.js`, 'utf8'), context);
    const TrayButton = vm.runInContext('TrayCollapseButton', context);
    const button = new TrayButton();
    button._init(settings);

    function add(id, title = id, box = panel._rightBox) {
        const indicator = new Actor();
        indicator._indicator = { id, title };
        indicator.container = new Actor();
        // 模拟 PanelMenu.Button 销毁时一并销毁自己的容器。
        indicator.container.connect('destroy', () => indicator.destroy());
        panel.statusArea[`appindicator-${id}`] = indicator;
        box.add_child(indicator.container);
        return indicator;
    }

    return { panel, settings, sources, shared, button, add, animationSettings };
}

test('程序退出时清理间隔、位置标记和样式引用', () => {
    const { add, button, panel } = fixture({ 'default-collapse': true });
    const indicator = add('app');
    button._apply();
    indicator.container.destroy();
    assert.equal(button._spacers.size, 0);
    assert.equal(button._moved.size, 0);
    assert.equal(button._padded.size, 0);
    assert.equal(button.drawerBox.children.length, 0);
    assert.equal(panel._rightBox.children.length, 0);
    button.destroy();
});

test('禁用时保持各区域图标顺序、原内联样式，并清理所有外部连接', () => {
    const { add, button, panel, settings, sources } = fixture({ 'default-collapse': true });
    const before = new Map();
    for (const box of [panel._leftBox, panel._centerBox, panel._rightBox]) {
        box.add_child(new Actor());
        const first = add(`first-${before.size}`, 'First', box);
        first.set_style('color: red;');
        add(`second-${before.size}`, 'Second', box);
        box.add_child(new Actor());
        before.set(box, box.get_children());
    }
    button._apply();
    button.destroy();
    for (const [box, children] of before) {
        assert.deepEqual(box.get_children(), children);
        assert.equal(box.handlers.size, 0);
    }
    for (const indicator of Object.values(panel.statusArea))
        assert.equal(indicator.get_style(), indicator._indicator.title === 'First' ? 'color: red;' : null);
    assert.equal(settings.handlers.size, 0);
    assert.equal(sources.size, 0);
});

test('上游重新定位图标后，按新区域重新收纳并恢复', () => {
    const { add, button, panel } = fixture({ 'default-collapse': true });
    const indicator = add('app');
    button._apply();
    button.drawerBox.remove_child(indicator.container);
    panel._leftBox.add_child(indicator.container);
    button._apply();
    assert.equal(indicator.container.get_parent(), button.drawerBox);
    button.destroy();
    assert.equal(indicator.container.get_parent(), panel._leftBox);
    assert.equal(panel._rightBox.children.length, 0);
});

test('短时间新增图标只安排一次补扫，左中右区域都被监听', () => {
    const { add, sources, panel } = fixture();
    add('left', 'Left', panel._leftBox);
    add('center', 'Center', panel._centerBox);
    add('right');
    assert.equal([...sources.values()].filter(source => source.delay === 80).length, 1);
});

test('旧 legacy 身份迁移不会同步重入，重复记录与 peers 被合并', () => {
    const { add, button, settings } = fixture({
        'known-indicators': JSON.stringify([
            { id: 'legacy:fcitx:10', title: 'legacy:fcitx:10', peers: ['legacy:other:1'] },
            { id: 'legacy:fcitx:20', title: 'fcitx', peers: ['extra'] },
        ]),
        'collapsed-ids': ['legacy:fcitx:10', 'legacy:fcitx:20'],
    });
    add('legacy:fcitx:30', 'fcitx');
    let calls = 0;
    const apply = button._applyIndicators.bind(button);
    button._applyIndicators = () => {
        calls++;
        apply();
    };
    button._apply();
    assert.equal(calls, 1);
    assert.deepEqual(settings.get_strv('collapsed-ids'), ['legacy:fcitx']);
    const known = JSON.parse(settings.get_string('known-indicators'));
    assert.equal(known.length, 1);
    assert.deepEqual(known[0].peers, ['legacy:other', 'extra']);
    const writes = settings.writes;
    button._apply();
    assert.equal(settings.writes, writes);
});

test('随机身份迁移继承收纳选择和双向 peers，并尊重当前明确选择', () => {
    const { add, button, settings } = fixture({
        'known-indicators': JSON.stringify([
            { id: 'old', title: 'Proxy', peers: ['separate'] },
            { id: 'separate', title: 'Proxy', peers: ['old'] },
        ]),
        'collapsed-ids': ['old'],
    });
    add('new', 'Proxy');
    button._apply();
    assert.deepEqual(settings.get_strv('collapsed-ids'), ['new']);
    const known = JSON.parse(settings.get_string('known-indicators'));
    assert.equal(known.length, 2);
    assert.deepEqual(known.find(entry => entry.id === 'new').peers, ['separate']);
    assert.deepEqual(known.find(entry => entry.id === 'separate').peers, ['new']);

    const second = fixture({
        'known-indicators': '[{"id":"old","title":"Proxy"}]',
        'collapsed-ids': ['old'],
        'pinned-ids': ['new'],
    });
    second.add('new', 'Proxy');
    second.button._apply();
    assert.deepEqual(second.settings.get_strv('collapsed-ids'), []);
    assert.deepEqual(second.settings.get_strv('pinned-ids'), ['new']);
});

test('多个同名应用同时在线时不猜测旧配置的归属', () => {
    const { add, button, settings } = fixture({
        'known-indicators': '[{"id":"old","title":"Same"}]',
        'collapsed-ids': ['old'],
    });
    add('one', 'Same');
    add('two', 'Same');
    button._apply();
    assert.deepEqual(settings.get_strv('collapsed-ids'), ['old']);
    const known = JSON.parse(settings.get_string('known-indicators'));
    assert.equal(known.length, 3);
    assert.deepEqual(known.find(entry => entry.id === 'one').peers, ['two']);
});

test('损坏 JSON 和错误结构不会阻止活跃图标被发现和处理', () => {
    for (const raw of ['{', '{}', 'null', '[null,{},1,{"id":"valid","peers":42}]']) {
        const { add, button, settings } = fixture({ 'known-indicators': raw });
        add('live');
        assert.doesNotThrow(() => button._apply());
        const known = JSON.parse(settings.get_string('known-indicators'));
        assert.ok(known.some(entry => entry.id === 'live'));
        assert.ok(known.every(entry => Array.isArray(entry.peers)));
    }
});

test('收纳、常驻、默认值保持既有优先级', () => {
    const { button } = fixture({
        'collapsed-ids': ['both'],
        'pinned-ids': ['both', 'pinned'],
        'default-collapse': true,
    });
    assert.equal(button._shouldCollapse('both'), true);
    assert.equal(button._shouldCollapse('pinned'), false);
    assert.equal(button._shouldCollapse('unknown'), true);
});

test('左键和 Enter/空格可切换抽屉，右键和其他按键不改变状态', () => {
    const { button } = fixture();
    button.emit('button-press-event', { get_button: () => 3 });
    assert.equal(button.drawerActor.visible, false);
    button.emit('button-press-event', { get_button: () => 1 });
    assert.equal(button.drawerActor.visible, true);
    button.emit('key-press-event', { get_key_symbol: () => 65293 });
    assert.equal(button.drawerActor.visible, false);
    button.emit('key-press-event', { get_key_symbol: () => 32 });
    assert.equal(button.drawerActor.visible, true);
    button.emit('key-press-event', { get_key_symbol: () => 65 });
    assert.equal(button.drawerActor.visible, true);
});

test('扫描失败保留异常，下一次扫描仍可运行', () => {
    const { button } = fixture();
    const apply = button._applyIndicators;
    button._applyIndicators = () => { throw new Error('模拟外部错误'); };
    assert.throws(() => button._apply(), /模拟外部错误/);
    assert.equal(button._applying, false);
    button._applyIndicators = apply;
    assert.doesNotThrow(() => button._apply());
});

test('Escape 收起抽屉，并同步读屏动作名称', () => {
    const { button } = fixture();
    button.emit('key-press-event', { get_key_symbol: () => 32 });
    assert.equal(button.accessible_name, '收起托盘图标');
    button.emit('key-press-event', { get_key_symbol: () => 65307 });
    assert.equal(button.drawerActor.visible, false);
    assert.equal(button.accessible_name, '展开托盘图标');
    button.emit('key-press-event', { get_key_symbol: () => 65307 });
    assert.equal(button.drawerActor.visible, false);
});

test('展开和收起分别动画，收起结束后才隐藏并释放宽度', () => {
    const { add, button, animationSettings } = fixture();
    add('app');
    button._moveIn(Object.values(button._appindicators())[0].container);
    animationSettings.enable_animations = true;
    const drawer = button.drawerActor;
    button._toggle();
    assert.equal(drawer.visible, true);
    assert.equal(drawer.transitions.get('reveal').target, 1);
    assert.equal(drawer.transitions.get('reveal').duration, 300);
    drawer.finishAnimations();
    assert.equal(drawer.reveal, 1);
    assert.equal(drawer.opacity, 255);

    button._toggle();
    assert.equal(drawer.visible, true);
    assert.equal(drawer.transitions.get('reveal').duration, 220);
    drawer.finishAnimations();
    assert.equal(drawer.visible, false);
    assert.equal(drawer.reveal, 0);
});

test('快速反向点击取消旧动画，减少动画设置直接到达最终状态', () => {
    const { add, button, animationSettings } = fixture({ 'default-collapse': true });
    add('app');
    button._apply();
    animationSettings.enable_animations = true;
    const drawer = button.drawerActor;
    button._toggle();
    drawer.reveal = 0.4;
    button._toggle();
    assert.equal(drawer.reveal, 0.4);
    assert.equal(drawer.transitions.get('reveal').target, 0);
    button._toggle();
    drawer.finishAnimations();
    assert.equal(drawer.visible, true);
    assert.equal(drawer.reveal, 1);

    animationSettings.enable_animations = false;
    button._toggle();
    assert.equal(drawer.visible, false);
    assert.equal(drawer.reveal, 0);
    assert.equal(drawer.transitions.size, 0);
});

test('动画仅裁剪内容，进度不改变顶栏请求宽度或触发重新排版', () => {
    const { button } = fixture();
    const drawer = button.drawerActor;
    drawer.reveal = 0.5;
    assert.deepEqual([...drawer.vfunc_get_preferred_width(24)], [40, 100]);
    drawer.vfunc_allocate({ x1: 0, x2: 100, y1: 0, y2: 24 });
    assert.equal(button.drawerBox.allocation.x1, 0);
    assert.equal(button.drawerBox.allocation.x2, 100);
    assert.equal(button.drawerBox.allocation.y2, 24);
    assert.deepEqual(button.drawerBox.clip, { x: 50, y: 0, width: 50, height: 24 });

    // 每个动画进度都只更新裁剪，不能让相邻的面板按钮反复分配宽度。
    for (const progress of [0, 0.1, 0.25, 0.9, 1]) {
        drawer.reveal = progress;
        assert.deepEqual([...drawer.vfunc_get_preferred_width(24)], [40, 100]);
    }
    assert.equal(drawer.layoutRequests || 0, 0);
    assert.equal(button.drawerBox.clip, null);
});

test('动画中的面板尺寸变化会使用新分配更新裁剪边界', () => {
    const { button } = fixture();
    const drawer = button.drawerActor;
    drawer.reveal = 0.25;
    drawer.vfunc_allocate({ x1: 0, x2: 80, y1: 0, y2: 24 });
    assert.deepEqual(button.drawerBox.clip, { x: 60, y: 0, width: 20, height: 24 });
    drawer.vfunc_allocate({ x1: 0, x2: 120, y1: 0, y2: 28 });
    assert.deepEqual(button.drawerBox.clip, { x: 90, y: 0, width: 30, height: 28 });
});

test('动画中程序退出后可完成收起，禁用时取消动画并还原图标', () => {
    const { add, button, panel, animationSettings } = fixture({ 'default-collapse': true });
    const exiting = add('exiting');
    const remaining = add('remaining');
    button._apply();
    animationSettings.enable_animations = true;
    button._toggle();
    exiting.container.destroy();
    const drawer = button.drawerActor;
    button._toggle();
    drawer.finishAnimations();
    assert.equal(drawer.visible, false);
    button._toggle();
    button.destroy();
    assert.equal(drawer.transitions.size, 0);
    assert.equal(drawer.destroyed, true);
    assert.equal(remaining.container.parent, panel._rightBox);
});

test('一体按钮由少女表情表示状态，减少动画时直接切换并保持自然姿态', () => {
    const { button } = fixture();
    assert.deepEqual(button.get_children(), [button._avatar]);
    assert.ok(button._avatar.gicon.endsWith('/anime-girl-collapsed.png'));
    button._toggle();
    assert.ok(button._avatar.gicon.endsWith('/anime-girl-expanded.png'));
    assert.equal(button._avatar.transitions.size, 0);
    button._toggle();
    assert.ok(button._avatar.gicon.endsWith('/anime-girl-collapsed.png'));
    assert.equal(button._avatar.scale_x, 1);
    assert.equal(button._avatar.scale_y, 1);
    assert.equal(button._avatar.translation_y, 0);
    assert.equal(button._avatar.rotation_angle_z, 0);
});

test('弹出轻抬眨眼，收入点头闭眼，两套动作结束后都复位且不请求重新布局', () => {
    const { add, button, animationSettings } = fixture({ 'default-collapse': true });
    add('app');
    button._apply();
    animationSettings.enable_animations = true;
    const avatar = button._avatar;
    button._toggle();
    assert.equal(avatar.transitions.get('rotation_angle_z').target, -8);
    assert.equal(avatar.transitions.get('scale_y').target, 1.10);
    assert.equal(button.drawerBox.translation_x, 12);
    assert.equal(button.drawerBox.transitions.get('translation_x').target, 0);
    avatar.finishAnimations();
    avatar.finishAnimations();
    button.drawerBox.finishAnimations();
    button.drawerActor.finishAnimations();
    assert.equal(avatar.rotation_angle_z, 0);
    assert.equal(avatar.translation_y, 0);
    assert.equal(avatar.scale_y, 1);

    button._toggle();
    assert.equal(avatar.transitions.get('rotation_angle_z').target, 6);
    assert.equal(avatar.transitions.get('scale_y').target, 0.86);
    assert.equal(button.drawerBox.transitions.get('translation_x').target, 12);
    avatar.finishAnimations();
    avatar.finishAnimations();
    button.drawerBox.finishAnimations();
    button.drawerActor.finishAnimations();
    assert.equal(avatar.rotation_angle_z, 0);
    assert.equal(avatar.translation_y, 0);
    assert.equal(avatar.scale_y, 1);
    assert.equal(button.drawerBox.translation_x, 0);
    assert.equal(button.drawerActor.visible, false);
    assert.equal(avatar.layoutRequests || 0, 0);
    assert.equal(button.drawerBox.layoutRequests || 0, 0);
});

test('快速切换和禁用使旧表情回调失效，所有关联动画都被清理', () => {
    const { add, button, animationSettings } = fixture({ 'default-collapse': true });
    add('app');
    button._apply();
    animationSettings.enable_animations = true;
    button._toggle();
    const avatar = button._avatar;
    const content = button.drawerBox;
    const drawer = button.drawerActor;
    const oldCallback = [...avatar.transitions.values()].find(value => value.onComplete).onComplete;
    button._toggle();
    oldCallback();
    assert.equal(avatar.transitions.get('rotation_angle_z').target, 6);
    const closingCallback = [...avatar.transitions.values()].find(value => value.onComplete).onComplete;
    button.destroy();
    assert.doesNotThrow(closingCallback);
    assert.equal(avatar.transitions.size, 0);
    assert.equal(content.transitions.size, 0);
    assert.equal(drawer.transitions.size, 0);
});

test('启动时读取已保存角色，切换时保留当前收放状态和托盘选择', () => {
    const { button, settings } = fixture({
        'character-id': 'mint',
        'collapsed-ids': ['saved-collapse'],
        'pinned-ids': ['saved-pin'],
    });
    assert.ok(button._avatar.gicon.endsWith('/characters/mint-collapsed.png'));
    settings.set_string('character-id', 'luna');
    assert.ok(button._avatar.gicon.endsWith('/characters/luna-collapsed.png'));
    button._toggle();
    settings.set_string('character-id', 'amber');
    assert.equal(button._expanded, true);
    assert.ok(button._avatar.gicon.endsWith('/characters/amber-expanded.png'));
    assert.equal(button._avatar.icon_size, 26);
    assert.deepEqual(settings.get_strv('collapsed-ids'), ['saved-collapse']);
    assert.deepEqual(settings.get_strv('pinned-ids'), ['saved-pin']);
});

test('动画中选择新角色不会重启动画或丢失进度，结束后新表情保持正确', () => {
    const { add, button, settings, animationSettings } = fixture({ 'default-collapse': true });
    add('app');
    button._apply();
    animationSettings.enable_animations = true;
    button._toggle();
    button.drawerActor.reveal = 0.4;
    const serial = button._motionSerial;
    settings.set_string('character-id', 'mint');
    assert.equal(button._motionSerial, serial);
    assert.equal(button.drawerActor.reveal, 0.4);
    assert.equal(button.drawerActor.transitions.get('reveal').target, 1);
    button._avatar.finishAnimations();
    button._avatar.finishAnimations();
    button.drawerBox.finishAnimations();
    button.drawerActor.finishAnimations();
    assert.ok(button._avatar.gicon.endsWith('/characters/mint-expanded.png'));
    assert.equal(button._avatar.scale_y, 1);
    assert.equal(button.drawerActor.reveal, 1);
    button._toggle();
    assert.ok(button._avatar.gicon.endsWith('/characters/mint-collapsed.png'));
});
