# 微剪 1.0 原生桌面验收

2026-10-19。最终候选3已通过Finder启动、原生导入、多轨拖动、保存退出重开、完整实时录音、WAV生成/另存、1080P30 MP4导出/另存及成片播放/暂停/关闭。本报告记录真实操作；复杂场景的初始构造另行标记。前两个被否决的候选和负证据继续保留。

## 夹具与操作

验收使用新建的 `Mac-v10-实时音效关键帧一致性验收`，工程ID `f64f8625-43e3-4c04-be4d-4ecf8da9bb7b`。10个自制视频/音频文件经原生文件选择器导入；随后以公开工程API建立四画面轨、四音频轨、曲线速度、增益关键帧、声像/滤波/回声、两条字幕和两个新转场的复杂夹具。初始API准备只作为夹具构造，不计为GUI编辑成功。候选2又通过原生选择器导入第11个文件。

真实操作证据均在 `artifacts/v10-20261019/`：

| 操作 | 实际结果与证据 |
| --- | --- |
| Finder双击启动 | 候选1/2均打开已安装的`~/Applications/微剪.app`；新实例PID/端口与版本有独立runtime收据，截图12、23 |
| 导入 | 截图13–14为10文件多选及完成，截图24为候选2新增WAV，素材数11 |
| 画面跨轨拖动 | 候选1把叠加2从layer2/start1拖到layer3/start6，保存快照`native-picture-drag.json`；随后撤销 |
| 音频跨轨拖动 | 候选1及2均把立体声音频从layer1/start0拖到layer2/start2；候选2截图25及`native-candidate2-audio-cross-drag.json`，随后撤销 |
| 素材拖入时间线 | 候选1/2均把库中的回声素材拖到第四音轨start17，片段10→11；候选2截图26及`native-candidate2-library-to-track.json`，随后撤销 |
| 一帧移动 | 候选1按钮将start1改为1.033333，快照`native-one-frame-nudge.json`，随后撤销 |
| 关键帧编辑 | 候选1播放时选择首个音量关键帧并输入1.58dB；保存后约120%增益在候选2重新启动时仍存在 |
| 字幕编辑 | 原生输入两行中文第二字幕并保存，候选2重新启动仍显示，截图22–23 |
| 预览画面 | 已看到源时间码、彩色标记及叠加画面；截图23、25、28、30，不能据此宣称所有设备/编码均无黑屏 |
| 音频输出设置 | 候选2播放前`system_profiler`读回默认输出为MacBook Pro扬声器、48kHz；不等于物理扬声器录音测量 |

## 已发现并保留的失败

候选1从长时间暂停状态先点录制再点播放，会因错误计算播放时钟导致录音立即结束。已修复，旧实际负控和新实际正控见`realtime/CLOCK-PAUSE-CAPTURE-FIX.md`；候选2原生截图28证实录制启动后仍在继续。

候选2在17.933333秒、七个含音频片段的完整场景中，实际录音只保存50,432帧（应为860,800），期间出现自动定位和一次缓冲。首次录音终结先于记录到的缓冲，不能把缓冲直接认定为首次终结原因。暂停操作也结束了录音片段。实际WAV和样本时钟JSON保存在`candidate2-package/`，不计为整片一致性通过。主界面把画面就绪混入音频播放意图、普通时间更新推断成seek、反向追图像及生产/消费窗口不一致等根因已统一修复，见[完整修复报告](artifacts/v10-20261019/realtime/SUSTAINED-TRANSPORT-FIX-CANDIDATE3.md)。

## 最终候选3实操结果

安装包SHA-256为`0404a8a160af90e4a4f5a1ed7e4cded557ec23de29e74f7996035b14e1a1a032`，与ZIP、发布和实际安装副本绑定。截图32–51均为此包。

- 32/33：Finder双击和新的WAV原生导入，素材11→12。34：画面layer2/start1→layer3/start6；35：音频layer1/start0→layer2/start2；36：素材拖到第四音轨start17，10→11片段。每项保存后用独立只读API快照核位置，随后原生撤销恢复基线。
- 37：播放约3:05时，首个音量关键帧仍保持选中，原生输入1.6dB；继续播放时恢复1.58dB。四条源波形均已实际显示。所有片段、关键帧、字幕、效果与冻结基线相同，只追加未用素材及更新时间。
- 38/39：CmdS、CmdQ后runtime移除、原PID8875退出，再Finder双击打开。重开工程的全部JSON字段包括updatedAt严格一致，见`native-final-reopen-equivalence.json`，两个快照SHA同为`549f337baa3e2f3e52f2b7d8058321ff40e859b326b1930f55d0ab36a1fd7d10`。
- 40–43：重开后从0开始录制，中间原生暂停到9:21再恢复，录制按钮仍活动；完整录到860,800帧，0 underrun/overrun。实际AudioWorklet host PID11923与主编辑renderer PID11699不同。Float32 WAV和JSON均经原生另存，`native-final-capture-quickcheck.json`核实际文件SHA与sidecar相同。
- 44/45：生成整个工程WAV，实际播放、暂停，屏幕显示约0:10/0:17，再原生另存。46–48：1080P/30fps/高画质MP4实际导出并另存。两种SaveAs文件都与Library内生成文件逐字节一致，见`native-final-output-pairs.json`。
- 49/50：成片独立窗口播放、重播和暂停，源时间码、彩色画面、双行中文字幕可见；CmdW关闭成片预览，51返回编辑并保存。最后正常CmdQ，主进程11691、编辑renderer11699、audiohost11923全部退出，runtime不存在，见`native-final-normal-quit-signal.json`。
- 默认输出在最终录制前及全部GUI结束后均为MacBook Pro扬声器、48kHz，见`sound-before-final-capture.json`和`sound-final.json`。没有采集物理扬声器响应。

实时与离线WAV完整860,800帧、1,721,600个声道样本值比较，最大绝对误差`1.52587890625e-5`，低于事先门限`8e-5`。原冻结WAV/AAC比较164/164通过。独立视频检查枚举全部538个PTS、30fps连续网格，并检查每个320×180缩小帧的可见画面，4/4通过；这不是全部像素一致性或字幕OCR。补充音高/标记/回声检查及方法限制以[发布验证](V10-RELEASE-VALIDATION.md)为准。

## 保存与保护范围

候选1、2均以CmdS保存、CmdQ正常退出，再用runtime文件移除及原PID退出双重核对。候选2重开了候选1保存的素材、关键帧和字幕。最终候选3的完整流程如上，资料库保护审计另见本轮独立收据，不用旧版本结果代替。

剪映仅打开自制参考草稿。操作和边界见[V10-JIANYING-REFERENCE.md](V10-JIANYING-REFERENCE.md)。草稿导入目前是[已确认需求](JIANYING-DRAFT-COMPATIBILITY-REQUIREMENTS.md)，尚未实现。
