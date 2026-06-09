# Tray Collapse 托盘折叠

一个 GNOME Shell **42** 扩展：把右上角的 AppIndicator 托盘图标折叠进一个顶栏内可展开的区域（类似 Windows 的溢出区），并支持**逐个图标**选择「收纳 / 常驻」，解决图标越堆越多挤掉时钟的问题。

## 功能

- 顶栏放一个 `⋯` 按钮：收起时被收纳的图标隐藏、不占空间；点击展开，图标**内联出现在 ⋯ 左侧**（再点收起）
- 收纳的图标始终是面板**原生按钮**，展开后点击行为完全正常（菜单照常弹出）
- 设置界面里逐个图标开关：**开 = 收纳，关 = 留在顶栏**
- 新出现的图标按「默认行为」自动处理（默认：留在顶栏）
- 禁用 / 卸载会把图标**原样还原**回顶栏，无残留

> 为什么不用弹出菜单：被收纳的图标本身是面板按钮，若塞进弹出菜单，点击它会先关闭外层菜单导致其自身菜单弹不出。故抽屉做成顶栏内的盒子，靠显隐折叠。

## 目录结构

```
tray-collapse/
├── install.sh      # 编译 schema + 软链到扩展目录（含清理旧临时版）
├── uninstall.sh    # 禁用 + 移除软链
├── Makefile        # make install / enable / prefs / logs ...
└── src/            # 软链到 ~/.local/share/gnome-shell/extensions/<uuid>
    ├── metadata.json
    ├── extension.js   # 折叠逻辑：搬运 .container、记录 known-indicators、监听设置
    ├── prefs.js       # GTK4/Adw 设置界面：读 known-indicators 渲染图标开关
    ├── stylesheet.css
    └── schemas/org.gnome.shell.extensions.tray-collapse.gschema.xml
```

> 采用**软链接**而非拷贝：改 `src/` 里的代码后，重启 Shell 即生效，git 仓库是唯一真相源。

## 安装

```bash
./install.sh
# 然后（X11）：Alt+F2 → r → 回车 重启 Shell
gnome-extensions enable tray-collapse@fnidore.top
gnome-extensions prefs  tray-collapse@fnidore.top   # 打开设置
```

## 工作原理

appindicator 扩展把每个图标注册为 `Main.panel.statusArea['appindicator-<uniqueId>']`，
其中 `._indicator.id` 是应用上报的**稳定 ID**（跨重启不变），用作白名单匹配键；
`.container` 是图标在顶栏里的实体，搬进 / 搬出抽屉即实现折叠 / 展开。

设置界面 `prefs.js` 运行在**独立进程**，读不到 Shell 的 `statusArea`，
因此扩展进程把见过的图标写进 gsettings 的 `known-indicators`(JSON)，
设置界面读取它来渲染图标列表（跨进程桥接）。

### 设置键 (gsettings)

| key | 类型 | 含义 |
|-----|------|------|
| `default-collapse` | bool | 新图标默认是否收纳（默认 false=留顶栏） |
| `pinned-ids` | string[] | 强制常驻顶栏的图标 id |
| `collapsed-ids` | string[] | 强制收进抽屉的图标 id |
| `known-indicators` | string(JSON) | 扩展记录的已知图标 `[{id,title}]` |

判定优先级：`collapsed-ids` > `pinned-ids` > `default-collapse`。

## 兼容性

仅适配 **GNOME Shell 42 / X11**（本机环境）。其它版本未测试。

## 常用命令

```bash
make logs      # 实时看本扩展日志
make prefs     # 打开设置
make uninstall # 卸载
```
