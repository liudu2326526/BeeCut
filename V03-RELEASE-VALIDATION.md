# 微剪 0.3.0 发布与验收

2026-10-17 发布，2026-10-18 完成原生桌面界面补验，Apple Silicon macOS 本机。此版本以独立代码扩展已有编辑器，不表示已经复制剪映全部功能。操作说明见 [FEATURE-GUIDE.md](FEATURE-GUIDE.md)，字段语义见 [CONTRACT.md](CONTRACT.md)。剪映本体观察和微剪实际实现分别记录。

## 发布文件

- 0.3.0 应用以本节版本化 ZIP 为准；通用 `release/微剪.app` 会随新版本更新，不再作为 0.3 固定下载链接。
- ZIP：[微剪-0.3.0-mac-arm64.zip](release/微剪-0.3.0-mac-arm64.zip)，161,594,273 字节。
- SHA-256：`094fa33f338818341740a11dfa4e39ac1c1fc575f17445f00230c45489058425`，另见同名 [.sha256](release/微剪-0.3.0-mac-arm64.zip.sha256)。
- 构建收据：[package-verification-0.3.0.json](release/package-verification-0.3.0.json)。
- 独立包核查：[independent-package-verification-0.3.0.json](release/independent-package-verification-0.3.0.json)。
- Apple Silicon arm64，最低 macOS 13，Electron 44.8.0 / 包内 Node 24.22.0。未构建 Intel 版本。

采用临时签名（ad-hoc），未 Developer ID 签名、未公证。所带 FFmpeg 的实际构建包含 `--enable-nonfree`，此包仅供本机个人使用，不能作为对外分发版本。组件许可、实际工具构建参数与演示素材来源均放在 `Contents/Resources/licenses/`。

## 新增能力及源码验证

`npm run test:all` 实际执行 26 项，26 通过、0 失败/跳过，共 5,406.38 ms。覆盖剪辑与导出、桌面运行与资料库迁移、SRT 文本处理和 Sites 兼容。完整日志见 [source-tests-pre-freeze.log](artifacts/v03-release-20261017/source-tests-pre-freeze.log)。该日志文件名表示首次发布准备阶段；其中已经包含随后确认冻结的 SRT 边界修复与全部新增测试。打包后再次逐项比对 24 个 `src/shared/server/desktop` 文件，未发现冻结源码变化。

| 能力 | 已执行验证 |
| --- | --- |
| 4 层画面 | 乱序片段数组中四层同时出现；同层重叠、第五层或小数层拒绝；高层正确覆盖低层 |
| 画面变换 | 缩放、项目像素位移、90° 顺时针旋转、水平/垂直翻转；实际成片绿色标记移动到预期位置 |
| 透明度 | 原生透明 PNG 和片段 50% 不透明度叠加；画面外区域保留下层；片段结束后没有冻结残影 |
| 基础调色 | CSS 风格亮度→对比度→饱和度公式；灰度半透明叠红实测 RGB `144,20,18`，不宣称等同剪映算法 |
| 音频 | 原声与配乐混音、源入点/2 倍速；淡入与淡出进入实际 AAC，原声早/中/晚 PCM RMS `0.00537/0.07417/0.00759` |
| 字幕与描边 | 真实 drawtext 烧录；白色字形 160 个、绿色描边 1,273 个采样像素；文字保持字面量 |
| SRT | BOM/CRLF、可选编号、多行字面量、重叠及毫秒时序；坏块整份拒绝；合并总量与最短 40 ms 的工程边界 |
| 工程兼容 | 旧工程缺少新字段时补默认；新字段保存与重开一致；同层冲突或非法变换拒绝时保留已存工程 |
| 导出与资源清理 | H.264/AAC MP4、输出尺寸缩放、HEAD/Range、进度/取消、应用关闭等待导出清理 |

真实媒体测试为 [layered-export.test.mjs](tests/layered-export.test.mjs) 与独立补充的 [v03-render.test.mjs](tests/v03-render.test.mjs)。预览参数来自共享模型，预览音量通过 Web Audio Gain 支持 0–200%；GUI 是否正确连通这些参数，须以桌面界面验收为准，不能仅由上述 API 测试推断。

`npm run build` 通过；最终 `npm run desktop:package` 又执行构建并通过。最终客户端为 `index-CQlpJFik.js` 与 `index-e_LeU9Ci.css`，打包日志见 [package.log](artifacts/v03-release-20261017/package.log)。

## 独立包核查

`npm run desktop:verify` 已通过，执行的是发布包而非源码运行环境：

1. 检查 `com.weijian.studio` 身份、0.3.0 版本、macOS 13 与严格深层签名。
2. 逐项检查 ASAR 内运行时模块白名单，确认打包主模块与构建暂存一致、客户端与当前 `dist/client` 字节一致、Electron ASAR 完整性哈希一致。
3. 检查包内无 `.env`、仓库/缓存、验收工件、临时上传或 key-store 文件；仅携带明确选定的 3 个演示素材及关联工程/缩略图，逐项比对演示字节。未复制本机环境或用户资料库。
4. 检查 79 个依赖声明及许可证文件、Electron/Chromium 许可证、媒体工具许可/构建信息和演示素材来源。实际执行 `.app` 的 Node 模式与物理 unpacked FFmpeg/FFprobe，确认 arm64 工具可运行，记录与实际构建参数匹配。
5. 使用新的临时目录独立解压 ZIP，严格验签，并比较全部 384 个文件/符号链接的内容、目标和文件权限，与发布 `.app` 一致；核对 SHA-256 与版本收据。临时解压目录在验收结束后清理。

审阅后补充了物理 `app.asar.unpacked` 与 ASAR 声明的精确文件集合、Resources 根目录白名单、vendor 默认归档/icon 哈希及许可证目录匹配，并再次全通过。校验脚本初次补充时使用了不适用的 Electron 资源路径；随后又发现 builder 会正常剔除 native package.json 的 scripts/keywords，改为按该明确规则结构化比较后通过。校验失败记录保留在 [independent-package-verification-check-failure.json](artifacts/v03-release-20261017/independent-package-verification-check-failure.json)，最终记录为 [independent-package-check.log](artifacts/v03-release-20261017/independent-package-check.log)。这些校验脚本修正没有改动应用或 ZIP 字节。

该核查依据明确的来源和文件白名单，不声称对任意二进制内容完成了通用敏感信息识别。

## 安装包 API 验收

通过 CUA 正常退出旧应用并安装发布包后，实际运行应用的 PID 为 `37880`，动态监听 `http://127.0.0.1:53236`，版本为 `0.3.0`。验证脚本重新核对 `runtime.json`、`ps` 的安装应用进程路径和相同 PID 所属的 loopback 监听，不使用源码 API 或开发端口；处理和探测均调用 `~/Applications/微剪.app/Contents/Resources/app.asar.unpacked/` 内的媒体工具。

先执行 [verify-installed-desktop.mjs](scripts/verify-installed-desktop.mjs)，实际素材导入、保存/HTTP 重开、字幕和配乐合成、H.264/AAC、实际像素时序、双频混音及 HEAD/Range 下载均通过；结果见 [installed-desktop-api-result.json](artifacts/v03-release-20261017/installed-api/installed-desktop-api-result.json)。脚本创建独立的 `桌面包API验收-0.3.0-20261017` 工程，ID 为 `5f5937f9-9202-4059-8357-9223b98f8930`。

随后 [verify-installed-v03-features.mjs](scripts/verify-installed-v03-features.mjs) 复用该 API 工程，保存并重开 layer、完整 transform、adjustments、fade 与字幕 outline 字段，导出实际 3 秒、640×360 / 30fps、H.264 + AAC 成片。它没有选择或修改 GUI 工程：

- 四层画面同时出现，片段数组乱序仍按 layer 合成；缩放和项目像素位移生效，片段结束后没有最后一帧冻结。
- 蓝色素材经调色和 50% 透明度叠红，实际 RGB 为 `144,20,18`；垂直翻转的绿色标记为 `1,252,0`，90° 顺时针旋转加水平翻转后的标记为 `0,252,0`。
- 字幕蓝色描边实际采样 1,523 个像素；已目视检查 [成片帧](artifacts/v03-release-20261017/installed-api/桌面包0.3真实多轨导出-帧.png)。
- 原声与配乐按相同时间线淡入淡出，实际 AAC 的早/中/晚 PCM RMS 为 `0.002981/0.043918/0.003795`。
- 5 个其他工程文件的哈希及 16 条既有媒体记录保持一致；其中 GUI 新工程 `Mac-v03-多轨字幕验收`（`314eabb5-e96a-4951-9384-0c7dfe3dea8d`）当时已保存真实名称，素材/片段/字幕均为 0。接口验收不代替 GUI 原生导入成功。

成片：[桌面包0.3真实多轨导出.mp4](artifacts/v03-release-20261017/installed-api/桌面包0.3真实多轨导出.mp4)，27,215 字节，SHA-256 `189f08d866ce7889d50986601b98d2fe0febb6947433fae21fdb9d886ef4ee1f`。结构化结果见 [installed-v03-feature-result.json](artifacts/v03-release-20261017/installed-api/installed-v03-feature-result.json)，保存的工程副本见 [installed-v03-feature-project.json](artifacts/v03-release-20261017/installed-api/installed-v03-feature-project.json)。

附加脚本首轮已完成合成与像素断言，但提取截图时传入 `.9`，包内 FFmpeg 拒绝该小数写法；修正验证脚本为 `0.9` 后完整运行通过，首次 [failure receipt](artifacts/v03-release-20261017/installed-api/installed-v03-feature-failure.json) 保留。应用与发布包无需修复或重打。接口验证全程不操作 GUI 或锁屏。

接口验收后，再执行 [verify-installed-package-match.mjs](scripts/verify-installed-package-match.mjs)，逐项比较已安装应用和 `release/微剪.app`：370 个普通文件的字节/权限、14 个符号链接的目标/权限全部一致，共 384 项、0 差异；安装应用严格深层验签通过，实际版本为 0.3.0，ZIP 哈希仍为发布值。收据见 [installed-release-equivalence.json](artifacts/v03-release-20261017/installed-release-equivalence.json)，完整清单见 [installed-release-file-manifest.json](artifacts/v03-release-20261017/installed-release-file-manifest.json)。

## 旧版与资料保全

0.2 ZIP、校验值及旧版说明保持保留，原始收据存为 [package-verification-0.2.0.json](release/package-verification-0.2.0.json)。重新读取旧 ZIP 后确认 161,604,052 字节，SHA-256 仍为 `1aa6377ad689da7ec1ec0d7a7b49771eee596c4bdf9aab813d2971a7702808cc`。冻结源码和旧包保全记录见 [source-and-previous-release-preservation.json](artifacts/v03-release-20261017/source-and-previous-release-preservation.json)。

发布构建阶段没有替换 `~/Applications/微剪.app`，没有启动/关闭编辑窗口，没有读取或改写桌面用户资料库；该阶段观察到已安装版本仍为 0.2.0。后续安装与 GUI 验收应单独记录。工程和素材继续保存在 `~/Library/Application Support/微剪/Library/`，0.3 可读取旧工程；旧版不能保留新字段，回退前应备份整个资料库。

## 桌面界面验收

已正常退出旧版，将原安装包保留在 `artifacts/v03-release-20261017/previous-installed-0.2.0.app`，再将发布包复制至 `~/Applications/微剪.app`；未改应用身份或资料库路径。安装副本严格深层签名通过。随后在访达进入 `/Users/macbook/Applications` 并双击“微剪”，实际启动 0.3.0，动态端口 `http://127.0.0.1:53236`，打开旧版保存工程，界面出现新叠加轨和可用“调节”入口。[启动截图](artifacts/v03-release-20261017/01-finder-double-click-v03.jpg)。

### 2026-10-17 历史检查点

通过工程列表实际新建并命名“Mac-v03-多轨字幕验收”，独立工程 ID `314eabb5-e96a-4951-9384-0c7dfe3dea8d`。当日原生素材选择框已定位自制 `video.mp4`、`music.wav` 并多选，但点击 Open 时 Mac 锁屏，操作未完成，工程当时为零素材/片段/字幕。[历史 GUI 检查点](artifacts/v03-release-20261017/gui-checkpoint.json) 保留了该阻断，不以接口测试补写为当日 GUI 成功。

### 2026-10-18 原生界面补验通过

用户手动解锁后，继续操作已安装的 0.3.0，完成原生多文件素材导入、视频与配乐进入时间线、上层画面参数、SRT 导入与字幕描边、SRT 原生另存、手动保存、正常退出、访达双击重开和 MP4 导出/原生另存。工程最终为 2 个素材、2 个视频片段（含叠加层）、1 个配乐片段、2 条字幕。结构化收据见 [v03-gui-acceptance-result.json](artifacts/v04-20261018/v03-gui-acceptance-result.json)。

- 工程为 1920×1080 / 30fps、2 秒：底层原片前 1 秒红、后 1 秒蓝；上层从源 1 秒开始、持续 1 秒，缩放 50%、X 位移 100 项目像素、顺时针旋转 15°、不透明度 75%、亮度 1.2、饱和度 0.5，静音；配乐淡入/淡出均为 0.2 秒。
- 第一条字幕为“微剪 0.3 桌面字幕验收”，0–0.9 秒，字号 56、黑色描边 6 项目像素；第二条为两行“第二行字幕 / Local SRT test”，1–2 秒。原生另存 SRT 与 [验证副本](artifacts/v04-20261018/v03-gui-exported.srt) 字节一致，129 字节，SHA-256 `059da4a5ded6619fb841697b7d7a6d32bb6daccdb5b326d67d527910b42b5b5b`。
- 保存后立即 Cmd+Q 时正确出现未保存提示；取消关闭、等待界面显示“已保存”后再正常退出。原 PID `576` 确认消失，`runtime.json` 已清理；再在访达双击启动，PID `7319`、新动态端口 `54629`。自动恢复相同工程，名称、画布、素材、片段全部字段、字幕、创建时间等除 `updatedAt` 外所有核心字段与退出前完全相同。[退出收据](artifacts/v04-20261018/v03-quit-confirmation.json)、[重开界面](artifacts/v04-20261018/03-v03-reopened.jpg)、[重开后工程](artifacts/v04-20261018/v03-gui-after-restart.json)。这些 PID/端口仅表示本次验收，不是固定配置。
- 原生导出的 [weijian-v03-gui-20261018.mp4](/Users/macbook/Movies/微剪导出/weijian-v03-gui-20261018.mp4) 为 59,583 字节，SHA-256 `e05c9434d754c32e6e58dfa56e44c6664d867f07a00c646459b4d6cdfde0a759`；实际探测为 2.000 秒、1280×720 / 30fps、H.264 + 48kHz 双声道 AAC。
- 独立解码 0.2/0.7/1.2/1.7 秒图像并目视核对两条中文/英文字幕烧录；前段可见红底与半透明旋转矩形，后段为蓝底，上层按时结束。前段矩形实测中心 `(706.385,359.635)`、角度 `14.995°`，与 720p 输出期望 `(706.667,360)`、`15°` 一致至采样边缘误差；本征尺寸约 641.7×361.7，期望 640×360。[四帧对照](artifacts/v04-20261018/v03-gui-export-analysis/contact-sheet.png)。
- 音频频率投影分离原声与配乐：220Hz 配乐在 0.05/1/1.95 秒的幅度为 `0.02984/0.13153/0.03598`，相对中段为 `0.227/1/0.274`；440Hz 原声保持 `0.1312–0.1316`，验证配乐淡入/淡出独立生效。[成片探测与采样](artifacts/v04-20261018/v03-gui-export-analysis/analysis.json)、[几何/双频/SRT 测量](artifacts/v04-20261018/v03-gui-export-analysis/acceptance-measurements.json)。
- 其余 5 个既有工程 JSON 字节哈希保持不变，原有 20 个素材 ID 全部保留，本次新增 2 个自制素材记录。此前未对媒体原文件或逐条 registry 字节做快照，因此不声称其字节完全未变。

**已知输入问题：** 0.3 中最初用 AX 逐键输入小数未正确保留中间编辑状态；本次通过粘贴并读取实际保存值完成了上述参数验收。这里不表示 0.3 的直接键入小数已无问题，0.4 后续修复应另行验证。本节证明上述真实 GUI 流程，未覆盖全部窗口尺寸或每个属性输入方式。

## 验证边界

本轮使用本机短合成素材和图像，未覆盖 Intel、所有 macOS 版本/输入编码、15 分钟压力任务或最坏 4K/64 片段资源负载。未执行比较性能、CPU 时间、进程族峰值内存或完整任务 token 测量。关键帧、复杂转场与资源库、抠像、语音识别、AI、云协作、会员内容及剪映草稿兼容尚未实现。
