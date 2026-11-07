#!/usr/bin/env bash
# 安装 Tray Collapse：编译 schema → 软链 src 到 GNOME 扩展目录
# 用软链而非拷贝：改项目代码后重启 Shell 即生效，仓库是唯一真相源。
set -euo pipefail

UUID="tray-collapse@fnidore.top"
# 早期临时版，只清理开发安装创建的软链。
OLD_UUID="tray-collapse@taotaoyu.local"
SRC="$(cd "$(dirname "$0")/src" && pwd)"
EXT_BASE="$HOME/.local/share/gnome-shell/extensions"
DEST="$EXT_BASE/$UUID"

# 普通目录可能是用户的 Release 安装，不能用源码软链静默覆盖。
for target in "$DEST" "$EXT_BASE/$OLD_UUID"; do
    if [ -e "$target" ] && [ ! -L "$target" ]; then
        echo "拒绝覆盖已有目录或文件：$target；请先自行备份并移走。" >&2
        exit 1
    fi
done

echo "==> 编译 gsettings schema"
glib-compile-schemas --strict "$SRC/schemas"

# 清理早期临时版（先禁用以触发其 disable() 还原图标，再删目录）
if [ -e "$EXT_BASE/$OLD_UUID" ] || [ -L "$EXT_BASE/$OLD_UUID" ]; then
    echo "==> 清理旧临时版 $OLD_UUID"
    if ! gnome-extensions disable "$OLD_UUID"; then
        echo "未能确认旧扩展已禁用；若它仍在运行，请重启 Shell 后再启用新版。" >&2
    fi
    rm -- "$EXT_BASE/$OLD_UUID"
fi

# 重建软链
if [ -e "$DEST" ] || [ -L "$DEST" ]; then
    rm -- "$DEST"
fi
mkdir -p "$EXT_BASE"
ln -s "$SRC" "$DEST"
echo "==> 已软链: $DEST -> $SRC"

echo
echo "下一步（X11）："
echo "  1) 重启 GNOME Shell：Alt+F2 → 输入 r → 回车"
echo "  2) 启用：gnome-extensions enable $UUID"
echo "  3) 打开设置：gnome-extensions prefs $UUID"
