# Tray Collapse 托盘折叠

一个 GNOME Shell **42** 扩展：把右上角的 AppIndicator 托盘图标折叠进一个顶栏内可展开的区域（类似 Windows 的溢出区），并支持**逐个图标**选择「收纳 / 常驻」，解决图标越堆越多挤掉时钟的问题。

## 功能

- 顶栏放一个**胶囊按钮**（自带 symbolic 图标，随主题深浅自动着色）：收起时被收纳的图标隐藏、不占空间；点击展开，图标**内联出现在按钮左侧**（再点收起）
- **悬停 / 激活态**：悬停柔光药丸 + 图标提亮；抽屉打开期间按钮显示 Yaru 橙下划线常亮（另有中性提亮 / 橙色填充两种风格，见 `stylesheet.css` 注释）
- 收纳的图标始终是面板**原生按钮**，展开后点击行为完全正常（菜单照常弹出）
- 设置界面里逐个图标开关：**开 = 收纳，关 = 留在顶栏**
- 新出现的图标按「默认行为」自动处理（默认：留在顶栏）
- **间距可调**：抽屉内图标间距、顶栏图标内边距（覆盖主题的 `-natural-hpadding`，appindicator 自带的 `icon-spacing` 在 Ubuntu 22.04 打包的旧版里并未实现）
- **自动去重**：legacy 图标（id 带进程号，如 `legacy:fcitx:4315`）规范化合并；乱报随机 id 的应用（如部分代理客户端）按 title 识别为同一应用并继承设置；同时在线过的同名图标互记 peers，永不误合并
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
    ├── extension.js   # 折叠逻辑：搬运 .container、记录/去重 known-indicators、监听设置
    ├── prefs.js       # GTK4/Adw 设置界面：读 known-indicators 渲染图标开关
    ├── stylesheet.css # 按钮悬停/激活态 + 抽屉内边距
    ├── icons/         # 胶囊 symbolic 图标（收起/展开两态，-symbolic 命名随主题着色）
    └── schemas/org.gnome.shell.extensions.tray-collapse.gschema.xml
```

> 采用**软链接**而非拷贝：改 `src/` 里的代码后，重启 Shell 即生效，git 仓库是唯一真相源。

## 安装

### 方式一：Release zip（推荐）

从 [Releases](https://github.com/fnidore/tray-collapse/releases) 下载 zip：

```bash
gnome-extensions install --force tray-collapse@fnidore.top.shell-extension.zip
# 然后（X11）：Alt+F2 → r → 回车 重启 Shell
gnome-extensions enable tray-collapse@fnidore.top
```

### 方式二：deb 包（Ubuntu）

从 Releases 下载 deb（装到系统目录，所有用户可用）：

```bash
sudo apt install ./gnome-shell-extension-tray-collapse_1_all.deb
# 重启 Shell 后启用
gnome-extensions enable tray-collapse@fnidore.top
```

### 方式三：源码安装（开发）

```bash
git clone https://github.com/fnidore/tray-collapse.git && cd tray-collapse
./install.sh        # 编译 schema + 软链到扩展目录，改代码重启 Shell 即生效
# 然后（X11）：Alt+F2 → r → 回车 重启 Shell
gnome-extensions enable tray-collapse@fnidore.top
gnome-extensions prefs  tray-collapse@fnidore.top   # 打开设置
```

依赖：GNOME Shell 42 + [AppIndicator 扩展](https://github.com/ubuntu/gnome-shell-extension-appindicator)（Ubuntu 22.04 预装）。

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
| `known-indicators` | string(JSON) | 扩展记录的已知图标 `[{id,title,peers}]`（peers=同名但确为不同应用的 id） |
| `drawer-spacing` | int (0-40) | 抽屉内图标间距 px（默认 12） |
| `panel-hpadding` | int (0-24) | 顶栏托盘图标左右内边距 px（默认 12 = Yaru 主题原值，调小即收紧） |

判定优先级：`collapsed-ids` > `pinned-ids` > `default-collapse`。

## 兼容性

仅适配 **GNOME Shell 42 / X11**（本机环境）。其它版本未测试。

## 常用命令

```bash
make logs      # 实时看本扩展日志
make prefs     # 打开设置
make uninstall # 卸载
make pack      # 打包 Release zip（dist/）
make deb       # 打包 deb（dist/）
make clean     # 清理打包产物
```

## 发布

推一个 `v*` 标签即触发 GitHub Actions 自动打包 zip + deb 并创建 Release。
deb 的版本号取自 `metadata.json` 的 `version`，发版前先把它 +1 再打标签，两边保持一致：

```bash
# 1. metadata.json: "version": N+1
git tag v3 && git push origin v3
```

上架 [extensions.gnome.org](https://extensions.gnome.org)：`make pack` 后到
[上传页](https://extensions.gnome.org/upload/) 提交 zip，等待人工审核。
每次重新上传同样需要 `version` 加一。

## 许可证

[GPL-2.0-or-later](LICENSE)（GNOME Shell 扩展惯例）。
