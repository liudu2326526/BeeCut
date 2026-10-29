# 当前验证入口 · 微剪 1.0

2026-10-19，最终候选3完成本机原生桌面闭环。源码137/137、111执行/构建输入冻结；ZIP/发布/安装750项内容、权限和链接相同，实际严格签名通过。Finder双击、新素材原生导入、画面和音频跨轨拖动、素材拖入、播放中音量键编辑、保存退出重开、WAV生成/播放/另存、1080P30 MP4导出/另存及成片播放/暂停/CmdW完成。默认输出最终仍为MacBook Pro扬声器。详见[1.0交付](V10-RELEASE-VALIDATION.md)、[原生记录](V10-GUI-ACCEPTANCE.md)及[包与Library审计](artifacts/v10-20261019/package-audit/PACKAGE-AUDIT.md)。

- 原生实际AudioWorklet录音含暂停恢复，从0完整860,800帧，0 underrun/overrun；与WAV全部1,721,600个声道样本值最大差`1.52587890625e-5`。原冻结WAV/AAC比较164/164，完整538帧PTS及全部缩小帧可见性4/4。
- 独立补充原运行191/199，8项音乐跳变污染脉冲拟合的负结果保留；事后独立方法修复48/48，原模板/门限不变，不能改称预冻199/199。其余主音高、源标记、解析立体声增益及完整时长均通过，详见发布报告的范围说明。
- 旧22工程字节不变，79旧素材记录/顺序保留，备份203文件一致、work为空；12新素材、2新工程和2新成片单列。原四剪映参考草稿262个已哈希文件未变化。
- 草稿导入仅为[已确认需求](JIANYING-DRAFT-COMPATIBILITY-REQUIREMENTS.md)，1.0未实现剪映格式兼容。数字tap不证明物理扬声器；有限夹具不代表所有设备、编码或最坏长工程通过。

## 历史 0.9

2026-10-19，最终Apple Silicon安装版完成真实桌面和成片验收。源码**118/118**、92输入冻结、390项ZIP/release/installed一致、严格ad-hoc签名；Finder双击、系统导入、四音轨/画面跨轨移动与Undo、音量关键帧/声像/滤波/回声、WAV真实播放/过期/重生成/另存、正常退出重开、1080P30/high视频导出/另存/成片播放/暂停/CmdW均完成。旧21工程/68素材保留，无意外变更，新增11媒体，work为空。详见 [最终交付](V09-RELEASE-VALIDATION.md)、[原生操作](V09-GUI-ACCEPTANCE.md)、[独立资料审计](artifacts/v09-20261019/delivery-audit-library-final-v09.json)。

- 最终ZIP `release/微剪-0.9.0-mac-arm64.zip`，162,116,583字节，SHA `9abd0efa7c6df57179409d619238e41253f9c441a43ade62812b4bd163d0f176`。[独立包/安装/源审计](artifacts/v09-20261019/package-audit/PACKAGE-AUDIT.md)。当前本地个人使用、ad-hoc未公证、arm64/macOS13+边界保留。
- 最终原生MP4＋WAV独立 **1949/1949**：538全PTS、66抽帧/1411RGB/563预定排除、15源条码、8字幕区域（非OCR）；每输出14严格音高窗/108音频分量窗/16echo起点/59连续性格点窗。音高最大误差MP4 .008967Hz/WAV .008991Hz；回声采样偏差0，门限和脚本在输出前冻结。WAV先行247/247属于总数子集，不相加。[结果](artifacts/v09-20261019/final-native-analysis/RESULT.md)、[精确覆盖和成本](artifacts/v09-20261019/final-native-analysis/COVERAGE-AND-PERFORMANCE.md)。
- 原生独听WAV另 **148/148**，完整1,721,600声道样本最大误1.526e−5，其他音轨被抑制。[实际PCM路由](artifacts/v09-20261019/native-solo-analysis.md)。不称物理扬声器听感。
- 四音轨与DSP/key实际API、128键900秒WAV24.025秒/43.2M采样帧、64短片全音效4.202秒；不是900秒1080P视频或所有最坏组合。[合同与资源](artifacts/v09-20261019/BACKEND-CONTRACT-AND-VALIDATION.md)。16转场/12动画，实际alpha/帧边界/原声不变验证与单秒1080P19–30秒成本：[效果](artifacts/v09-20261019/effects/RESULT.md)。
- 隔离完整App21/21、相关Node22/22；native发现多audio诊断挤占画面后，真实三404对照4/4，修复后重新全118门禁和打包。[UI](artifacts/v09-20261019/app-ui/RESULT.md)、[诊断布局](artifacts/v09-20261019/audio-diagnostics-layout/RESULT.md)。预听UI矩阵模拟完成不冒充真实DSP。
- 实操剪映音量键/平衡/回音/第二音轨和M/S可见状态，2次真实参考导出；原4草稿236哈希不变。剪映−50平衡非微剪linear pan等价，M/S参考仅可见状态。[本轮参考](V09-JIANYING-REFERENCE.md)。最终系统默认输出已再次确认MacBook Pro扬声器，未来外部切换不由编辑器保证。

---

# 历史验证入口 · 微剪 0.8

2026-10-18，最终 Apple Silicon 安装版验收通过。源码 101/101、84 个源码/锁定输入冻结、ZIP/release/installed 390 项一致、严格 ad-hoc 验签；原生 Finder 双击、七素材系统导入、素材卡拖入及同轨/跨轨移动、中文双行字幕、原声分离/分贝/静音/非线性淡化、真实保调 WAV 播放/旧版提示/重生成/另存、保存正常退出重开、1080P30/high MP4 导出/系统另存/实际播放与 Command-W 均完成。旧 20 工程字节完全相同、61 旧素材记录和二进制保留，新增 7 条，work 为空。见 [最终交付](V08-RELEASE-VALIDATION.md)、[原生验收](V08-GUI-ACCEPTANCE.md)、[资料保留审计](artifacts/v08-20261018/DELIVERY-AUDIT.md)。

- 最终 ZIP `release/微剪-0.8.0-mac-arm64.zip`，162,108,876 B，SHA-256 `2569b6f746a851e0d5d558299ac13839d65e8411fe3c0840ca605b73699e5a5c`。[包](release/package-verification-0.8.0.json) 与 [安装](artifacts/v08-20261018/installed-release-equivalence.json) 分别核对。
- 平滑曲线：整段 Rubber Band 4.0.0 R3/WindowShort/source-to-output sample map 取代 75ms 重启 atempo。25/25 曲线与生命周期专项；稳态音高阈值实现前冻结为 max(.5Hz,.1%)。4 秒同源 440Hz 新版 440.00244Hz，旧版 444.763Hz；900 秒 WAV 预处理 17.281 秒，精确 43,200,000 样本帧，多音调最大误差 .0879Hz，非本版900秒1080P验收。[后端与范围](artifacts/v08-20261018/BACKEND-CONTRACT-AND-VALIDATION.md)。
- 5 新转场/2 类复合动画，合计 13/10，真实导出 4/4，18,154 转场像素与 7,340 动画像素探针；视觉转场前后完整 PCM 哈希不变。[效果](artifacts/v08-20261018/effects/RESULT.md)。音频专项 3/3、真实 WAV/MP4 混音 1/1，隔离完整 UI 24/24；其 mock 预听不冒充原生或真实音频，见 [UI 范围](artifacts/v08-20261018/app-ui/RESULT.md)。
- 最终原生 MP4+WAV 独立 **2322/2322**：全 1969 decoded PTS、102 个抽样画面/1471 像素/503 预声明排除、48 源条码、每输出 28 严格音高窗/12 源标记/299 源格点连续性窗、增益/淡化/尾音及 8 个非 OCR 字幕区域。最大像素误差 5.7506；MP4/WAV 音高最大 .218589/.218632Hz；标记 13.6185/13.6165ms。计划在导出前冻结，最终输出后没有放宽阈值或删除探针。[结果](artifacts/v08-20261018/final-native-analysis/RESULT.md)、[精确覆盖](artifacts/v08-20261018/final-native-analysis/COVERAGE-AND-PERFORMANCE.md)。
- 实际剪映仅操作合成草稿，−6dB/.2/.3s 淡化和免费“向左”转场均原生导出；旧四工程 236 个已哈希文件不变。[参考](V08-JIANYING-REFERENCE.md)。保持 MacBook Pro 扬声器；有限音高夹具通过不代表物理听感或所有编码/机器、长4K/最坏组合、完整剪映算法兼容。ad-hoc/未公证/nonfree 本机自用边界保留。

---

# 0.7 验证入口（历史）

2026-10-18，最终候选2本机交付通过。源码90/90、71文件冻结、ZIP/release/installed384项一致及严格ad-hoc验签。原生Finder双击、七素材导入、字幕编辑、素材拖入与水平/跨轨移动、保存后正常退出重开、1080P/30fps/高画质导出及系统另存、真实成片预览均已完成。包身份、资源边界和失败历史见 [本版交付](V07-RELEASE-VALIDATION.md)，操作见 [原生验收](V07-GUI-ACCEPTANCE.md)。源码、API/FFmpeg、隔离Electron、签名包与实际原生操作分别记录。

- 有界长曲线音频：取消512总块/约38.4秒限制，保留900秒工程、3600秒曲线源区间、128节点及8倍/源秒支持域，每批最多128块。真实隔离API完成60秒源/59.608秒输出和900秒边界输出；后端 targeted21/21及另一次长导出1/1通过。[合同、资源与限制](artifacts/v07-20261018/BACKEND-CONTRACT-AND-VALIDATION.md)。900秒实测不代表多曲线/长4K最坏组合，临时磁盘随源选区和输出时长增长。
- 音频限制保留：60秒fixture的探索性±5Hz诊断有失败，局部1秒复核440→445.31Hz，约+1.21%。这是当前有限分块/WSOLA近似误差，不改门限包装为精确保调通过；时长、有限marker、有声尾与跨批相邻样本检查另行记录。[原始复核](artifacts/v07-20261018/boundary-new-60-first/pitch-one-second-probe.json)。
- 真实波形：专项6/6，WAV/AAC短源峰值各200bins与独立PCM量化误差0；两份60秒fixture各6000bins全部比较误差0；隔离Timeline/API检查212个DOM列样本及可信输入透传。API保留原幅度峰值，显示按整源最大峰值固定归一，不含音量/淡入出/效果。[波形范围与成本](artifacts/v07-20261018/waveform/RESULT.md)。隔离数值检查与最终安装版ready波形GUI分别核对，详见本轮原生截图与报告。
- 八种转场、八种入出动画：旧真实导出回归10/10，新API/独立像素2/2，隔离完整App13项及1680/1060布局、生产构建通过。新转场检查463个24/30fps输出帧、4043个有效色彩探针，124个8px边界探针明确跳过；新动画5792个几何探针。[效果报告](artifacts/v07-20261018/EFFECTS-CONTRACT-AND-VALIDATION.md)。不声称所有预览像素或剪映专有算法等价。
- 最终原生成片独立oracle1642/1642通过：全1969 decoded PTS、102个画面抽样帧、1465像素（509预定排除）、48源帧条码、34音调窗、6跨批接缝、6配乐增益窗、8字幕区域。最大像素误差4，最大源帧时间误差32.637ms。候选1暴露真实非整帧动画相位问题，修复正常首尾/透明度/快照/帧覆盖owner后，以原28RGB/2源帧等门限重跑通过。另保留oracle遗漏源角标的模型纠正，不隐藏原失败。[最终检查](artifacts/v07-20261018/final-native-analysis-candidate2/RESULT.md)、[精确覆盖](artifacts/v07-20261018/final-native-analysis-candidate2/COVERAGE-AND-PERFORMANCE.md)、[修复原因](artifacts/v07-20261018/CANDIDATE1-DIAGNOSIS-AND-CANDIDATE2-FIX.md)。
- HTMLAudio预览最高100%，更高工程增益用于导出；仅本机AppleSilicon/macOS13+、ad-hoc签名、未公证、nonfree FFmpeg本机自用。保持用户选择的MacBook Pro扬声器，不新增物理听感通过声明。

---

# 0.6 验证入口（历史）

2026-10-18，最终 Apple Silicon 安装版。身份、范围和限制见 [V06-RELEASE-VALIDATION.md](V06-RELEASE-VALIDATION.md)，真实原生操作见 [V06-GUI-ACCEPTANCE.md](V06-GUI-ACCEPTANCE.md)。

- 最终 ZIP：`release/微剪-0.6.0-mac-arm64.zip`，161,632,804 字节，SHA-256 `d4e027118ab8467e9c4e6b0cd9e678b2de8d6139715cac4157c7e345faa7eeb9`。ZIP/release/installed 384 条文件与链接内容一致，严格深度 ad-hoc 验签通过，未公证。
- 冻结源码回归 62/62，10.746850 秒；隔离生产 UI 集成时间线 36 项、曲线/关键帧 15 项。专项真实 FFmpeg 输出 38 份，记录见 [后端报告](artifacts/v06-20261018/BACKEND-CONTRACT-AND-VALIDATION.md)。
- 最终原生流程：Finder 双击首帧、系统导入、素材拖入指定轨道、水平/跨轨移动、撤销、碰撞拒绝、平滑曲线节点拖动、保存后正常退出重开、播放、1080P/30fps 导出及原生另存全部完成。重开 7 素材/6 片段/2 字幕及曲线、关键帧和效果除 updatedAt 外精确相同。
- 最终成片 482,966 字节，SHA-256 `711c82e2dee46873ec8b27d9126e36ccf09737c327d1015b062a509852ec9556`，路径 `~/Movies/微剪导出/weijian-v06-final-20261018.mp4`。独立分析 125/125，通过 46 个不同画面帧的探针、10 个字幕区域边界与13个数字音调窗口；323 为元数据帧数，未独立逐帧比较全部 PTS/画面。字幕非 OCR，音调非物理扬声器或配乐增益校准。[分析与边界](artifacts/v06-20261018/final-native-analysis/COVERAGE-AND-PERFORMANCE.md)。
- 旧18工程内容保留：17字节相同，1个只改变 updatedAt；旧40媒体、30缩略图、22成片字节相同。[审计](artifacts/v06-20261018/DELIVERY-AUDIT.md)。
- 默认输出按用户要求保持 MacBook Pro 扬声器。0.6当时的平滑曲线音频使用近似、最多约38.4秒非平坦输出/512处理块（0.7已取消总块数限制）；不声称全剪映功能、专有算法或所有机器/编码已覆盖。视觉结果及差异见 [design-qa.md](design-qa.md)。

---

# 0.5 验证入口（历史）

2026-10-18，Apple Silicon 本机最终安装版。完整证据与包身份见 [V05-RELEASE-VALIDATION.md](V05-RELEASE-VALIDATION.md) 和 [V05-GUI-ACCEPTANCE.md](V05-GUI-ACCEPTANCE.md)；以下首版记录保留为历史，不作为新版验收结果。

- 最终源码 `npm run test:all`：49/49，0失败/跳过，日志 [source-tests.log](artifacts/v05-20261018/source-tests.log)。
- 原生实际操作：Finder 双击0秒首帧、PNG导入并保存5素材工程、正常退出后Finder重开0秒、关键帧5/6/7秒缩放100%/75%/50%与X=0/60/120、2×/.5×分段保留、实际播放和绿色字幕。
- 原生导出并另存：720P/30fps/8秒，`~/Movies/微剪导出/weijian-v05-final-20261018.mp4`，187,536字节，SHA-256 `14cad198c091c4defce95fcf2c939a5f436810919be7d99a6fccc7fdb4ac220d`。独立检查21/21，240帧，6,428个空间探针通过、52个边界探针跳过、0失败。准确规则和所有结果由最终发布报告记录。
- 最终预览仅使用 HTMLAudio，正常0–100%音量预览；工程保留0–200%设置，超过100%的增益仅导出。分段速度是阶梯恒速，不是平滑曲线。旧候选 WebAudio 导致的原生冷启动失败及对照保留在 [V05-PREVIEW-DIAGNOSIS.md](V05-PREVIEW-DIAGNOSIS.md)。

验收限本机短 H.264/AAC、WAV、PNG 工程，不证明所有编码、macOS/GPU/音频设备、长4K工程或剪映算法等价。系统声音设备的排查与恢复另行处理，不属于上述应用结果。

---

# 0.1 首版验证记录（历史）

Executed locally on 2026-10-16 (Asia/Shanghai), macOS Apple Silicon, Node.js v25.8.0 / npm 11.11.0. This is an independently implemented editor, without REA integration or claims about execution of original剪映 code.

## Executed checks

- `npm run build`: passed, producing the client and retained starter packaging files.
- `npm run test:editor`: 5 checks passed: one real HTTP/media integration workflow and four domain checks. The complete run took 1379 ms. It covers input preservation, source offsets/speed, image splitting, stable project reads, literal Chinese/special-character subtitles, H.264/AAC output, pixel/time order, source-audio/music frequency contributions, Range downloads, invalid input rejection and cancellation cleanup.
- `npm run test:sites`: 4 static packaging checks passed. These do not establish that the local media API can be deployed as a static website.
- Browser workflow/visual verification: `design-qa.md`. Playback returned paused=false, readyState=4 and decoded dimensions 1280 × 720. End-frame behavior was checked again after its final UI adjustment. Browser warning/error query returned no entries.
- At 1440 × 900 and 1024 × 768, document width equaled viewport width; the 1024 layout correction was captured and visually reviewed.
- Original REA checkout remained clean: `git status --short` and `git diff --stat` returned no changes.

## Browser-produced acceptance movie

Created `验收 · 山海剪辑` through the interface: imported two 15-second MP4s and one 30-second WAV; set the first source in-point to 1 second, speed to 1.5× and timeline duration to 6 seconds; split at 3 seconds, preserving source offsets 1 and 5.5. Placed the second clip at 6 seconds for 6 seconds. Trimmed music to 12 seconds at 35% volume. Added literal two-line Chinese text `你好，山海\n把每一刻，剪成故事` for the first 3 seconds. Saved, reopened, exported and downloaded the result through the browser.

Verified result: `artifacts/微剪-验收成片.mp4`, a copy of completed export `697ae3f9-3848-42d4-a25f-666c3c95cc99.mp4`: 1,498,192 bytes, 12.000000 seconds, H.264 1280 × 720 at 30/1 fps plus AAC stereo at 48 kHz. Download succeeded as `/Users/macbook/Downloads/验收 · 山海剪辑.mp4`. `artifacts/export-frame.png` was extracted and opened to confirm the landscape and both Chinese subtitle lines were burned in. A second export dialog offered a new render rather than the previous result.

Additional 30-second demo: `data/exports/9e9ff02a-8874-4191-bafe-89b82cc2e82f.mp4`, H.264 1280 × 720 / 30fps plus AAC stereo, 3,237,651 bytes. Its subtitle frame was also opened during backend verification.

## Limits

Checks cover generated short H.264/WAV/PNG media on this machine, not 15-minute stress workloads, every admitted codec, large batches, all browsers/hardware, color-management accuracy or mobile editing. Frequency analysis verifies mixing, not music composition quality. No comparative performance benchmark, process-family peak memory, CPU time or whole-task token measurement was performed.

The reference footage was unavailable as source media. Demo artwork is AI generated and audio synthesized locally; provenance is recorded in `public/demo/asset-prompts.md` and `scripts/create-demo.mjs`. Original native源码、私有引擎、云服务 and剪映草稿兼容 remain outside this implementation.
