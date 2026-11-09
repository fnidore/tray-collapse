# 发布指南

本文供项目维护者使用。安装、角色选择和日常使用见 [README](../README.md)。

## GitHub Release

推送一个 `v*` 标签会触发 [Release 工作流](../.github/workflows/release.yml)，自动执行检查、打包 zip 和 deb，并创建 GitHub Release。

1. 把 `src/metadata.json` 的 `version` 更新为下一个未使用的整数 `N`。deb 版本号由此字段生成，标签须对应为 `vN`。
2. 在 `release-notes/vN.md` 写好更新说明。发布工作流会读取该文件作为 Release 正文。
3. 更新 README 中的当前版本、下载链接和 deb 安装命令。
4. 执行本地检查与打包，核对附件的版本、角色素材和编译后的 schema。

```bash
make check test-prefs
make pack deb
```

提交并推送上述变更后，创建和推送对应标签；将以下命令中的 `N` 替换为实际版本号：

```bash
git tag vN
git push origin vN
```

等待 GitHub Actions 成功后，核对 Release 正文、zip 和 deb 附件；下载附件确认内容与对应标签的源码一致。

## extensions.gnome.org

运行 `make pack` 后，到 [扩展上传页](https://extensions.gnome.org/upload/) 提交生成的 zip，等待人工审核。每次重新上传都需要增加 `metadata.json` 的 `version`。
