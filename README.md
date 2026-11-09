# Tray Collapse 托盘折叠

一个 GNOME Shell **42** 扩展：把右上角的 AppIndicator 托盘图标折叠进一个顶栏内可展开的区域（类似 Windows 的溢出区），并支持**逐个图标**选择「收纳 / 常驻」，解决图标越堆越多挤掉时钟的问题。

**当前版本：[v4 · 角色选择与一体式收放动画](https://github.com/fnidore/tray-collapse/releases/tag/v4)**

[下载 zip](https://github.com/fnidore/tray-collapse/releases/download/v4/tray-collapse%40fnidore.top.shell-extension.zip) · [下载 deb](https://github.com/fnidore/tray-collapse/releases/download/v4/gnome-shell-extension-tray-collapse_4_all.deb) · [查看更新说明](release-notes/v4.md)

## 桌面演示

![实际桌面录屏：四位角色切换与展开、收起动画](docs/demo/desktop-demo.gif)

GNOME Shell 42.9 / X11 实际桌面录屏，按原速依次展示樱桃、月白、薄荷和琥珀的即时切换与收放动作。画面仅截取顶栏托盘区域，角色名和动作提示位于截图外。

## 角色与动画

![四位可选角色与收放表情](docs/design/character-lineup.png)

| 角色 | 外观 |
| --- | --- |
| 樱桃 · 元气少女（默认） | 粉色短发、星形发卡 |
| 月白 · 银发猫耳 | 银白短发、蓝色眼睛、藏蓝蝴蝶结 |
| 薄荷 · 森林精灵 | 薄荷绿发、精灵耳、叶片发饰与侧辫 |
| 琥珀 · 狐耳少女 | 暖橘卷发、蓬松狐耳、红色蝴蝶结 |

每位角色都有两种表情，预览图左侧为「收好」，右侧为「弹出」。展开时眨眼轻抬，将图标向左送出；收起时闭眼点头，将图标收回。四位角色共用这两套动作。

在设置的「角色外观」点击角色整行即可切换并自动保存，无需重载桌面。切换角色会保留当前收放状态、正在进行的动画以及原有托盘配置。

## 功能

- 顶栏使用**一体式 Q 版少女按钮**：26px 彩色透明底头像，闭眼微笑表示已收好，眨眼表示已弹出；不再额外放置方向箭头
- **角色可选**：设置中的「角色外观」提供樱桃（粉发少女）、月白（银发猫耳）、薄荷（森林精灵）、琥珀（狐耳少女）的双表情预览；点击即时切换并保存，默认保留樱桃，不影响托盘收纳选择
- **轻量样式**：常态透明，无底座、边框和装饰线；悬停与键盘焦点显示淡灰背景，保留完整点击区域
- **两套收放动作**：弹出时少女眨眼、轻抬，图标约 300ms 向左送出并淡入；收入时少女闭眼点头，图标约 220ms 向她靠回并淡出。动作结束后恢复自然姿态，快速连点可切换；关闭桌面动画时直接切换表情与状态
- 收纳的图标始终是面板**原生按钮**，展开后点击行为完全正常（菜单照常弹出）
- 设置界面里逐个图标开关：**开 = 收纳，关 = 留在顶栏**
- 设置窗口实时同步新图标、默认行为、逐图标选择和间距，无需关闭重开；按钮支持 Enter / 空格展开收起，按钮获得焦点时 Esc 收起，读屏名称同步提示可执行的动作
- 新出现的图标按「默认行为」自动处理（默认：留在顶栏）
- **间距可调**：抽屉内图标间距、顶栏图标内边距（覆盖主题的 `-natural-hpadding`，appindicator 自带的 `icon-spacing` 在 Ubuntu 22.04 打包的旧版里并未实现）
- **自动去重**：legacy 图标（id 带进程号，如 `legacy:fcitx:4315`）规范化合并；乱报随机 id 的应用（如部分代理客户端）按 title 识别为同一应用并继承设置；同时在线过的同名图标互记 peers，永不误合并
- 禁用会把图标还原到**原面板区域和相邻位置**，恢复原内联样式；程序退出时清理对应间隔和位置标记

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
    ├── indicatorSettings.js # Shell 与设置窗口共用的配置读取和校验
    ├── characters.js   # Shell 与设置窗口共用的四位角色目录
    ├── stylesheet.css # 按钮悬停/激活态 + 抽屉内边距
    ├── icons/         # 少女闭眼/眨眼两种表情，保留早期头像和箭头素材
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
sudo apt install ./gnome-shell-extension-tray-collapse_4_all.deb
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

源码安装和卸载脚本只替换或移除软链接。若目标位置已是普通目录，脚本会拒绝覆盖或删除；请先备份，再使用对应的扩展管理器或软件包管理器处理原安装。

## 使用与升级

1. 打开设置：运行 `gnome-extensions prefs tray-collapse@fnidore.top`，或在项目目录执行 `make prefs`。
2. 在「角色外观」选中喜欢的角色，即时生效，重新登录后也会保留。
3. 在托盘图标列表中，打开开关表示「收纳」，关闭表示「留在顶栏」。展开后仍可直接点击原生图标打开各应用菜单。
4. 点击顶栏角色展开或收起。角色按钮获得焦点后，可用 Enter / 空格切换、Esc 收起；关闭系统动画时直接切换表情和状态。

**已有用户升级：**沿用原安装方式，zip 使用 `gnome-extensions install --force`，deb 使用 `sudo apt install ./gnome-shell-extension-tray-collapse_4_all.deb`。源码软链安装则在项目目录执行 `git pull --ff-only` 和 `make schemas`。更新文件后，在 X11 下按 `Alt+F2` → 输入 `r` → 回车，让运行中的 Shell 重新加载扩展。原来的收纳、常驻、间距与角色选择无需重新设置。

用户目录的 zip / 源码安装与系统目录的 deb 安装使用同一扩展 UUID；用户目录版本优先加载。升级时请沿用当前方式，避免安装了新系统包却仍加载用户目录的旧版本。可用 `gnome-extensions info tray-collapse@fnidore.top` 核对实际加载路径、版本和启用状态。

## 工作原理

appindicator 扩展把每个图标注册为 `Main.panel.statusArea['appindicator-<uniqueId>']`，
其中 `._indicator.id` 是应用上报的**稳定 ID**（跨重启不变），用作白名单匹配键；
`.container` 是图标在顶栏里的实体，搬进 / 搬出抽屉即实现折叠 / 展开。
收纳时会在原面板区域留下不可见的位置标记，放出或禁用时按标记还原；AppIndicator 把图标改到左、中、右任一区域时，也会重新记录位置。
动画开始时一次分配完整布局宽度，期间只改变裁剪区域、透明度和绘制位移，少女的姿态变化也只使用绘制变换，不逐帧挤压顶栏；收起完成后隐藏外层，释放顶栏空间。

设置界面 `prefs.js` 运行在**独立进程**，读不到 Shell 的 `statusArea`，
因此扩展进程把见过的图标写进 gsettings 的 `known-indicators`(JSON)，
设置界面读取它来渲染图标列表（跨进程桥接）。

### 设置键 (gsettings)

| key | 类型 | 含义 |
|-----|------|------|
| `character-id` | string | 顶栏角色：`sakura` / `luna` / `mint` / `amber`，默认 `sakura` |
| `default-collapse` | bool | 新图标默认是否收纳（默认 false=留顶栏） |
| `pinned-ids` | string[] | 强制常驻顶栏的图标 id |
| `collapsed-ids` | string[] | 强制收进抽屉的图标 id |
| `known-indicators` | string(JSON) | 扩展记录的已知图标 `[{id,title,peers}]`（peers=同名但确为不同应用的 id） |
| `drawer-spacing` | int (0-40) | 抽屉内图标间距 px（默认 12） |
| `panel-hpadding` | int (0-24) | 顶栏托盘图标左右内边距 px（默认 12 = Yaru 主题原值，调小即收紧） |

判定优先级：`collapsed-ids` > `pinned-ids` > `default-collapse`。

同标题推断仍有边界：从未同时在线过的不同应用，如果上报相同标题，可能被当成同一应用的旧身份。多个同名图标当前同时在线时，扩展会保留归属不明确的历史条目；已记录的 peers 会在可判断的身份迁移中保留。

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

## 本地检查

基础检查需要 Node.js 18+、Bash 和 GLib 工具；扩展运行本身不依赖 Node.js：

```bash
make check        # 逻辑回归、隔离安装/卸载、脚本语法、schema 校验
make test-prefs   # 真实 GTK4/Adw 设置窗口检查，需要 gjs、gir1.2-adw-1、xvfb、dbus-run-session
make pack deb     # 验证 zip / deb 打包
```

测试使用临时安装目录、内存 GSettings 和隔离显示，不修改当前桌面的托盘配置。逻辑回归使用面板替身，不能替代真实 Shell 中的菜单点击、主题布局和扩展冲突验证。GitHub Actions 在推送、PR 和发布前运行上述回归与设置窗口检查。

v4 发布时的 24 项逻辑回归、隔离安装/卸载和真实 GTK4/Adw 设置窗口检查已通过，发布后的 zip / deb 下载内容也已与源码逐文件核对。2026-11-09 在 GNOME Shell 42.9 / X11 桌面重新加载 v4 后，逐一验证了四位角色即时切换、展开与收起动画；动画采样期间右侧系统图标位置保持不变，扩展错误列表为空。其他 GNOME 版本、Wayland 及不同扩展组合仍需另行验证。

维护者发布流程见 [发布指南](docs/RELEASING.md)。

## 许可证

[GPL-2.0-or-later](LICENSE)（GNOME Shell 扩展惯例）。
