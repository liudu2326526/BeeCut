# 微剪 0.5 预览黑屏排查与修复

2026-10-18。结论：本轮原生 0 秒黑屏已在实际安装包的生产 UI 中隔离复现，对照将故障缩至 **预先初始化 WebAudio 输出的路径**：同一 AAC 素材、相同双媒体元素改走 HTMLAudio 原生输出，首帧恢复；单独视频和去音轨副本也正常。最终源码移除 WebAudio 初始化；普通 0–100% 音量按设置传给原生媒体元素，超过 100% 的工程与导出设置保留，面板明确提示预览上限。最终 0.5 包在 **MacBook Pro 扬声器输出下**完成访达冷启动、原生导入、保存退出重开、实际播放和新视频导出；成片独立 oracle 21/21 通过。最终包 SHA-256 为 `8133732fb0083025492aa493ed85dd7f0fc2000b941a7f51cac80de9a7e38216`。

原默认输出为 ToDesk Virtual Audio。用户批准临时切换扬声器并恢复后，同一旧 04 包在扬声器下冷启动也立即出现首帧，支持输出设备与 WebAudio 组合路径有关，**不证明驱动损坏**。切换后 ToDesk 从当前输出设备列表消失，尚未恢复；最终原生验收不能写成 ToDesk 输出已验证，具体状态见末尾。

此前还因果复现并修复 **0.4 暂停状态下只切换素材 URL 未重新定位** 的独立缺陷，以及快音频抢跑/反复重播的就绪门禁问题。**没有取得 0.4 首次原生故障会话的内部状态，不能证明历史那一次就是上述原因，也不能声称所有黑屏均已消除。**

本报告的自动化均为独立隐藏窗口与自行生成素材，使用临时 userData 和内存工程 API，没有控制已安装主窗口或写入用户 Library。它补充源码测试；末尾原生结果由根代理操作真实安装包并保留截图和收据，详见 [0.5 GUI 验收](V05-GUI-ACCEPTANCE.md) 与 [0.5 发布验证](V05-RELEASE-VALIDATION.md)。

## 历史证据与边界

0.4 首包原生会话曾显示黑屏及 “Unable to play media”，HTTP GET/Range、媒体字节与独立解码检查正常；同包正常退出重启恢复。当时没有记录故障窗口的 `MediaError`、`readyState`、播放拒绝、seek 状态或图层像素，不能从之后的正常会话倒推出原因。参见 [0.4 原生验收](V04-GUI-ACCEPTANCE.md) 与 [旧独立解码结果](artifacts/v04-20261018/decode-diagnosis/hidden-decode-result.json)。

0.4 导出第 98 帧空洞是已独立修复的 FFmpeg 帧覆盖问题，与这次预览排查分开。快速释放隐藏测试解码器时偶见 Chromium GPU stderr 警告，但本轮正确帧及恢复检查通过；这些警告不足以把历史黑屏归因 GPU。没有添加关闭硬件加速的猜测性开关。

## 可以复现的源切换缺陷

将原 `PlaybackMedia` 原样保存，使用实际 React/HTMLVideoElement、支持 byte Range 的本地 HTTP 和两份原创 2 秒 H.264 素材：A 为蓝→红，B 为黑→黄。暂停目标均为 1.5 秒，保留同一 clip、time、playing、muted，仅更换 `media.url`。

- 原 0.4：A 正确定位 1.5 秒，中心 RGB `254,0,0`；换 B 后停在 **0 秒 / 黑色**，`readyState=4`、`error=null`，没有 seeked。
- 原因：React 更换了 `<video src>`，但同步 effect 的依赖没有 `media.url`；新媒体重置到首帧后，没有重新同步既定位置。不是输入编码损坏或导出黑帧。
- 0.5：同一操作重新加载并定位 B 的 **1.5 秒 / RGB `255,255,0`**，保持暂停，未重启应用。

[原组件](artifacts/v05-20261018/preview-diagnosis/PlaybackMedia-v04.jsx)、[旧版实测数据](artifacts/v05-20261018/preview-diagnosis/old-source-swap-result.json)、[旧黑帧截图](artifacts/v05-20261018/preview-diagnosis/old-source-swap-black.png)、[新版实测数据](artifacts/v05-20261018/preview-diagnosis/new-preview-result.json)、[新版同位置黄帧](artifacts/v05-20261018/preview-diagnosis/new-source-swap-yellow.png)。保留了构建和运行脚本，结果绑定实际 bundle/素材哈希。

## 本轮原生首次 0 秒预览的新证据

隐藏测试正常之后，根代理在已安装的 0.5 候选进行原生操作，又实际抓到新导入、无动画的 `speed-red-green-4s.mp4` 在 0 秒黑屏：超时详情为 **ready=1 / network=1 / 当前=0 / 目标=0**。这表明 metadata 可用但当前画面尚未 decoded，不能再把 0.4 问题仅归为 source-only 切换。[原生超时截图](artifacts/v05-20261018/23-wj-preview-timeout-native.jpg)、[AX 状态](artifacts/v05-20261018/23-wj-preview-timeout-native.ax.txt)。随后原生按重载并向前定位见红，因包含两个动作，不能分开证明哪个使它恢复。[恢复截图](artifacts/v05-20261018/24-wj-reload-and-seek.jpg)。

已修明确缺口：原控制器在 target=0 等于 currentTime=0 时只等 loadeddata，不发首帧定位请求。现在每个源代际在 metadata 后 **强制定位目标一次，包括 0**；后续普通更新不会重复初始定位。第 10 项回归模拟 metadata-only 的实际观测阶段，确认 0 秒也请求一次 seek，完成后 ready，10 次普通更新不重复请求，人工重载才开启下一代。错误详情增加“首次定位已请求/未请求”和失败前阶段，便于原生再发时区分等待位置。

独立进程只读同一实际导入文件，普通 0 秒加载正常，未复现原生停滞；metadata 时主动 seek 0 的实测顺序为 **ready1 → seeking ready1 → seeked/loadeddata ready4**，当前仍为 0 秒、红色 RGB `254,0,0`。[实际素材 0 秒对照](artifacts/v05-20261018/preview-diagnosis/native-fixture-zero-result.json)。这证明有界首帧请求路径有效，尚不等于最终安装包原生冷启动已通过；最终结果由根代理重新打包后验收记录。没有据此将平台/锁屏/GPU 机制宣称为已查清。

### 首次定位之后的原生反证与迟到就绪

候选 02 在访达冷启动后再次实际黑屏，诊断为 **ready1 / network1 / phase seeking / 首次定位已请求 / current0 / target0**。它否定了“只补一次 seek 0 就足以解决原生问题”，之前的隐藏检查不能替代这次原生失败。[34 号原生失败](artifacts/v05-20261018/34-wj-final-finder-cold-start-zero.jpg)。

随后根代理只按手动重载，未 seek/play，画面后来已经出现 0 秒红色及白角标，但超时错误仍覆盖。[35 号重载初态](artifacts/v05-20261018/35-wj-final-manual-reload-zero.jpg)、[36 号迟到红帧及旧错误](artifacts/v05-20261018/36-wj-reload-only-result.jpg)。可以确定原控制器把等待截止与永久失败混在一起：任何 failure 都阻止之后的同源就绪事件更新状态。不能由此推断底层首次解码为什么慢。

诊断候选 `0.5.0-preview-diagnostics-3` 保留 8 秒等待提醒，**仅允许 PREVIEW_TIMEOUT 被同源之后实际 `readyState>=2`、不在 seeking、且无 MediaError 的状态清除**。不重载、不自动重试、不自动续播；恢复后保留“预览已就绪”和诊断入口，用户仍停在原位置。真实读取/解码错误和播放拒绝继续要求明确处理。新增回归确认超时→迟到 seeked/decoded→ready 全程只有原来一次 load、没有 play；这项修复针对旧错误覆盖，并未宣称底层延迟原因已经查明。

该候选还增加“刷新诊断”：从实际元素实时读取 visibility/focus、seeking/paused、buffered/seekable、video 尺寸、decoded/drop/quality、ready/network/error、当前与目标位置、源匹配结果。最多保留 32 条含相对毫秒及代际的媒体事件；不保存环境、库路径、源 URL 或设备标识。根代理将重新打包，通过原生事件时间判定加载、定位或首帧在哪个阶段等待。诊断候选的原生结果应以之后的根代理报告为准。

### 候选 03 的实时原生状态与候选 04 的手动对照

候选 03 在访达冷启动后仍失败，并非只等了 8 秒：根代理在超过 60 秒后刷新诊断，仍为 `ready1 / network1 / seeking=true / paused=true`、当前与目标均 0、`buffered/seekable=[0,4]`、画面尺寸 640×360、已解码帧数及 totalVideoFrames 均 0、MediaError 为 null。页面始终 visible，故障快照 focused=false；按刷新后 focused=true，仍没有解码首帧。首段为 2×、素材含 AAC，但首轮不带变速的导入也曾失败，因此尚不能将倍速认定为唯一原因。

真实事件时间为：source-load 0.4ms，emptied 106ms，loadstart 110.5ms，progress/suspend 118.1ms，loadedmetadata 121.7ms，同刻 seek-request，8002.5ms 超时；没有收到所监听的 seeked/loadeddata。[实时诊断](artifacts/v05-20261018/40-wj-candidate03-live-diagnostic.ax.txt)、[完整事件尾截图](artifacts/v05-20261018/44-wj-native-event-tail-visible.jpg)。03 未注册原生 seeking 事件观察，因此不能依据日志缺少 seeking 推断它未触发；元素的 `seeking=true` 是实时读取的事实。证据将等待点缩至已取得全部缓冲及元数据、但暂停定位尚未完成首帧的路径；底层为什么停在该路径仍未知，不能由此归咎硬件或网络。

候选 04（`0.5.0-preview-diagnostics-4`）增加仅由用户点击的“请求首帧（静音）”对照：在原元素/同一源代际内最多 5 秒调用视频 muted play，观察实际 decoded/非 seeking 后还原最新目标并暂停；不启动独立音频，不推进工程时钟，不自动重载，不自动启用该策略。源变更、销毁、失败或截止会取消操作并释放监听/计时器，迟到播放 Promise 不得覆盖新代际。它是用于根代理原生单击验证的实验入口，尚未证明能修复冷启动。事件及指标改为逐条 DOM 行，避免单个 AX 文本节点被截断；增加 AudioContext/音频图构造开始/结束及耗时，恢复提示缩为可关闭小条。冻结源及 15 项控制器通过记录见 [候选 04 收据](artifacts/v05-20261018/preview-diagnosis/preview-diagnostics4-source.json)。

### 首帧实验失败与 WebAudio 路径的因果对照

根代理在真实原生 04 只点击一次静音首帧请求：49579.2ms 开始，随后 waiting、paused=false、ready1、seeking=true；5002ms 后仍 decoded0。该实验失败，最终源码已删除入口及实现，不自动调用 play 暖机。04 同时显示 AudioContext 构造约 96ms、source/connect 各少于 .3ms，排除了很长同步初始化作为那次超时的直接解释；但 Context 状态 running、currentTime 在一分钟后仍为 0，提示需要检查音频输出路径，而非继续猜测 GPU。

随后用 **实际已安装候选 04 的 UI 资源**、同一个原生导入 AAC 文件，四次独立隐藏 Electron 进程/临时 profile/内存工程 API，均默认 backgroundThrottling、0 秒暂停、初速 2×；通过 CDP Media 域收集播放器管线及解码器，不写用户资料库、不操作主 GUI：

| 对照 | 结果 |
| --- | --- |
| AAC、hasAudio=true、独立 audio + 预建 WebAudio | video 在 9.4s 仍 ready1/seeking/decoded0，PREVIEW_TIMEOUT；audio ready4；Context running/time0 |
| 相同 AAC 字节、hasAudio=false、仅视频 | loadeddata 301ms，红帧、ready4/decoded4 |
| `-an -c:v copy` 副本 | loadeddata 251.6ms，红帧、ready4/decoded4 |
| 相同 AAC、hasAudio=true、仍双元素，仅测试注入屏蔽 AudioContext API，走现有原生音频 fallback | video loadeddata331.7ms，双元素 ready4，红帧/decoded4 |

失败的 video 管线停在 CDP `kStarting`，只有 demux 的音视频配置，未选择解码器；同会话 audio 管线可选择 FFmpegAudioDecoder 与 VideoToolboxVideoDecoder。第四项仍存在两套视频解码器而正常，因此 AAC 容器字节、双媒体元素或双 VideoToolbox 不是故障的充分条件。这将可控的程序边界缩至预建 WebAudio 路径，但尚未解释 Chromium/音频设备内部的等待机制。[四项结果与哈希](artifacts/v05-20261018/preview-diagnosis/bundled-audio-matrix-summary.json)、[可重跑脚本](artifacts/v05-20261018/preview-diagnosis/bundled-audio-matrix.cjs)。首轮 CDP 在空 WebContents 尚未启动时卡住，已明确记作工具故障，并以先加载 about:blank 的修正脚本重跑，不计作产品失败。

也验证了“只推迟 WebAudio”方案：artifact 原型在暂停时不创建 Context，首帧正常；首次播放才创建 Context/图。连续两次在 `new AudioContext` 开始后无结束，渲染器 JS 不再返回，直到测试 20 秒截止；第二次 CDP console 只留下 `LAZY AUDIO start ... new AudioContext`。所以未把 lazy 图方案集成进生产。退出时 Chromium 报 `MojoAudioOutputIPC failed to acquire factory`，该日志支持继续调查音频工厂，不能据此宣称某驱动损坏。[lazy 原型结果](artifacts/v05-20261018/preview-diagnosis/bundled-audio-aac-with-audio-play-lazy-result.json)。根代理只读发现系统默认输出为 ToDesk Virtual Audio；输出设备的因果比较和最终原生验收由根代理另记，此报告没有把设备名当作故障结论。

### 最终生产改动与当前验证

`0.5.0-preview-diagnostics-5` 从 PlaybackMedia **彻底删除 WebAudio/图初始化、音频图资源和失败首帧实验**。浏览器原生媒体元素负责输出，控制器仍统一拥有 source、位置、速率、播放意图与销毁；原音量/fade owner 继续计算完整 gain，native volume 边界只允许 0–1，诊断同时保留 requestedVolume，避免把预览能力误作工程值。音频面板明确“预览音量最高 100%；导出按设置音量”，工程/导出仍保存 1.5 等完整音量。没有创建新 AudioContext 来探测设备，也没有后台 proxy 或改写原素材。

当前冻结源完整 App 的生产构建隔离检查通过，13.434 秒：实际 AAC 初始 0 秒红帧；UI 播放/暂停；前段 2×、越段后 0.5×且已显示绿色；0.25、1 的音量实读准确，1.5 时预览 1、有提示，内存保存仍为 1.5 和两个速度段。全过程没有构造 AudioContext；暂停时双元素落在同一 source 时间。该播放检查显式 `backgroundThrottling:false`，让隐藏窗口 rAF 运作，属于源码生产集成而非原生 GUI。捕获 `HTMLAudio.captureStream→MediaRecorder` 成功，保留 25%/100% 两段 webm；尚未由此证明物理扬声器听感或 native volume 对捕获流的 DSP 衰减。[当前 App 完整结果](artifacts/v05-20261018/preview-diagnosis/bundled-audio-aac-with-audio-play-final-result.json)、[最终冻结源与验证收据](artifacts/v05-20261018/preview-diagnosis/preview-diagnostics5-source.json)。

## 结构修复与操作入口

`src/preview-controller.mjs` 成为单一媒体元素的所有者，统一管理 source、最新目标时间、事件监听、seek、播放请求和释放。更换源或手动重载增加代际；旧播放 Promise 成功/失败不能覆盖新源或新的暂停请求。收到 metadata/decoded/seeked 时使用最新目标，先确认可用帧与 seek 完成再播放；变速位置与当前段速率均消费 `shared/model.mjs` 的 `sourceTimeAt` / `sourceRateAt`，保持音高。

就绪、seek、播放等待及错误不再全部静默。加载超过 500ms 显示准备/定位状态；等待超过 8 秒进入明确错误，**不自动反复重载**。解码、读取、定位和播放拒绝显示原因码、故障时 ready/network/位置与当前素材名，提供“重新加载预览”。播放器选项中还常驻同一入口，即使没有媒体错误码，用户也能明确重载当前预览。重载保留工程和当前目标，不保存用户环境或自动记录媒体路径。

元素接近素材结尾且浏览器已 ended 时，保持最后解码画面，避免调用 `play()` 隐式回到首帧；明确向前/向后定位仍生效。解除挂载会移除监听、暂停、清除 source 并释放解码请求。可见状态恢复会重新检查就绪，不无限重试；App 隐藏时暂停播放，长 rAF 间隔也不作为有效播放时间加到片尾。这些为明确边界修复，不称为已重现 macOS 锁屏内部故障。

## 全体就绪门禁的第二个实测问题

仅暂停 App 时间、仍允许快素材自行播放，会在慢素材加载时让音频抢跑。独立完整 App 测试用每次视频 HTTP 读取延迟 1 秒、WAV 立即返回：单阶段版本音频约 305ms 开始，随后约 1097/1362/1629/1895ms 反复定位 0 秒重播；视频约 2235ms 才开始，App 时间仍为 0。

修复为两个阶段：当前全部音视频可用后才统一许可播放；starting 状态保留许可，避免启动/暂停反馈循环；App 时钟仅在全部 ready/playing 后推进。unknown、loading、seeking、buffering 阶段全体保留当前位置，错误会暂停总播放。短暂网络 stalled 在已有充分缓冲时不误判为缺帧。

[单阶段失败及事件时间](artifacts/v05-20261018/preview-diagnosis/app-one-phase-failure.json)、[固定旧 bundle](artifacts/v05-20261018/preview-diagnosis/app-one-phase-baseline.js)、[最终完整 App 测试结果](artifacts/v05-20261018/preview-diagnosis/app-gate-result.json)。测试窗口使用 `backgroundThrottling:false` 以在隐藏状态驱动 rAF；这是隔离测试设置，不是产品设置或原生窗口/锁屏验证。

## 验证清单

- `node --test tests/preview-controller.test.mjs`：最终诊断 05 源码 13 项通过，108.9ms。覆盖晚 metadata 与最新位置、源切换、过期播放 Promise、快速定位与尾帧、明确错误/人工恢复、权限拒绝/seek 异常/有界超时、变速及释放、可见恢复与充分缓冲、ended 不回首帧、metadata-only 的初始 0 秒定位、迟到就绪清除超时、32 条日志/实时指标边界及 native 音量的 .25/1/1.5 与静音。诊断 04 曾有的 3 项首帧实验测试随失败实现移除，仍保留当时收据，不把其测试计入最终功能。当前完整 App 生产构建也通过，未以编译检查冒充打包或原生验证。
- 同 Electron 生产组件：首次定位版本（诊断 03 之前）14 个实际媒体检查通过。包含暂停 0 秒首帧、原始 source-only 对照、16 次快速切换/定位、播放暂停、2× 与分段源时钟、转场尾帧、ended 尾帧、真实 404 错误及同目标手动恢复。见 `preview-diagnosis/new-preview-result.json`；不把隐藏 DOM 事件称为原生操作，也不将其结果绑定到之后的诊断/迟到恢复修改。
- 完整 App：慢源门禁、同步开始、全局重载、错误暂停、手动恢复；关键帧/分段变速真实 React 控件及多图层转场截图见下方最终数据。

首次定位版本的完整 App 脚本通过 19 个检查点及 UI 保存断言，墙钟 46.820 秒；组件脚本 14 个检查点 2.870 秒。包含错误状态再次按播放仍暂停、清除该测试 origin 的 lastProject 后打开已存工程从 0 开始、全局重载真实触发两个元素的 metadata/seek。隐藏窗口的媒体初始化存在等待波动，这些墙钟不说明原生启动性能；之后实际原生仍失败的记录与诊断 03 变更已单独保留，不能称该脚本验证了最终原生修复。

通过真实 React 控件添加两个变换关键帧（X=40 / X=120）、定位前后关键帧、设置缓入缓出、输入未完成的负号后将焦点移到关键帧按钮并验证新位置显示；切换分段变速、添加两段、设置 0.5× / 2×。内存保存实际保留 2 秒源区间与 2.5 秒输出时长、两个关键帧及缓动。[合成工程的已存 JSON](artifacts/v05-20261018/preview-diagnosis/app-ui-saved-project.json)。这是 DOM 驱动的界面集成，不是原生按键/文件保存验收。

四种转场在不透明绿色下层、蓝→红转场层、透明网格上层同时存在时，实际截取完整 App PNG 并测量三处透明网格区域。原生截图含 Skia ICC，不能直接把解码 RGB 当作截图 RGB；先在同一 App、同一位置抓取非转场蓝/红控制帧。测得蓝 `28,34,246`、红 `228,62,34`：叠化正中三处均 `128,48,140`，精确为控制色均值；淡黑三处均 `0,0,0`；向左擦除为左蓝右红，向右擦除为左红右蓝，均匹配相应非转场控制色。这个相对检查验证该多层合成，不声明所有像素、色彩管理或剪映算法完全相同。

[四转场实际 PNG 与校准数据](artifacts/v05-20261018/preview-diagnosis/app-composition-pixels.json)、[像素分析脚本](artifacts/v05-20261018/preview-diagnosis/analyze-composition.py)、[最终验证摘要及结果哈希](artifacts/v05-20261018/preview-diagnosis/preview-final-summary.json)、[首次定位版本的历史源哈希](artifacts/v05-20261018/preview-diagnosis/preview-frozen-source.json)。曾保留的失败记录包含生产问题及测试自身的错误假设：未支持 Range 的早期复现服务、把截图 RGB 当输入 RGB、假定重载必重新发 HTTP、以及隐藏窗口未处理 mock 页的未保存关闭保护；最终脚本已按对应真实边界修正，不将这些测试假设归为产品缺陷。

自动测试未覆盖全部编码、所有 macOS/Intel、长期睡眠唤醒、GPU 故障、长素材或最坏多轨负载。黑色画面本身可能是有效内容，因此没有把“黑像素”作为自动错误或重载条件。测试墙钟记录只说明该脚本的执行，未测 CPU、进程族峰值内存或 token，不作为性能比较。

## 最终原生结果与声音输出对照

### 同一旧包的扬声器对照及尚未恢复的设备状态

对照前系统默认输出为 **ToDesk Virtual Audio，50%、未静音**。用户单独批准临时切到 MacBook Pro 扬声器并恢复；根代理通过 System Settings 实际切换。扬声器沿用该设备既有的 **69%、未静音**，没有调整音量、权限或其他路由；提示音输出仍为外置耳机。

切换后，仍带 eager WebAudio 的同一候选 04 旧包（SHA-256 `5710c4bfc73d26023aff367ea44b65db0c71f05b0f4cd98b3bb44108f074cbbf`）经访达冷启动，0 秒立即显示红色首帧。[55 号旧包扬声器冷启动](artifacts/v05-20261018/55-wj-old-candidate04-speakers-cold-zero.jpg)、[旧包精确收据](artifacts/v05-20261018/candidate04-install-receipt.json)。这支持输出设备与初始化路径组合有关；它既不证明 ToDesk 驱动损坏，也不证明应用原先的 WebAudio 初始化在所有设备下都必然失败。

**恢复尚未完成。** 切换后观察到 ToDesk 已从所有输出设备列表消失；System Profiler 当时只列出 C32JG5x、外置耳机、MacBook Pro 扬声器和输入麦克风，仍未出现 ToDesk，消失原因未查明。根代理已请用户选择恢复 ToDesk 连接、改用耳机或暂留扬声器，截至本报告更新尚未收到选择。不能将授权恢复等同于实际已经恢复，也没有自行改动其他系统设备或权限。

### 最终 05 包的真实工作流

最终包 SHA-256 为 `8133732fb0083025492aa493ed85dd7f0fc2000b941a7f51cac80de9a7e38216`，已移除 WebAudio 与失败暖机实验；安装收据绑定该包并确认冻结源未变。**下面原生验收均在扬声器输出下，最终包尚未在 ToDesk 输出下做原生验收。**

- 访达冷启动，0 秒首帧正常：[56](artifacts/v05-20261018/56-wj-final05-finder-cold-zero.jpg)。
- 原生导入 PNG 并保存工程：[57](artifacts/v05-20261018/57-wj-final05-native-import-saved.jpg)；正常退出重开后仍从 0 秒正确显示：[58](artifacts/v05-20261018/58-wj-final05-reopened-zero.jpg)。
- 重开后 6 秒处的 75% 缩放、X=60 关键帧与字幕可见：[59](artifacts/v05-20261018/59-wj-final05-reopened-keyframe-midpoint.jpg)；2× / 0.5× 分段设置保留：[60](artifacts/v05-20261018/60-wj-final05-reopened-step-speed.jpg)。
- 从 0 秒实际播放到 `00:00:01:12`，已显示绿色段：[61](artifacts/v05-20261018/61-wj-final05-play-from-zero.jpg)。
- 原生新导出任务 `1f1283f0-6881-495f-a7c3-8a981f5e16dc`，通过 GUI Save As 保存 720P/30fps、8 秒 MP4；独立 oracle **21/21 通过**，覆盖时钟/帧、分段变速、关键帧、转场、动画、字幕与混音。文件与该任务输出逐字节一致，SHA-256 `14cad198c091c4defce95fcf2c939a5f436810919be7d99a6fccc7fdb4ac220d`，见 [最终原生成片报告](artifacts/v05-20261018/final-native-analysis/RESULT.md)。最后两帧为画面完全滑出后的预期黑画面，未误报为漏帧。

对应 [最终安装收据](artifacts/v05-20261018/final-install-receipt.json)、[GUI 验收](V05-GUI-ACCEPTANCE.md) 与 [发布验证](V05-RELEASE-VALIDATION.md)。这些验证覆盖本机合成工程工作流，不扩展为全部源编码、所有输出设备、长期睡眠或大项目负载承诺。

### 逻辑预览录音的实测边界

隔离 App 的 25% 与 100% 两段 `HTMLAudio.captureStream→MediaRecorder` 录音经独立 FFmpeg/频谱分析，各解码 1.44 秒、69,120 样本；前段峰值 440Hz、后段 880Hz，约 1 秒切换，220/1760Hz 仅为低噪声，支持流非静音以及 2×→0.5× 时保持音高。两段稳定窗口 RMS 比约为 **1.00013 / 0.99845**，没有观察到 25% 振幅；该逻辑捕获可能位于 native volume 应用之前，不能用它证明 0.25 的输出衰减，更不能证明物理扬声器实际听感。DOM 中 `.25 / 1` 的准确值、`1.5→1` 预览上限与完整工程保存属于另一组已通过的界面/API 断言。[完整 DSP 数据](artifacts/v05-20261018/preview-diagnosis/preview-capture-dsp-analysis.json)。
