UUID = tray-collapse@fnidore.top

.PHONY: install uninstall enable disable prefs schemas logs restart

install:        ## 编译 schema + 软链 + 提示后续步骤
	./install.sh

uninstall:      ## 禁用并移除软链
	./uninstall.sh

enable:         ## 启用扩展
	gnome-extensions enable $(UUID)

disable:        ## 禁用扩展
	gnome-extensions disable $(UUID)

prefs:          ## 打开设置界面
	gnome-extensions prefs $(UUID)

schemas:        ## 仅重新编译 gsettings schema
	glib-compile-schemas src/schemas

logs:           ## 实时看本扩展日志
	journalctl --user -f | grep --line-buffered -iE 'tray-collapse|TrayCollapse'

restart:        ## 提示如何重启 Shell（X11）
	@echo "X11：按 Alt+F2 → 输入 r → 回车，重启 GNOME Shell"
