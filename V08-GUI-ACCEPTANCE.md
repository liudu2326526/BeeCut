# 微剪 0.8 原生桌面验收

2026-10-18，本机 Apple Silicon，最终安装路径 `/Users/macbook/Applications/微剪.app`，应用版本 0.8.0。只通过 CUA 操作真实原生窗口；素材准备、JSON 后置核对和独立媒体分析另列，不将它们计为鼠标或键盘编辑。截图和 AX 证据位于 [本轮目录](artifacts/v08-20261018/)，操作记录见 [native-observations.jsonl](artifacts/v08-20261018/native-observations.jsonl)，导出前计划见 [NATIVE-ACCEPTANCE-PLAN.md](artifacts/v08-20261018/NATIVE-ACCEPTANCE-PLAN.md)。

## 已完成的真实操作

1. Finder 新窗口中确认 `file:///Users/macbook/Applications/微剪.app/` 并双击，runtime 报告 0.8.0、PID 55301、动态本机端口 56899。升级安装前后 162 个资料库文件完全一致；首次只读打开旧 0.7 工程后，全部 20 个旧工程仍逐字节相同。Finder 的旧窗口曾保留已移动的旧应用 URL，因此使用新窗口和当前路径重新定位，没有将旧 URL 计为新版启动。见 [08](artifacts/v08-20261018/08-finder-first-launch.png)、[初次读审计](artifacts/v08-20261018/initial-clean-read-project-preservation.json)。
2. 新建并命名 `Mac-v08-保调音频四轨验收`，原生 Open 面板选择 6 个 MP4 与 1 个 WAV，确认“7 items”后实际导入；界面显示“已导入 7 个素材”，新工程也已自动保存。原生面板的键盘全选未成功时改用 Shift 连续多选；原始尝试保留。见 [09](artifacts/v08-20261018/09-native-import-selection.png)、[10](artifacts/v08-20261018/10-native-import-complete.png)。
3. 为可重复分析，通过本机项目 API 在这个新工程中准备确定性场景：60 秒源视频的 .5→2 平滑曲线、三条叠加轨、两个后续视频、配乐、关键帧、转场与字幕时段。该准备不是原生逐个编辑。输入、输出和原生导入空工程分别保留为 `native-fixture-setup-input.json`、`native-fixture-setup-response.json`、`native-imported-blank-project.json`，未替换旧工程。
4. 实际从黄色素材卡拖入叠加轨 3，新增片段 start=9.033333；一次撤销移除。实际将原有黄色片段从 layer3/start2 拖到 layer2/start9.033333，核对后一次撤销。第二层视频同轨 start1→3，核对后撤销。第一次同轨手势只选中片段，第二次完成移动；使用最终落盘结果判断成功。见 [11](artifacts/v08-20261018/11-native-library-drag.png)、[12](artifacts/v08-20261018/12-native-cross-track-drag.png)、[13](artifacts/v08-20261018/13-native-same-track-drag.png) 及对应 `native-drag-*.json`。
5. 原生选择长曲线视频并“分离音频”，产生独立音频片段，原画面 `audioDetached=true`。通过实际键盘输入 −6 dB、淡入 0.4 秒/正弦、淡出 0.6 秒/缓出；静音再取消，保留精确增益 `0.5011872336272722`。AX setValue 对 React 数字框未提交，改为真实键盘输入并核对保存 JSON，没有将未提交尝试计为成功。见 [14](artifacts/v08-20261018/14-native-audio-muted.png)、[最终音频字段](artifacts/v08-20261018/native-after-audio-edits.json)。
6. 原生生成整工程保调 WAV，播放器实际从 play→pause，截图时钟推进到 20 秒以上；暂停返回编辑后将 −6→−5 dB，打开结果明确显示“这是旧版预听”。恢复 −6 dB，并实际更新两条中文双行字幕，切换向右/向左推进后保留向左推进 0.6 秒。再次显式生成最终 WAV，经系统保存窗口另存。见 [17](artifacts/v08-20261018/17-native-preview-clock.png)、[18](artifacts/v08-20261018/18-native-stale-preview.png)、[19](artifacts/v08-20261018/19-native-transition-setting.png)、[20](artifacts/v08-20261018/20-native-final-wav-saved.png)。播放器时钟截图比 AX 的缓存数值更及时；不以 AX 中临时“Unable to play media”文字代替实际播放结果。
7. Command-S 保存后 Command-Q 正常退出，PID 55301 消失、runtime 文件移除、work 为空。再次通过 Finder 当前路径双击，获得新 PID 57633、动态端口 59754，自动恢复同一工程；7 素材、8 片段、2 字幕，以及所有轨道、音频、曲线、关键帧和效果 JSON 完全一致，连 updatedAt 都未变化。实际预览播放后暂停；蓝色片段属性确认缩放渐显 0.6 秒、旋转渐隐 0.4 秒、缓出。见 [退出收据](artifacts/v08-20261018/native-first-normal-quit.json)、[重开比较](artifacts/v08-20261018/native-reopen-comparison.json)、[22](artifacts/v08-20261018/22-native-reopened-playback.png)、[23](artifacts/v08-20261018/23-native-new-animations.png)。

## 输出与独立检查

最终 WAV：`/Users/macbook/Movies/微剪导出/weijian-v08-pitch-preview-20261018.wav`，12,601,678 B，SHA-256 `5a615bc85976ca2b46fdc9883ff686fd888ed5907ac79f34819e50e7ee951d86`。系统另存与内部任务 `4df385a2-2fe8-4350-947f-93655d6abf7b` 的输出逐字节相同，见 [收据](artifacts/v08-20261018/native-final-wav-receipt.json)。

WAV 独立检查 368/368：3,150,400 个立体声样本帧精确；28 个稳态音高窗口最大误差 0.218632 Hz，沿用预先冻结的 max(0.5 Hz,0.1%)；12 个源标记最大误差 13.6165 ms；尾音、混音增益、淡化和连续性通过。2,993,980 个符合预设条件的相邻样本最大跳变 .0152349，156,419 对原始素材自身跳变附近样本按冻结规则排除。550 Hz 与配乐谐波重叠窗口使用已知源干扰幅度界，不称为隔离增益检查。见 [冻结计划](artifacts/v08-20261018/final-native-analysis/plan-binding-receipt.json)、[WAV 结果](artifacts/v08-20261018/final-native-wav-analysis/summary.json)。

最终 MP4 已从原生按钮提交，1080P/30fps/高画质；经系统 Save As 保存至 `/Users/macbook/Movies/微剪导出/weijian-v08-native-final-20261018.mp4`，3,281,941 B，SHA-256 `38d9ba8bc8bd19eeb98c989607595522f60d6be52a29d008db023feacae219e6`。与内部任务 `eb9152dc-7ef7-430b-af09-8d5f139e46f0` 字节相同。真实成片窗口显示 0.8 中文双行字幕并自动播放，实际时钟至 21.0261 秒后点击暂停；源视频画面与时钟继续正常解码。Command-W 成功关闭成片窗口回到主编辑器。见 [25 导出完成](artifacts/v08-20261018/25-native-export-completed.png)、[26 播放](artifacts/v08-20261018/26-native-mp4-playing.png)、[27 暂停](artifacts/v08-20261018/27-native-mp4-paused.png)、[28 关闭](artifacts/v08-20261018/28-native-cmdw-closed-preview.png)、[成片身份](artifacts/v08-20261018/native-final-mp4-receipt.json)。

MP4+WAV 独立 oracle **2322/2322**，最终输出后未修改脚本、采样点、排除或门限。全 1969 帧 PTS、102 个抽样画面/1471 像素、48 源条码、每输出 28 音高窗口/12 源标记、增益/淡化/尾音和连续性通过。MP4 最大音高误差 .218589 Hz、标记 13.6185 ms；最大像素误差 5.7506。503 个预定几何排除另列，字幕区域非 OCR，画面非全片逐像素。见 [最终独立结果](artifacts/v08-20261018/final-native-analysis/RESULT.md) 和 [精确范围](artifacts/v08-20261018/final-native-analysis/COVERAGE-AND-PERFORMANCE.md)。

返回主编辑器后，将横向滚动条拖回开头并定位 2.533 秒，真实预览同时显示主画面、三层叠加视频和双行字幕，主视频与分离原声的源波形已生成，未出现黑屏。选中独立音轨仍为 −6dB、.4 秒正弦、.6 秒缓出。见 [29 四层预览](artifacts/v08-20261018/29-native-four-layer-preview.png)、[30 音频参数](artifacts/v08-20261018/30-native-final-audio-inspector.png)。

最终再次正常 Command-Q：PID 57633 消失、runtime 移除、work 为空；工程与导出输入 JSON 逐字节相同。20 个旧工程全部字节相同；61 条旧媒体及其顺序/前缀/二进制保留，新增 7 条导入，旧 162 文件中仅 media.json 追加记录，其他 161 完全不变。见 [最终退出](artifacts/v08-20261018/native-final-normal-quit-signal.json)、[保留审计](artifacts/v08-20261018/DELIVERY-AUDIT.md)。

所有验收仅覆盖本机确定性 H.264/AAC/WAV 工程。未作物理扬声器音质评审、全部编码/GPU/系统兼容或全剪映功能等价声明。用户选择的 MacBook Pro 扬声器保持。
