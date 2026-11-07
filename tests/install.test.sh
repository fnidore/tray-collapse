#!/usr/bin/env bash
# 所有安装与卸载都只作用于临时 HOME，GNOME 命令由替身记录。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEST_DIR"' EXIT
export HOME="$TEST_DIR/home"
mkdir -p "$TEST_DIR/bin" "$HOME"
export PATH="$TEST_DIR/bin:$PATH"
cat > "$TEST_DIR/bin/gnome-extensions" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
chmod +x "$TEST_DIR/bin/gnome-extensions"

DEST="$HOME/.local/share/gnome-shell/extensions/tray-collapse@fnidore.top"
mkdir -p "$DEST"
touch "$DEST/keep"
if bash "$PROJECT_DIR/install.sh" > "$TEST_DIR/log" 2>&1; then
    echo '错误：安装覆盖了普通目录' >&2
    exit 1
fi
if bash "$PROJECT_DIR/uninstall.sh" >> "$TEST_DIR/log" 2>&1; then
    echo '错误：卸载接受了普通目录' >&2
    exit 1
fi
test -f "$DEST/keep"
rm "$DEST/keep"
rmdir "$DEST"

bash "$PROJECT_DIR/install.sh" >> "$TEST_DIR/log"
test "$(readlink "$DEST")" = "$PROJECT_DIR/src"
bash "$PROJECT_DIR/install.sh" >> "$TEST_DIR/log"
bash "$PROJECT_DIR/uninstall.sh" >> "$TEST_DIR/log"
test ! -L "$DEST"
test -f "$PROJECT_DIR/src/extension.js"

# 失效软链也应能安全卸载，不能沿链接删除其他位置。
ln -s "$TEST_DIR/missing" "$DEST"
bash "$PROJECT_DIR/uninstall.sh" >> "$TEST_DIR/log"
test ! -L "$DEST"
echo '安装/卸载隔离检查通过'
