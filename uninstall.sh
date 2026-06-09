#!/usr/bin/env bash
# 卸载 Tray Collapse：禁用（触发还原图标）→ 删除软链
set -euo pipefail

UUID="tray-collapse@fnidore.top"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "==> 禁用扩展（自动把图标还原回顶栏）"
gnome-extensions disable "$UUID" 2>/dev/null || true

if [ -e "$DEST" ] || [ -L "$DEST" ]; then
    rm -rf "$DEST"
    echo "==> 已移除软链: $DEST"
else
    echo "==> 未发现安装: $DEST"
fi

echo "如需彻底清除设置：dconf reset -f /org/gnome/shell/extensions/tray-collapse/"
