UUID    = tray-collapse@fnidore.top
PKGNAME = gnome-shell-extension-tray-collapse
VERSION = $(shell python3 -c "import json; print(json.load(open('src/metadata.json'))['version'])")

.PHONY: install uninstall enable disable prefs schemas logs restart check test-prefs pack deb clean

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
	glib-compile-schemas --strict src/schemas

check:          ## 离线回归、脚本语法与 schema 校验；不修改桌面配置
	node --check src/extension.js
	node --check src/prefs.js
	node --check src/indicatorSettings.js
	node --test tests/*.test.cjs
	bash -n install.sh uninstall.sh tests/install.test.sh
	bash tests/install.test.sh
	glib-compile-schemas --strict --dry-run src/schemas

test-prefs: schemas ## 在隔离显示和内存配置中验证真实 GTK 设置窗口
	GSETTINGS_BACKEND=memory GSETTINGS_SCHEMA_DIR="$(CURDIR)/src/schemas" ADW_DISABLE_PORTAL=1 GTK_A11Y=none GIO_USE_VFS=local xvfb-run -a dbus-run-session -- gjs tests/prefs-smoke.js

logs:           ## 实时看本扩展日志
	journalctl --user -f | grep --line-buffered -iE 'tray-collapse|TrayCollapse'

restart:        ## 提示如何重启 Shell（X11）
	@echo "X11：按 Alt+F2 → 输入 r → 回车，重启 GNOME Shell"

pack: schemas   ## 打包 Release zip（gnome-extensions install 可装，也用于上传 EGO）
	mkdir -p dist
	rm -f dist/$(UUID).shell-extension.zip
	cd src && zip -qr ../dist/$(UUID).shell-extension.zip .
	@echo "==> dist/$(UUID).shell-extension.zip"
	@echo "    安装：gnome-extensions install --force dist/$(UUID).shell-extension.zip"

deb: schemas    ## 打包 .deb（装进系统扩展目录，sudo apt install ./xx.deb）
	rm -rf build/deb
	mkdir -p dist build/deb/DEBIAN build/deb/usr/share/gnome-shell/extensions/$(UUID)
	cp -r src/. build/deb/usr/share/gnome-shell/extensions/$(UUID)/
	printf 'Package: $(PKGNAME)\nVersion: $(VERSION)\nSection: gnome\nPriority: optional\nArchitecture: all\nDepends: gnome-shell (>= 42), gnome-shell (<< 43), gnome-shell-extension-appindicator\nMaintainer: fnidore <fnidore@outlook.com>\nHomepage: https://github.com/fnidore/tray-collapse\nDescription: Collapse AppIndicator tray icons into a top bar drawer\n GNOME Shell 42 extension. Collapses AppIndicator/legacy tray icons\n into an expandable drawer in the top panel (like the Windows\n overflow area), with per-icon collapse/pin settings and adjustable\n icon spacing.\n' > build/deb/DEBIAN/control
	dpkg-deb --build --root-owner-group build/deb dist/$(PKGNAME)_$(VERSION)_all.deb
	@echo "==> dist/$(PKGNAME)_$(VERSION)_all.deb"

clean:          ## 清理打包产物
	rm -rf build dist
