#!/usr/bin/env bash
# 安装 Tray Collapse：编译 schema → 软链 src 到 GNOME 扩展目录
# 用软链而非拷贝：改项目代码后重启 Shell 即生效，仓库是唯一真相源。
set -euo pipefail

UUID="tray-collapse@fnidore.top"
OLD_UUID="tray-collapse@taotaoyu.local"   # 早期临时版，自动清理
SRC="$(cd "$(dirname "$0")/src" && pwd)"
EXT_BASE="$HOME/.local/share/gnome-shell/extensions"
DEST="$EXT_BASE/$UUID"

echo "==> 编译 gsettings schema"
glib-compile-schemas "$SRC/schemas"

# 清理早期临时版（先禁用以触发其 disable() 还原图标，再删目录）
if [ -e "$EXT_BASE/$OLD_UUID" ] || [ -L "$EXT_BASE/$OLD_UUID" ]; then
    echo "==> 清理旧临时版 $OLD_UUID"
    gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
    rm -rf "$EXT_BASE/$OLD_UUID"
fi

# 重建软链
if [ -e "$DEST" ] || [ -L "$DEST" ]; then
    rm -rf "$DEST"
fi
mkdir -p "$EXT_BASE"
ln -s "$SRC" "$DEST"
echo "==> 已软链: $DEST -> $SRC"

echo
echo "下一步（X11）："
echo "  1) 重启 GNOME Shell：Alt+F2 → 输入 r → 回车"
echo "  2) 启用：gnome-extensions enable $UUID"
echo "  3) 打开设置：gnome-extensions prefs $UUID"
