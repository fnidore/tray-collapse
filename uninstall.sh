#!/usr/bin/env bash
# 卸载 Tray Collapse：禁用（触发还原图标）→ 删除软链
set -euo pipefail

UUID="tray-collapse@fnidore.top"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

# 源码卸载只删除软链，不递归删除 Release 安装或用户放入的文件。
if [ -e "$DEST" ] && [ ! -L "$DEST" ]; then
    echo "该路径不是源码安装软链：$DEST；请使用 gnome-extensions uninstall $UUID。" >&2
    exit 1
fi

echo "==> 尝试禁用扩展（成功禁用时会把图标还原回顶栏）"
if ! gnome-extensions disable "$UUID"; then
    echo "未能确认扩展已禁用；移除软链后，运行中的扩展仍需手动禁用或重启 Shell。" >&2
fi

if [ -e "$DEST" ] || [ -L "$DEST" ]; then
    rm -- "$DEST"
    echo "==> 已移除软链: $DEST"
else
    echo "==> 未发现安装: $DEST"
fi

echo "如需彻底清除设置：dconf reset -f /org/gnome/shell/extensions/tray-collapse/"
