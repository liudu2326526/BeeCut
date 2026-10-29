# 微剪 0.6 原生桌面验收

2026-10-18，Apple Silicon Mac。结论绑定最终 ZIP SHA-256 `d4e027118ab8467e9c4e6b0cd9e678b2de8d6139715cac4157c7e345faa7eeb9` 与已安装 `/Users/macbook/Applications/微剪.app`，版本 0.6.0。以下操作通过真实 macOS 界面完成；公开 API 只读及磁盘核对用于验证结果，没有用 API 写入代替 GUI 操作。

## 最终安装版闭环

验收工程 `Mac-v06-平滑曲线四轨验收`，ID `b06ceb1c-31ff-4a90-b80d-cf8faf84c76d`。内容为一条主轨、三条叠加轨、独立配乐和两条中文双行字幕。素材为独立生成的 H.264/AAC、WAV、PNG 测试文件，不含用户私人媒体。

| 操作 | 实际结果与证据 |
| --- | --- |
| Finder 双击 | 精确选中 `~/Applications/微剪.app` 双击启动，进程路径属于已安装应用，零秒显示源时钟及叠加画面。[启动绑定](artifacts/v06-20261018/final-finder-runtime.json)、[28](artifacts/v06-20261018/28-wj-v06-final-finder-zero.jpg) |
| 素材拖入轨道 | 从素材库拖动 blue-b 到叠加轨 1 的 4 秒，片段总数 6→7，保存后只读确认新增片段的素材、层和时间；一次撤销还原。[29](artifacts/v06-20261018/29-wj-v06-final-library-drag.jpg)、[工程](artifacts/v06-20261018/native-final-library-drag.json) |
| 同轨和跨轨移动 | overlay3 在第 3 层从 2→4 秒，再拖到第 2 层 4 秒，与原有片段首尾相接。每次保存核对落位；两次撤销后所有工程内容除 updatedAt 外与原快照完全相同。[30](artifacts/v06-20261018/30-wj-v06-final-horizontal-move.jpg)、[31](artifacts/v06-20261018/31-wj-v06-final-cross-layer.jpg)、[核对](artifacts/v06-20261018/native-final-drag-validation.json) |
| 冲突保护 | 试图将第 3 层 2 秒片段拖入第 2 层 2 秒重叠区域，明确提示不能重叠，原工程不变。[32](artifacts/v06-20261018/32-wj-v06-final-collision-rejected.jpg) |
| 平滑曲线拖动与撤销 | 中间节点从源 3.5s/1.1× 拖为 3.92899s/1.354076×，连续曲线时长变为约 7.230984s；后续片段保持原位置，出现空隙后移除失效转场。一次撤销恢复全部片段字段、原曲线和转场。[33](artifacts/v06-20261018/33-wj-v06-final-curve-node-drag.jpg)、[编辑后](artifacts/v06-20261018/native-final-curve-drag.json) |
| 原生素材导入 | 系统 Open 对话框导入 overlay-cyan.png，素材 6→7，未改变时间线。此前六个视频/音频通过原生面板导入，逐文件身份已核对。[34](artifacts/v06-20261018/34-wj-v06-final-native-import.jpg)、[六文件校验](artifacts/v06-20261018/native-import-identity.json) |
| 播放与预览 | 原生播放头持续前进；暂停定位 2.6 秒，主画面、三个叠加层及双行中文字幕同时可见。[35](artifacts/v06-20261018/35-wj-v06-final-four-layer-preview.jpg) |
| 保存退出重开 | 手动保存后正常 Cmd-Q，旧 PID 64580 已退出；Finder 再次双击，新 PID 65944、动态端口 65448。重开工程除 updatedAt 外逐字段完全一致：7 素材、6 片段、2 字幕，首帧正常。[36](artifacts/v06-20261018/36-wj-v06-final-finder-reopen.jpg)、[重开绑定](artifacts/v06-20261018/native-final-reopen-validation.json) |
| 关键帧、动画、转场保留 | overlay1 两个变换关键帧、overlay3 的 0.4s 缩放入场和向右出场/缓入、主轨 0.5s 向右擦除均从重开工程恢复。曲线仍为 .5→1.1→2、8s 源、7.739153071s 输出。[40](artifacts/v06-20261018/40-wj-v06-final-keyframe-inspector.jpg)、[41](artifacts/v06-20261018/41-wj-v06-final-animation-inspector.jpg)、[42](artifacts/v06-20261018/42-wj-v06-final-transition-inspector.jpg)、[43](artifacts/v06-20261018/43-wj-v06-final-saved-curve.jpg) |
| 视频导出及原生另存 | GUI 选择 1080P/30fps/高画质，任务由进度到“视频已导出”；点击下载，经系统保存面板另存到 `~/Movies/微剪导出/weijian-v06-final-20261018.mp4`。另存与后台输出逐字节相同。[37](artifacts/v06-20261018/37-wj-v06-final-export-progress.jpg)、[38](artifacts/v06-20261018/38-wj-v06-final-export-completed.jpg)、[39](artifacts/v06-20261018/39-wj-v06-final-save-mp4.jpg)、[核对](artifacts/v06-20261018/native-final-export-validation.json) |

完整原生观察按时间追加在 [native-observations.jsonl](artifacts/v06-20261018/native-observations.jsonl)，同名 AX 文本记录控件及最终状态。早期临时诊断安装副本已经退役，最终版不含输入观察器；故障根因及修复见 [拖拽报告](V06-NATIVE-DRAG-DIAGNOSIS.md)。上表均在修复后最终包上重跑，未用旧候选成功替代最终验证。

## 成片独立验证

本次 GUI 新建导出任务 `1509d4a0-5f8f-4dc6-91bb-cf20fb13fb8f`，最终文件 482,966 字节，SHA-256 `711c82e2dee46873ec8b27d9126e36ccf09737c327d1015b062a509852ec9556`。

[独立报告](artifacts/v06-20261018/final-native-analysis/RESULT.md) **125/125 断言通过**：1920×1080 H.264/AAC、30fps、323 帧、10.766667 秒、尾帧非黑。16 个源时钟探针、76 个四层/关键帧/动画/擦除像素探针、10 个字幕边界区域探针、13 个音调探针通过。检查器不导入生产模型或渲染函数，使用独立数值积分与原始测试素材几何契约；输入哈希、命令、资源采样由 [执行收据](artifacts/v06-20261018/final-native-analysis/execution-receipt.json) 绑定。

此报告的 46 个不同视频采样帧不等于逐帧验证全部 323 帧；字幕检查是区域出现/消失而非 OCR，数字音调检查不证明配乐 .1 增益的独立校准、真实扬声器听感或样本级曲线音画等价。专项后端逐帧条码、音频 marker、裁剪/拆分与资源边界另见 [后端验证](artifacts/v06-20261018/BACKEND-CONTRACT-AND-VALIDATION.md)。

用户明确选择保留扬声器；最终默认输出仍为 MacBook Pro 扬声器、48kHz，未恢复 ToDesk 或改变其他声音设置，见 [系统只读记录](artifacts/v06-20261018/audio-final.json)。本轮未覆盖 Intel、其他 Mac/音频设备、全部编码或长 4K 多轨工程。
