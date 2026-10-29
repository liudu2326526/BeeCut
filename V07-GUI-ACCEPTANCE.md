# 微剪 0.7 原生桌面验收

**最终候选2：通过。** 最终安装包ZIP SHA `4ef55b327025bb15d4de43851654e085bfdafc6794d7e61df0b0e5b55402f86c`；下文先保留候选1历史，再列修复后候选2实际复验。最终成片独立1642/1642通过，[交付总表](V07-RELEASE-VALIDATION.md)。

## 候选1历史证据

候选1操作证据保留。独立成片检查随后发现非整帧起点动画约25ms相位问题；候选2正在修复并将重新验收。以下原生动作确已完成，但当前不能作为最终交付通过。

2026-10-18，本机 Apple Silicon；候选1已安装 `~/Applications/微剪.app` 0.7.0。仅通过 CUA 操作真实界面；只读 Library/API 检查用于确认落盘后置条件。隔离 Electron/HTTP 测试另列，不算原生操作。

已完成：

- Finder 定位完整安装路径，实际双击启动。运行身份 appVersion 0.7.0，首轮 PID95203/动态端口64246；恢复最新用户编辑的0.6工程，未回退旧轨道布局。[首帧](artifacts/v07-20261018/12-final-app-first-launch.jpg)。
- 新建 `Mac-v07-长曲线波形四轨验收`，原生 Open 面板选中7个合成媒体并导入。资料库副本逐字节匹配所选源文件。[选中](artifacts/v07-20261018/13-native-seven-selected.jpg)、[导入](artifacts/v07-20261018/14-seven-media-imported.jpg)、[文件验证](artifacts/v07-20261018/native-import-byte-verification.json)。
- 真正把60秒视频由素材库拖入主轨，应用平滑逐渐加速 .5→2×，输出时长59.608143724s，超过旧38.4秒限制。原生拖动端点并撤销，恢复预设；独立20万格积分与保存值差约5.3e-13s。[曲线](artifacts/v07-20261018/15-long-curve-preset.jpg)、[拖动](artifacts/v07-20261018/16-native-curve-node-drag.jpg)。
- 三个视频分别拖到叠加1/2/3，最终起点0/1/2秒。overlay3由叠加3的2秒移到叠加2的9秒，保存验证后撤销；overlay2同轨由1秒移到3秒，保存验证后撤销。实际落盘分别见[跨轨](artifacts/v07-20261018/native-cross-layer-project.json)与[水平移动](artifacts/v07-20261018/native-horizontal-project.json)。不靠属性下拉替代拖动验收。
- overlay1在0/2秒建立25%/-600/-320→35%/-500/-320两关键帧，首键缓出。overlay3从上滑入/向下滑出 .4/.4缓入；长段→蓝段圆形展开.6，蓝段→红段向上擦除.6；蓝段顺时针旋入.6/弹性缩小.4缓出。[双关键帧](artifacts/v07-20261018/18-native-transform-keys.jpg)、[动画](artifacts/v07-20261018/22-new-transition-animation-settings.jpg)。
- 原生编辑两条中文双行字幕 .25–2.75s /58–62s；音乐0–60s，音量12%，淡入/出.2/.2。视频及WAV各6000个真实峰值已ready，按整源固定参考显示，不是输出响度表。[字幕和播放](artifacts/v07-20261018/23-native-playback-subtitles.jpg)、[数字波形](artifacts/v07-20261018/native-waveform-long-curve-clock-60s.mp4.json)。
- 点击播放再暂停，时间推进到1:08帧并显示真实源帧/字幕；没有以播放器容器存在代替首帧验收。
- 保存后正常CmdQ，PID95203确已消失、runtime.json移除；Finder再次双击同一安装路径，新PID96671/端口49805恢复工程。全部工程字段一致，仅updatedAt更新。[退出](artifacts/v07-20261018/native-normal-exit.json)、[比较](artifacts/v07-20261018/native-reopen-comparison.json)、[四轨重开](artifacts/v07-20261018/25-final-reopened-four-tracks.jpg)。

最终1080P/30fps/高画质导出已经由原生界面启动，当时记录停在最终合成阶段；后续已完成另存与检查并发现相位问题，由下文候选2修复复验。[导出设置](artifacts/v07-20261018/26-final-native-export-settings.jpg)、[进度](artifacts/v07-20261018/28-final-native-export-progress.jpg)。

完整操作时间线：[native-observations.jsonl](artifacts/v07-20261018/native-observations.jsonl)。同名AX和原图保留。系统默认输出仍是MacBook Pro扬声器，本轮没有更改系统音频设置；未进行物理扬声器听感检验。未测试其他Mac、Intel或全部媒体编码。


## 修复后候选2原生复验

安装的最终候选ZIP SHA为 `4ef55b327025bb15d4de43851654e085bfdafc6794d7e61df0b0e5b55402f86c`，161,644,057 B。安装App与release全部384项字节/模式/链接一致；替换本身前后148个Library文件完全相同。完整源码回归90/90、71文件冻结在构建后再次核对。先前动画相位缺陷、fixture模型遗漏、原失败与结构修复分别保留在 [诊断记录](artifacts/v07-20261018/CANDIDATE1-DIAGNOSIS-AND-CANDIDATE2-FIX.md)。

- Finder完整路径双击：PID14976/端口55617，[35首帧](artifacts/v07-20261018/35-candidate2-finder-first-frame.jpg)。
- 原生Open再次选中7文件导入，临时显示14媒体；一次撤销恢复原工程7媒体。导入生成的7个独立Library记录保留，registry54→61，不删除历史文件。[36](artifacts/v07-20261018/36-candidate2-native-import-fourteen.jpg)。
- 真正修改首条中文双行字幕为候选2验证文案，随后一次撤销恢复原字串。[37](artifacts/v07-20261018/37-candidate2-native-subtitle-edit.jpg)。
- 素材库overlay3拖到叠加3的6.033333秒，新增第7个画面片段后撤销；现有overlay3由叠加3/2秒拖到叠加2/9秒，overlay2同层1→3秒，分别保存读取落盘再撤销。[38素材拖入](artifacts/v07-20261018/38-candidate2-library-to-track.jpg)、[39跨轨](artifacts/v07-20261018/candidate2-native-cross-layer-project.json)、[40水平](artifacts/v07-20261018/candidate2-native-horizontal-project.json)。
- 平滑曲线60源秒/59.608秒、关键帧/效果/字幕/配乐完整保留；所有操作撤销后，核心工程与原计划逐字段一致，仅updatedAt更新。[41曲线](artifacts/v07-20261018/41-candidate2-long-curve-ready.jpg)、[保存退出与比较](artifacts/v07-20261018/candidate2-native-exit-before-reopen.json)。
- 正常CmdQ，14976消失且runtime移除；Finder再双击得到新PID15626/端口56296，工程核心一致。四轨与真实波形、两个字幕可见，[42](artifacts/v07-20261018/42-candidate2-final-reopened-four-tracks.jpg)、[重开比较](artifacts/v07-20261018/candidate2-native-reopen-comparison.json)。
- 八转场选项及向上擦除.6、旋转.6/弹性.4缓出参数再次可见，[43](artifacts/v07-20261018/43-candidate2-final-transition-panel.jpg)、[44](artifacts/v07-20261018/44-candidate2-final-animation-panel.jpg)。
- 最终1080P/30/high从此重开工程实际启动，job2612939e-3b88-4883-b0bd-8eb7b090257c；[45设置](artifacts/v07-20261018/45-candidate2-final-export-settings.jpg)、[46启动](artifacts/v07-20261018/46-candidate2-native-export-started.jpg)。此候选随后已完成导出、原生另存、真实成片预览及1642/1642独立检查，详见下段。


候选2最终完成后置条件：

- [48完成](artifacts/v07-20261018/48-candidate2-native-export-completed.jpg)、[49系统另存](artifacts/v07-20261018/49-candidate2-native-save-as.jpg)、[50返回](artifacts/v07-20261018/50-candidate2-native-save-returned.jpg)。实际路径 `~/Movies/微剪导出/weijian-v07-final-candidate2-20261018.mp4`，3,463,143 B，SHA `228391824d920d16a0af90b1dcf1452e9bae85756722ff48ab9048ae276f9187`；与内部引擎文件逐字节相同。[字节收据](artifacts/v07-20261018/candidate2-native-final-movie.json)。
- 点击“预览成片”在本应用独立窗口打开真实MP4，初始pause/进度0；源画面已实际推进，空格后出现play按钮，scrubber19.365，显示绿色源帧10.433s/n0313。[51画面](artifacts/v07-20261018/51-candidate2-native-export-preview.jpg)、[52暂停](artifacts/v07-20261018/52-candidate2-native-preview-paused.jpg)。本次使用原生关闭按钮关闭预览子窗口；CmdW没有关闭此子窗口，未把该快捷键记为通过。
- 返回编辑保存，正常CmdQ后15626退出、runtime移除，work为空；工程全部核心字段与导出输入一致，仅updatedAt更新。[最终退出](artifacts/v07-20261018/candidate2-native-final-exit.json)。
- 最终MP4独立1642/1642：全1969帧PTS、102个画面抽样帧、1465有效像素/509预定排除，最大RGB误差4；48源条码、34音调窗、6接缝、6配乐增益窗、8非OCR字幕区域均过。原第1873帧失败像素已从误差148降至4，原门限未改。[最终结果](artifacts/v07-20261018/final-native-analysis-candidate2/RESULT.md)、[精确覆盖](artifacts/v07-20261018/final-native-analysis-candidate2/COVERAGE-AND-PERFORMANCE.md)。
- 默认输出仍为MacBook Pro扬声器，[只读设备收据](artifacts/v07-20261018/candidate2-audio-final.json)。没有物理听感、逐帧画面或所有设备/编码通过声明。旧19工程及47媒体保留核对通过，[审计](artifacts/v07-20261018/DELIVERY-AUDIT.md)。
