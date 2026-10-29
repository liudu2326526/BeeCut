# 当前 Mac 桌面版 · 微剪 0.5.0

当前已安装在 `~/Applications/微剪.app`。2026-10-18 通过 Finder 双击，0秒首帧显示正常；原生导入、保存、正常退出后重开、关键帧中间值、2×/.5×分段保留、播放、720P/30fps/8秒导出与原生另存均已实际操作。重开时 API 与资料库工程一致；与保存检查点比较，仅允许 updatedAt 不同。该结果是最终版本的独立补验，不沿用下方0.2历史结果。

- ZIP：`release/微剪-0.5.0-mac-arm64.zip`，161,617,452字节。
- SHA-256：`8133732fb0083025492aa493ed85dd7f0fc2000b941a7f51cac80de9a7e38216`。
- 源码测试49/49、最终成片独立检查21/21；完整包、GUI和成片证据见 [V05-RELEASE-VALIDATION.md](V05-RELEASE-VALIDATION.md)、[V05-GUI-ACCEPTANCE.md](V05-GUI-ACCEPTANCE.md)。
- 最终音频预览仅使用HTMLAudio，最高100%；更高增益保留于工程并用于导出。此前候选冷启动问题的因果对照见 [V05-PREVIEW-DIAGNOSIS.md](V05-PREVIEW-DIAGNOSIS.md)。不声称所有设备/编码均已验证。

仍限 Apple Silicon/macOS13+、ad-hoc签名、未公证；所带FFmpeg包含 `--enable-nonfree`，仅本机自用。下方旧版包哈希与验收记录保持原样。

---

# 微剪 0.2.0 Mac 桌面验收（历史）

2026-10-17，macOS Apple Silicon 本机执行。桌面版独立于 REA；本轮结束时 REA `git status --short` 为空。

## 交付物

- 安装应用：`/Users/macbook/Applications/微剪.app`
- 可复制应用：`release/微剪.app`
- ZIP：`release/微剪-0.2.0-mac-arm64.zip`，161,604,052 字节。
- ZIP SHA-256：`1aa6377ad689da7ec1ec0d7a7b49771eee596c4bdf9aab813d2971a7702808cc`
- 平台：Apple Silicon，macOS 13+；未构建 Intel 版。
- 临时签名（ad-hoc），未 Developer ID 签名、未公证。当前 FFmpeg 构建包含 `--enable-nonfree`，本包仅作本机自用；对外分发需要替换合适的 FFmpeg 构建并重新处理许可和签名。

原 `.app` 与最终 ZIP 的独立 `ditto` 解压副本均通过 `codesign --verify --deep --strict`，记录见 [package-verification-0.2.0.json](release/package-verification-0.2.0.json)。包中只带白名单内置演示资料，不带用户工程、导入素材、验收工程或环境文件。Electron、Chromium、媒体工具、依赖许可和演示素材来源已纳入包内。最终完整包已替换安装目录，再次双击验收。

交付前再次读取 ZIP 校验值、检查路径安全性，并逐项比较安装应用与 release 应用的 394 个文件/链接，完全一致；安装应用再次通过严格验签：[final-delivery-check.json](artifacts/mac-desktop-20261017/final-delivery-check.json)。

## 实际桌面界面验收

使用 CUA 操作访达和安装应用，没有通过开发服务器或浏览器页面代替桌面窗口。开始前用项目管理脚本停止本任务原有的 `weijian-api`（4318）和 `weijian-ui`（4173）。

| 操作 | 实际结果 |
| --- | --- |
| 访达中双击 `~/Applications/微剪.app` | 显示真实编辑窗口，包内媒体引擎连接成功 |
| 新建 `Mac桌面验收-20261017` | 独立空白工程生成并命名 |
| 原生 macOS 文件选择器导入 | 导入 `云海_远山.mp4` 与 `远行_氛围配乐.wav`，素材卡片和缩略图显示 |
| 时间线剪辑 | 视频与配乐分别添加到轨道，均裁到 6 秒 |
| 字幕 | 添加两行 `微剪 Mac 桌面版`、`导入 · 剪辑 · 保存 · 导出`，起点 0 秒、时长 6 秒 |
| 保存及预览 | 点击保存显示已保存；播放头从 0 推进，视频画面正常 |
| 导出 | 选择 720P / 30fps / 高画质，实际合成后显示“视频已导出” |
| 下载到本机 | 原生“保存到本机”对话框默认 `~/Movies/微剪导出/`，点击保存后 MP4 存在 |
| 正常退出 | Command-Q 后原 PID 85381 退出，所属 runtime.json 清理 |
| 替换完整包并重新双击 | 新 PID 98571、新端口 58580 启动；恢复同一工程及两份素材、两个轨道片段和字幕；再次播放成功 |

首启端口 56149，重启端口 58580。`ps` 确认两个实例均为安装应用 `Contents/MacOS/微剪`；重启后对公开 API 读取的工程逐项比较 `id/name/width/height/fps/media/clips/subtitles`，与退出前保存内容一致。

界面证据：[首启](artifacts/mac-desktop-20261017/01-double-click-start.png)、[导出完成](artifacts/mac-desktop-20261017/02-export-complete.png)、[原生保存框](artifacts/mac-desktop-20261017/03-native-save-dialog.png)、[重开工程](artifacts/mac-desktop-20261017/04-reopened-project.png)。结构化记录：[gui-acceptance-result.json](artifacts/mac-desktop-20261017/gui-acceptance-result.json)。

## 实际成片与包内 API 验收

GUI 下载成片：`/Users/macbook/Movies/微剪导出/Mac桌面验收-20261017.mp4`，681,442 字节，6.000000 秒，H.264 1280×720 / 30fps + AAC。SHA-256：`c2f3a4b739f3902d2ec2186ea0899d869fb15dda408758bafe223e5d63b0c63e`。通过安装包内 FFprobe 探测，抽取 1 秒画面并目视确认两行字幕已烧录：[成片字幕帧](artifacts/mac-desktop-20261017/桌面GUI验收-字幕帧.png)。

另通过真实运行应用的动态本机接口，使用其包内 FFmpeg 生成红蓝切换、440Hz 原声音频及 220Hz 配乐。验证真实 multipart 中文文件导入、独立工程保存重读、字幕合成、H.264/AAC 导出、实际像素顺序、双频混音、HEAD 和 Range 206；现有工程记录与素材记录保持不变。此部分直接测试安装应用，但不是 GUI 操作，独立记录在 [installed-desktop-api-result.json](artifacts/mac-desktop-20261017/installed-desktop-api-result.json)。初次验收脚本中的 locale/lsof/小数格式断言已修正，失败记录保留，随后完整运行通过。

相关源码测试实际执行：`node --test tests/desktop-runtime.test.mjs desktop/library.test.mjs tests/editor-flow.test.mjs tests/model.test.mjs`，10/10 通过，0 失败/跳过，总 959.28ms；包括独立目录、静态服务、包内执行路径、关闭取消清理、旧库复制备份/冲突处理和剪辑语义。记录见 [final-source-checks.txt](artifacts/mac-desktop-20261017/final-source-checks.txt)。

## 使用与边界

工程和素材长期保存在 `~/Library/Application Support/微剪/Library/`；应用包可以替换，完整资料库应自行备份。导出后下载副本默认放在 `~/Movies/微剪导出/`。旧网页版资料可从“文件 → 导入旧网页版资料库…”选择完整 `data/` 进行带备份的复制导入；本轮未通过 GUI 执行这一可选迁移入口，迁移模块测试已通过。

验证限本机与短 H.264/WAV 合成素材，没有覆盖所有编码、Intel 硬件、15 分钟压力任务或所有系统版本。原生文件选择器的 AX 读取曾间歇性超过 30 秒；延长工具超时后完成选择、导入和保存。未进行比较性能、CPU、进程族峰值内存或完整任务 token 测量。

剪映本体控制参考验证另见 [JIANYING-CONTROL-VALIDATION.md](JIANYING-CONTROL-VALIDATION.md)。独立微剪应用不读写剪映工程，也不包含剪映私有引擎或云功能。
