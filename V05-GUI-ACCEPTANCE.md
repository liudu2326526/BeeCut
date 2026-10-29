# 微剪 0.5.0 最终安装包原生验收

2026-10-18，本机 macOS / Apple Silicon。全部界面动作通过系统可访问性与原生键鼠完成，未用隐藏 DOM/API 写入代替文件选择器、保存、退出、重开或导出。之后的只读 API/文件及独立解码用于核对结果。

绑定包：`release/微剪-0.5.0-mac-arm64.zip`，SHA-256 `8133732fb0083025492aa493ed85dd7f0fc2000b941a7f51cac80de9a7e38216`。已安装 `/Users/macbook/Applications/微剪.app` 与 release 逐项相同，见 [同一性收据](artifacts/v05-20261018/final-installed/installed-release-equivalence.json)。系统输出为 MacBook Pro 扬声器；ToDesk 恢复事项单列在 [交付报告](V05-RELEASE-VALIDATION.md)。

| 原生动作及实际观察 | 证据 |
| --- | --- |
| Finder 双击已安装 app，已存验收工程从 0 秒打开，红色画面及白角标正常，无超时遮罩 | [56 截图](artifacts/v05-20261018/56-wj-final05-finder-cold-zero.jpg) |
| 点击实际导入按钮，系统文件选择器选择 final-import-marker.png；素材 4→5；点击保存显示已保存。新素材源文件/Library 字节一致，原有剪辑设置和前四素材未变 | [57 截图](artifacts/v05-20261018/57-wj-final05-native-import-saved.jpg)、[保存核对](artifacts/v05-20261018/final-native-save-process.json) |
| ⌘Q 正常退出，PID 75315 已退出且 runtime.json 已移除 | [退出核对](artifacts/v05-20261018/final-native-quit.json) |
| 再从 Finder 双击启动，重新打开 5 素材、两画面、两字幕及配乐工程，0 秒首帧正常；新 PID 75761，监听归同一已安装进程 | [58 截图](artifacts/v05-20261018/58-wj-final05-reopened-zero.jpg)、[重开核对](artifacts/v05-20261018/final-native-reopen-runtime.json) |
| 关键帧前后定位：5 秒缩放 100% / X0，7 秒 50% / X120；退 30 帧到 6 秒，面板 75% / X60，蓝色画面及第二条字幕正常 | [59 截图](artifacts/v05-20261018/59-wj-final05-reopened-keyframe-midpoint.jpg) |
| 分段变速重开保留：源 0–2 秒 2×，源 2–4 秒 0.5×，阶梯图与输出 5 秒一致 | [60 截图](artifacts/v05-20261018/60-wj-final05-reopened-step-speed.jpg) |
| 从 0 点击播放，时间推进到 1 秒 12 帧时已显示绿色及首条字幕，跨过 2×→0.5×边界 | [61 截图](artifacts/v05-20261018/61-wj-final05-play-from-zero.jpg) |
| 导出面板选择 720P，保持 30fps、高画质，点击开始导出，实际出现“视频已导出” | [62 截图](artifacts/v05-20261018/62-wj-final05-export-complete.jpg) |
| 点击下载视频，原生保存面板另存为 weijian-v05-final-20261018.mp4；与本次 Library job 文件一致 | [63 截图](artifacts/v05-20261018/63-wj-final05-native-download-saved.jpg)、[下载核对](artifacts/v05-20261018/final-native-analysis/native-download-identity.json) |
| 返回编辑并回到开头，0 秒红帧仍正常，工程保持已保存 | [64 截图](artifacts/v05-20261018/64-wj-final05-accepted-zero.jpg) |

工程 `Mac-v05-关键帧变速验收` / `4eb8f67e-459a-4a3a-b782-65a6413aec4c`。最终 [保存 checkpoint](artifacts/v05-20261018/final-native-saved-project.json) 与重开工程除 updatedAt 外完全一致；API 与实际项目 JSON 完全相同。两条字幕时段分别 .25–2.25 秒、5.25–7.75 秒；配乐 0–6 秒，音量 .25，入出淡变各 .2 秒。

最终另存文件位于 `/Users/macbook/Movies/微剪导出/weijian-v05-final-20261018.mp4`。独立分析器不导入编辑器 model 或 renderer，使用已知合成源及预设的时间/几何预期：21/21 检查通过，见 [独立成片报告](artifacts/v05-20261018/final-native-analysis/RESULT.md)。字幕检查验证可见时段及绘制特征，未做 OCR；物理输出听感未测。

原生本轮重点是最终包导入和已有编辑工程的保留、播放与导出。关键帧/字幕/分段的创建和编辑已有此前原生记录及生产 React 控件集成记录，但没有将它们全部重新创建在这个冻结包中。转场/动画组合的最终输出有逐帧独立检查，其他转场与蒙版组合另有源码真实 FFmpeg 测试；不据此声称最终包的所有控件或所有格式都逐项原生验收。
