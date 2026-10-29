# 微剪 0.8 最终 Mac 桌面交付

2026-10-18，Apple Silicon/macOS 13+。已完成独立实现、最终打包、安装版原生操作和真实成片检查。源码项目为 `/Users/macbook/Documents/trae_projects/jianying-studio`，没有集成或修改 REA。功能与剪映的差异见 [参考记录](V08-JIANYING-REFERENCE.md)、[功能映射](JIANYING-FEATURE-MAP.md) 和 [设计检查](design-qa.md)。

## 最终产物

| 项目 | 路径与身份 |
|---|---|
| 已安装应用 | `/Users/macbook/Applications/微剪.app`，0.8.0，arm64 |
| ZIP | `release/微剪-0.8.0-mac-arm64.zip`，162,108,876 字节 |
| ZIP SHA-256 | `2569b6f746a851e0d5d558299ac13839d65e8411fe3c0840ca605b73699e5a5c` |
| 原生另存 MP4 | `/Users/macbook/Movies/微剪导出/weijian-v08-native-final-20261018.mp4`，3,281,941 字节 |
| MP4 SHA-256 | `38d9ba8bc8bd19eeb98c989607595522f60d6be52a29d008db023feacae219e6` |
| 原生另存 WAV | `/Users/macbook/Movies/微剪导出/weijian-v08-pitch-preview-20261018.wav`，12,601,678 字节 |
| WAV SHA-256 | `5a615bc85976ca2b46fdc9883ff686fd888ed5907ac79f34819e50e7ee951d86` |

解压 ZIP 后将 `微剪.app` 放入个人 Applications。替换前正常退出旧版；保留 `~/Library/Application Support/微剪/Library/`，它包含工程、素材副本和已完成成片。无需终端、Node.js/npm、开发服务器或联网处理媒体。完整迁移请备份整个 Library，单独工程 JSON 不内嵌媒体。

最终包严格深度 ad-hoc 验签通过；ZIP、release App 与安装 App 的 390 项文件/符号链接/模式相同。见 [包验证](release/package-verification-0.8.0.json)、[独立包检查](release/independent-package-verification-0.8.0.json)、[安装一致性](artifacts/v08-20261018/installed-release-equivalence.json)。84 个源码/锁定输入冻结，最终构建后和原生验收后均重新核对 [frozen-source.json](artifacts/v08-20261018/frozen-source.json)。

辅助程序重新签名会改变签名填充字节，初次 verifier 错把阶段产物和签名后 raw bytes 不同判断为代码不同。修复验证器只在临时副本移除签名，核对规范化程序内容与 CDHash，再严格验证真实 bundle/helper 的签名；最终 ZIP 仍逐字节核对签名后产物。失败日志和诊断保留为 `package-initial-verifier-failure.*`、`helper-signature-diagnosis.json`，没有跳过验签或更改运行代码来放行。

## 本版行为

平滑曲线音频改用一个整段连续的 Rubber Band 4.0.0 R3/WindowShort 离线引擎，保持阶段历史，使用源/输出采样映射；移除原先每 75 ms 重启 atempo 与交叉拼接的表示。输入解码、保调、WAV 包装、混音和 MP4 合成仍由同一有界串行队列拥有，包含取消、晚退出、失败及清理重试。helper 和映射路径由桌面组合边界明确传入，固定锁定源离线构建，不依赖系统安装。

音频支持分贝音量、独立静音、原声分离、线性/缓入/缓出/正弦淡化；分离继承同源区间、常规/分段/平滑速度和增益，原视频不重复发声。整工程“生成保调预听”输出 WAV，复用真实导出音频链；修改工程后保留明确的旧版结果提示，需显式重新生成。实时 HTMLAudio 为草听，最高 100%；保调 WAV 和 MP4 使用工程保存的最高 200% 增益。未恢复曾导致音频设备初始化阻塞的 WebAudio。

新增左右推进、左右滑入、淡白五种转场，共 13 种；新增缩放渐显/渐隐、旋转渐显/渐隐两类复合动画，共 10 类。空间转场、透明区域、非整帧起点与预览/导出时钟由共享合同拥有；画面转场不自动交叉淡化原声。保留四画面轨、真实源波形、字幕、关键帧、调色与圆形/矩形蒙版。只读打开旧工程不自动补默认值覆盖原文件；新建工程仍可自动保存。新增 Command-W 关闭成片预览窗口。

## 已执行验证

- `npm run test:all`：101/101，0 失败/跳过，17.601 秒。[完整日志](artifacts/v08-20261018/test-all.log)。覆盖源代码/真实 HTTP/FFmpeg 和边界，不由测试数量推定原生成功。
- 曲线/生命周期专项 25/25；预先冻结的音高门限为稳态误差 ≤max(0.5 Hz,0.1%)，标记 ≤40 ms、精确采样数、真实尾音及连续性。多音调、复合音、最大斜率、极短选区通过；保留 R2/R3 默认窗口失败与最终 R3 Short 的统一选择证据。[后端合同](artifacts/v08-20261018/BACKEND-CONTRACT-AND-VALIDATION.md)。
- 同源 4 秒稳态窗口：旧版 440→444.763 Hz，新版 440.00244 Hz。60/900 秒多频率音频预处理均通过。实际 900 秒为 **WAV 预处理，非本版 900 秒 1080P 视频**：17.281 秒，43,200,000 样本帧，采样 helper 峰值约 11.57 MB、进程家族约 108.09 MB，磁盘约 693.77 MB；最大音高误差 .0879 Hz、标记误差 7.51 ms。[成本与新旧对照](artifacts/v08-20261018/backend-resource-final.json)。
- 新效果真实导出 4/4：五种新转场 18,154 像素探针最大误差 7；复合动画 7,340 探针最大误差 13.62，24/30/60fps 及透明区域、变换/蒙版组合；启用视觉转场前后完整 PCM 哈希相同。[效果报告](artifacts/v08-20261018/effects/RESULT.md)。
- 音频模型专项 3/3，根集成 WAV/MP4 真混音 1/1：分离后无原声重复、静音频率消失、−6dB 增益、非线性淡化、48kHz 立体声精确采样与 AAC 混音。[音频报告](artifacts/v08-20261018/audio/CONTRACT-AND-VALIDATION.md)、[集成说明](artifacts/v08-20261018/ROOT-INTEGRATION-NOTES.md)。
- 隔离生产 UI 24/24，包含 110 个新效果画面探针、音频编辑/一次撤销、预听旧版提示/重生成/取消接线、干净读与新工程自动保存、1680/1060 布局。预听 API 在此 UI 测试中为内存 mock；实际队列由上项及原生 WAV 验收承担。[UI 范围](artifacts/v08-20261018/app-ui/RESULT.md)。
- **最终安装 App 原生流程全部完成**：Finder 双击、系统 Open 导入七素材、素材库拖入及同轨/跨轨移动与撤销、两条中文双行字幕、分离原声/分贝/静音/淡化、真实 WAV 播放与过期提示/重生成/原生另存、保存正常退出后 Finder 双击重开、1080P30/high 导出/原生另存、真实成片播放至 21.026 秒再暂停、Command-W 关闭预览。工程 7 素材/8 片段/2 字幕在重开及最终退出后 JSON 逐字节一致。[原生逐项证据](V08-GUI-ACCEPTANCE.md)。

最终 MP4 与 WAV 独立 oracle **2322/2322 通过**，代码没有导入生产 model/effects/render 模块，literal 采样计划和门限在点击最终视频导出前绑定并冻结。全 1969 帧 PTS 最大绝对误差 .3334 µs；102 个不同抽样画面、1471 个像素探针最大通道误差 5.7506（门限 28），503 个按预期几何预先排除；48 个条码源时间最大误差 32.637 ms（门限两源帧）。8 个字幕区域只检布局/前景范围，非 OCR。每输出 28 个严格音高窗，MP4/WAV 最大误差 .218589/.218632 Hz；每输出 12 个源标记最大误差 13.6185/13.6165 ms；299 个源时间格点连续性窗及全域符合预设条件的相邻样本、增益、淡化和尾音均通过。550 Hz 配乐谐波与主音重合的窗口使用已知源幅度干扰界，不声称独立隔离增益。[结果](artifacts/v08-20261018/final-native-analysis/RESULT.md)、[覆盖/成本](artifacts/v08-20261018/final-native-analysis/COVERAGE-AND-PERFORMANCE.md)、[冻结绑定](artifacts/v08-20261018/final-native-analysis/plan-binding-receipt.json)。

最终 MP4 与内部任务 `eb9152dc-7ef7-430b-af09-8d5f139e46f0`、最终 WAV 与内部任务 `4df385a2-2fe8-4350-947f-93655d6abf7b` 字节相同。视频导出后首次观察到完成是提交后 204.931 秒；内部文件最后写入约提交后 95.58 秒，前者为观察上界、后者为文件时间估计，**不把任一值当成精确引擎耗时**，本次原生导出未测 CPU/RSS。独立分析命令 8.11 秒 real、8.51 秒 user、.69 秒 sys、reported peak RSS 412,975,104 B；该测量不是合成引擎成本或并发家族峰值。冷暖对照和 agent token 未计量。

最终原生截图 08–30 及参考窗口已由独立界面审阅完成，拍摄状态范围内无 P0/P1/P2 阻断；导出示意图使用首素材、统一效果图标、暂态文本选中和字形差异保留为 P3 跟进，不将 UI 风格相近称为全部剪映功能复制。[本版视觉 QA](artifacts/v08-20261018/v08-design-qa.md)。

## 保留与边界

最终正常退出后 PID 57633 消失、runtime 移除、work 为空，工程仍与最终输入完全相同。[最终退出](artifacts/v08-20261018/native-final-normal-quit-signal.json)。只读审计确认升级前 162 文件备份完整；20 个旧工程全部逐字节相同，无 updatedAt 例外；61 条旧素材字段、顺序、前缀和二进制保持，当前 68 条；原 162 文件仅 media.json 追加七记录，其他 161 完全相同。新增 17 文件为 7 媒体、6 缩略图、1 工程、3 内部导出。见 [保留审计](artifacts/v08-20261018/DELIVERY-AUDIT.md)，没有通过还原旧文件掩盖改写。旧应用、旧 ZIP、升级前 Library 和所有失败诊断保留。

用户选择的 MacBook Pro 扬声器保持，未作物理声学或听感质量评审。有限夹具通过严格音高标准，不代表所有音乐/人声、编码/GPU/系统、长 4K 或多效果最坏组合均已验证。原 .04 的旧 75ms 接缝邻域检查不能宣称为全音频门限；新机制无这种接缝，采用实现前冻结的全域 .06 标准，并保留范围映射和源跳变排除，见 `ACCEPTANCE-COVERAGE-MAPPING.json`。

真实剪映本轮仅操作合成草稿：−6dB 与 .2/.3 秒淡化实际导出、分割并应用免费“向左”转场实际导出。剪映旧四工程 236 个已哈希文件全部相同；未实现声音特效、变调/立体声平衡、完整模板/商业资源、AI/云功能或剪映草稿互通。微剪效果有独立定义，不声称剪映专有运动模糊等价。

App 为临时 ad-hoc 签名，未通过 Apple 公证；捆绑 FFmpeg 构建包含 `--enable-nonfree`，此包仅供本机个人使用，不作为公开分发版。所有许可和固定依赖源码随包保留。交付说明位于 ZIP 之外，不为更新文档修改已验收应用或压缩包。
