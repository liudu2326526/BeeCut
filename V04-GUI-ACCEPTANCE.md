# 微剪 0.4 原生桌面与安装包验收

2026-10-18，北京时间，Apple Silicon macOS 本机。**最终 `f46d47e8…` 包的保存重开、原生导出、叠化与矩形/动画成片检查通过；独立安装包 API 六份真实输出也通过。** 这是明确范围的独立实现验收，不是已复制剪映全部功能的声明。

本页区分根代理通过 CUA 实际操作的 GUI、独立核查者的只读文件/解码测量，以及实际安装应用的 API 流程。API 合成成功不能替代原生选择框、交互预览、访达双击或另存对话框。源码测试、打包与签名核查另见发布报告；0.3 的完整原生补验见 [V03-RELEASE-VALIDATION.md](V03-RELEASE-VALIDATION.md)。

## 最终交付绑定

- 安装应用：`/Users/macbook/Applications/微剪.app`，版本 `0.4.0`。
- 固定下载：[微剪-0.4.0-mac-arm64.zip](release/微剪-0.4.0-mac-arm64.zip)，161,602,596 字节。
- 实际重新读取 ZIP 的 SHA-256：`f46d47e8af7eff3d2d602c56788042e9f129e84030f62abd1839fa89e4296bc0`。
- 安装 `app.asar` SHA-256：`81600fd417df614048c6877828133566e93bb4c6a284dd45eb40a682754c262a`。
- 安装客户端：`index-Sv80KXq_.js`，SHA-256 `a33e352f0c40b85427a665e6b579bc2775332a38ca4fbcca7013788307288173`；`index-xxTaVBU8.css`，SHA-256 `033328a1fe95e15cafac804d5ee6d4e90b80b585fb7268f1215de0dad5f06c24`。

[最终安装收据](artifacts/v04-20261018/v04-reconnect-install-receipt.json) 确认正常关闭且 `runtime.json` 消失后才替换应用；[发布包收据](release/package-verification-0.4.0.json) 记录严格签名与独立解压核查。此包为 Apple Silicon、macOS 13+、ad-hoc 签名、未公证；现有 FFmpeg 构建含 nonfree，仅供本机个人使用。

结构化总结果：[v04-final-acceptance-result.json](artifacts/v04-20261018/v04-final-acceptance-result.json)。

## 原生流程及保存重开

CUA 通过访达双击启动已安装应用，沿用独立合成 GUI 工程 `Mac-v04-转场动画蒙版验收`，ID `47410e6a-152a-41f5-850c-813b7350f76c`。本轮原生导入自行生成的 blue/red 视频、透明网格图和双频 WAV；加入视频与配乐、SRT 字幕并编辑文字；实际设置转场、画面动画、蒙版、配乐音量与淡入出。导入/字幕编辑开始于本轮较早 0.4 构建，随后同一工程在最终包中保存、恢复、编辑和导出；不把不同包的检查混称为一次全新首启。

最终包通过访达双击后实际运行 PID `68659`、动态 origin `http://127.0.0.1:63701`。这些仅是本次运行记录，不是固定配置。其进程路径与同 PID loopback 监听均已核对。最终包恢复原保存的矩形工程，4 个素材、3 个片段（2 视频 + 1 配乐）、2 条字幕；独立逐字段比较退出前后工程，除 `updatedAt` 外 **名称、素材、全部片段参数、字幕、画布/fps、ID/version/createdAt 完全一致**。

[退出前工程](artifacts/v04-20261018/v04-gui-before-final-restart.json)、[重开后工程](artifacts/v04-20261018/v04-gui-after-final-restart.json)、[重开收据](artifacts/v04-20261018/v04-final-reopen-receipt.json)、[重开截图](artifacts/v04-20261018/22-wj-final-reopened-rectangle.jpg)。

完成隔离导出后，还把所有新字段同时保存在同一可用示例工程：蓝片段渐显/渐隐各 0.5 秒并保留 0.5 秒叠化，红片段矩形宽/高 50%、项目 X+120、旋转 15°，以及两条字幕、25% 配乐与 0.2 秒音频淡入出。保存后再次正常退出，PID `68659` 确认结束且 `runtime.json` 消失；访达双击同一最终 f46 应用，PID `71094`、新 origin `http://127.0.0.1:64800` 恢复工程。独立比对前后所有核心字段（仅排除 `updatedAt`）仍完全相等。这验证组合参数同存与重开，不将该最终组合状态称为另一次已测成片导出。当前窗口保留在这一示例工程。

[同存退出前工程](artifacts/v04-20261018/v04-gui-combined-before-restart.json)、[同存重开后工程](artifacts/v04-20261018/v04-gui-combined-after-restart.json)、[正常退出](artifacts/v04-20261018/v04-final-normal-quit.json)、[同存重开收据](artifacts/v04-20261018/v04-combined-reopen-receipt.json)、[最终可用示例](artifacts/v04-20261018/25-wj-final-combined-ready.jpg)。

## 最终包原生数值输入补验

在同一最终 f46 包、PID `71094` / origin `64800` 上，使用真实 `pressKey` 逐键执行三项检查，不以 AX Help 文案或粘贴数值替代输入结果：

- 蒙版 X：`Cmd+A → minus → 1 → 0 → Tab`，离焦后实际显示 **−10**。[负数状态](artifacts/v04-20261018/26-final-negative-input.jpg)、[AX 数值](artifacts/v04-20261018/26-final-negative-input.txt)。
- 蒙版旋转：`Cmd+A → 0 → period → 2 → Tab`，离焦后实际显示 **0.2**。[小数状态](artifacts/v04-20261018/27-final-decimal-input.jpg)、[AX 数值](artifacts/v04-20261018/27-final-decimal-input.txt)。
- 蒙版 X：`Cmd+A → minus` 时画面保留不完整草稿 **“-”**；随后按 `Escape` 恢复已提交的 **120**。[未完成输入截图](artifacts/v04-20261018/28-final-escape-draft.jpg)、[Escape 恢复截图](artifacts/v04-20261018/29-final-escape-restored.jpg)、[恢复后 AX](artifacts/v04-20261018/29-final-escape-restored.txt)。不完整编辑阶段 AX 仍报告已提交 120，草稿文本以截图和实际按键序列为准。

随后恢复 X=120、旋转 15°并点击保存。只读重读工程确认除 `updatedAt` 外全部核心字段与前述组合重开快照完全一致。动作与构建绑定见 [v04-final-native-input-actions.json](artifacts/v04-20261018/v04-final-native-input-actions.json)，最终保存复核见 [v04-final-numeric-restoration-check.json](artifacts/v04-20261018/v04-final-numeric-restoration-check.json)。这三项在最终包真实复验通过，不覆盖全部输入法、地区格式或编辑边界；0.3 的输入问题及早期 0.4 检查仍保留为历史。

## 最终包原生成片

两份均由最终已安装应用通过 GUI 导出并在原生另存对话框保存，实际探测为 **6.000 秒、1280×720 / 30fps、H.264 + AAC**。工程为 1920×1080 / 30fps；配乐持续 6 秒、音量 25%、淡入/淡出各 0.2 秒；两条自制多行字幕分别为 `[0.25,2.25)` 与 `[3.25,5.75)` 秒。原始导出路径在 `~/Movies/微剪导出/`；以下链接为独立复制并核对 SHA-256 的证据副本。

| 最终 GUI 输出 | 实际结果 | 字节与 SHA-256 |
| --- | --- | --- |
| [矩形/画面动画](artifacts/v04-20261018/v04-gui-rectangle-final-analysis/weijian-v04-rectangle-final-20261018.mp4) | 第一片段渐显/渐隐各 0.5 秒；第二片段矩形宽/高各 50%、项目 X+120、旋转 15°。720p 输出期望中心 `(720,360)`、640×360；实测 `(719.497,359.503)`、`15.0024°`、约 640.87×360.95，包含采样边缘误差。两字幕可见。 | 126,971；`fc980df105d21d3ac2233a75c16ce7106ea36d9317c6934a0ecf8dfb9d817db0` |
| [叠化/字幕/配乐](artifacts/v04-20261018/v04-gui-dissolve-final-analysis/weijian-v04-dissolve-final-20261018.mp4) | 蓝 0–3 秒、红 3–6 秒，接点居中叠化 0.5 秒。完整解码全部 180 帧，无异常黑色中心；第 97 帧仍混色，第 98–101 帧连续红色 `229,30,27`，没有首包转场末端单帧空洞。 | 129,482；`36b9aa31f66dd084762b39a5330a4dd747fca80f8b4d2fcf5366c14a26f765f8` |

矩形输出 0/.1/.25/.5 秒中心蓝通道 `0/45/120/228`，2.75/2.9 秒 `105/45`，渐显/渐隐进入真实成片。[矩形探测/几何数据](artifacts/v04-20261018/v04-gui-rectangle-final-analysis/acceptance-measurements.json)、[联系表](artifacts/v04-20261018/v04-gui-rectangle-final-analysis/contact-sheet.png)、[原生导出成功](artifacts/v04-20261018/23-wj-final-rectangle-export.jpg)。

叠化输出逐帧统计底部文字区域的近白像素，测得第 8–67 与 98–172 帧存在字幕，即输出帧网格上的 `[0.266667,2.266667)`、`[3.266667,5.766667)` 秒，与输入边界采样一致。该度量表示白字占用，不是 OCR；联系表目视确认“微剪 0.4 桌面验收 / 第一段 BLUE / 880 Hz”和“保存重开与视频导出 / 第二段 RED / 440 Hz”。

音频频率投影将原声与配乐分离：第一半 440Hz 配乐在 0.05/0.5 秒振幅约 `0.010703/0.047334`，880Hz 原声约 `0.1314`；第二半原声改为 440Hz≈`0.1315`，880Hz 配乐在 3.5/5.95 秒约 `0.047349/0.013015`。原声保持，配乐按时间线淡入/淡出。此结果验证本次实际混音，不扩展为所有输入或音频处理能力。

[叠化完整 180 帧数据](artifacts/v04-20261018/v04-gui-dissolve-final-analysis/framewise-all-180.json)、[测量及首包对照](artifacts/v04-20261018/v04-gui-dissolve-final-analysis/acceptance-measurements.json)、[联系表](artifacts/v04-20261018/v04-gui-dissolve-final-analysis/contact-sheet.png)、[原生导出成功](artifacts/v04-20261018/24-wj-final-dissolve-export.jpg)。

## 椭圆及安装包 API 独立验证

中间 `2e18…` 候选已通过原生 GUI 导出反转椭圆与动画：6 秒、720p30，中心黑洞、外侧红色，720p 半高边界约 x=319.54、y=179.51（期望 320/180），羽化过渡存在；配乐和原声均正确。该份原生结果绑定中间 ASAR `8319b52b…`，**不称为最终包 GUI 椭圆重导**。[中间椭圆成片测量](artifacts/v04-20261018/v04-gui-ellipse-candidate-analysis/acceptance-measurements.json)、[联系表](artifacts/v04-20261018/v04-gui-ellipse-candidate-analysis/contact-sheet.png)。

最终包另执行 [verify-installed-v04.mjs](artifacts/v04-20261018/verify-installed-v04.mjs)，使用真实安装应用的动态监听和物理 bundled FFmpeg/FFprobe，无源码 API 或开发服务器，创建 6 个独立 API 工程并导出以下真实结果：

1. 0.5 秒居中叠化保持 6 秒，接点近半混色，原声音频维持接点切换；严格检查第 98–101 帧红色连续；非法目标身份拒绝 400 且不覆写已存工程。
2. 画面渐显/渐隐独立于原声振幅；反转椭圆中心黑、外侧红，羽化边界为中间亮度。
3. 320×180 矩形项目 X+40、旋转 15°：实际中心≈359.494/179.497、角≈15.012°、尺寸≈320.99×181.04。
4. 尾帧瞬间变色加 40ms 画面渐隐，在工程/输出帧率 30→60、60→30、30→24 三种组合中，实际 3.25 秒颜色分别为 `49,200,0 / 0,228,23 / 49,200,0`，对应工程帧网格的红/蓝尾帧与 alpha；输出帧数准确为 360/180/144。

以上最终 API 检查耗时 7.837 秒（脚本墙钟，未测 CPU/进程族峰值内存/token，不作为比较性能基准）。10 个既有工程 JSON 哈希、28 条既有素材 registry 完整记录及输入素材字节全部保留；只新增 6 个 API 测试工程和 4 个自制素材。API 未选择或改写 GUI 工程。所有结果绑定最终 ASAR `81600fd4…` 与相同运行实例。[最终 API 完整收据](artifacts/v04-20261018/installed-v04-api-final-build/installed-v04-api-result.json)。

## 发现的问题与修复边界

首包首次会话曾出现视频黑屏，HTTP GET/Range、媒体字节与 codecs 检查均正常。同一个首包正常退出重启后，原生蓝画面与紫色叠化预览恢复：[恢复截图](artifacts/v04-20261018/16-wj-first-build-restarted-dissolve.jpg)。没有证据将这次预览恢复归因于源码或 codec 修复，也没有证明长期不再复现。

另一个独立问题是在首包真实成片中，转场结束后第 98 帧背景全黑、字幕仍正常。首次 API 只抽稀疏时点，未覆盖该帧；后来完整边界采样发现同一缺陷。旧“通过”只表示当时检查范围，附加失败收据已保留：[首包 GUI 缺陷](artifacts/v04-20261018/v04-gui-first-dissolve-analysis/acceptance-measurements.json)、[首包 API 后验纠正](artifacts/v04-20261018/installed-v04-api-first-build/posthoc-transition-exit-failure.json)。最终包原生重导与 API 严格逐帧检查均确认该空洞已消失。

首包与最终叠化工程有效渲染、字幕及音频参数一致；原始片段 JSON 不是全部字节相同：最终红色片段 `mask.type='none'` 下保留了先前矩形的禁用尺寸/位移/旋转值。对比只忽略这些不启用的形状参数，不声称两份原始工程完全相同。

本次仅使用短自制素材，未覆盖全部输入编码、所有 macOS/Intel、长视频或最坏 4K/64 片段负载。逐帧“无黑色中心”不是对每个像素语义的全面证明；羽化预览 SVG 与导出栅格、微剪与剪映原生算法均不声明完全相同。未增加云/会员/AI、私有草稿兼容或官方后台控制能力。


## 剪映原草稿最终保全复核

交付前再次只读采样四个非测试草稿，与 2026-10-18 本轮操作前基线比较：215 个元数据哈希、54 个核心草稿/时间线哈希全部一致，文件/目录无增删，排除文件的尺寸与 mtime 也无变化，没有哈希不稳定或读取错误。仅写入本项目证据目录，没有控制剪映 GUI 或写草稿。排除媒体/资源/缓存/锁/key-store 字节不作内容无变化保证；这也不撤回首次创建参考测试草稿时剪映自身保存“5月2日”的历史影响。[最终保全摘要](artifacts/v04-20261018/jianying-final-preservation-summary.json)、[完整对照](artifacts/v04-20261018/jianying-final-comparison.json)。
