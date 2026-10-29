# 微剪 0.4.0 发布与验收

当前状态：最终 `f46d47e8…` 安装包已完成本机原生保存重开、矩形/画面动画及叠化视频导出验收，独立安装包API六份真实输出通过。0.3的原生素材导入、SRT与完整基础流程也已补验通过。各构建的交互检查与最终包结果分开记录，详见 [V04-GUI-ACCEPTANCE.md](V04-GUI-ACCEPTANCE.md)。

2026-10-18，Apple Silicon macOS 本机。0.3 的原生素材导入、SRT、保存重开和视频导出已补验通过，见 [V03-RELEASE-VALIDATION.md](V03-RELEASE-VALIDATION.md#2026-10-18-原生界面补验通过)。本版在独立代码中增加叠化、渐显/渐隐和圆形/矩形蒙版；剪映的实际参考观察仍与微剪实现分开记录，不宣称完整复制。

## 最终发布文件

- 应用：[release/微剪.app](release/微剪.app)。
- ZIP：[微剪-0.4.0-mac-arm64.zip](release/微剪-0.4.0-mac-arm64.zip)，161,602,596 字节。
- SHA-256：`f46d47e8af7eff3d2d602c56788042e9f129e84030f62abd1839fa89e4296bc0`，另见同名 [.sha256](release/微剪-0.4.0-mac-arm64.zip.sha256)。
- 构建收据：[package-verification-0.4.0.json](release/package-verification-0.4.0.json)。
- 独立包核查：[independent-package-verification-0.4.0.json](release/independent-package-verification-0.4.0.json)。
- 操作说明：[FEATURE-GUIDE.md](FEATURE-GUIDE.md)、[使用说明-0.4.0.txt](release/使用说明-0.4.0.txt)；字段合同：[CONTRACT.md](CONTRACT.md)。

目标为 Apple Silicon arm64、macOS 13+；Electron 44.8.0 / 内置 Node 24.22.0。当前为 ad-hoc 临时签名，未 Developer ID 签名、未公证。FFmpeg 实际构建带 `--enable-nonfree`，仅供本机自用，不能作为对外分发包；实际构建参数、组件许可和演示素材来源随包提供。

## 新能力的独立合同

| 能力 | 本版行为与边界 |
| --- | --- |
| 叠化 | `transitionOut` 由前段拥有并绑定 `nextClipId`；同层紧邻两段，窗口居中于原接点，工程时长、原片段时序及音频切点不变。时长0.04–5秒，两侧半窗须能容纳，邻接窗口不能相互覆盖。 |
| 边缘延展 | 转场越过片段原时间时始终克隆首帧或末帧，不读取未用源余量；先按原段域做蒙版、变换和动画，再克隆。 |
| 透明混合 | 两侧先预乘 RGBA，再按时间线性混合，取消预乘后作为同一层覆盖下层；不是两个半透明画面依次普通叠加。 |
| 配对失效 | 客户端中央编辑路径调用共享纯函数 `reconcileTransitions`，移除不再紧邻、身份不匹配或时间不足的转场并提示；API坏输入仍拒绝，不静默修复。分割仅右片段保留原有出转场。 |
| 动画 | `animation:{in,out}` 为独立画面线性alpha渐变，秒数合计不超过片段时长；与原声 `fadeIn/fadeOut` 独立。分割保留外侧动画。 |
| 蒙版 | 圆形/椭圆与矩形；位置、宽高、顺时针旋转、羽化和反转。作用于适应后的项目画布、整体画面变换前，并乘入素材原有alpha。 |
| 羽化 | 0–200项目像素，Gaussian sigma=feather/3，模糊后再反转。FFmpeg在扩展黑域生成一次单色蒙版、三步gblur后裁切并复用；SVG预览采用Gaussian滤镜。二者边缘栅格化可能不同，不声称核算法或子像素完全一致。 |
| 旧工程 | 工程版本仍为1，遗漏新字段时补无动画/无蒙版/无转场默认。旧0.3不能保留本版字段，回退前应备份资料库。 |

导出位置按输出帧边界取整，CFR帧数为 `ceil(projectDuration*fps)`；原段内部按输出帧率采样；转场定格由共享 `clipPictureEdges` 指定最后一个仍位于片段内部的项目帧网格时刻，预览与导出均按项目时钟取这一张画面，不随导出帧率改变。本版在输出 `1/fps` 时间基上以整数 `N+startFrame` 生成PTS，覆盖区间也按整数输出帧身份判断，不再把 `frame/fps` 舍入成六位小数秒再转换回来。该生产边界同时处理源帧/克隆帧时钟、concat与绝对定位，避免接点重复前帧或转场末端出现单帧空洞；不通过修改混合权重掩盖时间错误。

上述语义属于微剪自己的可测实现，不表示与剪映的源余量处理、转场曲线、动画曲线、蒙版数值刻度或羽化内核精确等同。剪映观察与对照结果见 [JIANYING-FEATURE-MAP.md](JIANYING-FEATURE-MAP.md)。

## 已执行源码与真实成片检查

最终修复后重新冻结，实际执行 `npm run test:all`：**32项通过，0失败，0跳过**；测试runner报告10,252.93ms，完整命令墙钟10.533s。日志见 [source-tests-pre-freeze.log](artifacts/v04-20261018/source-tests-pre-freeze.log)，命令与测量范围见 [source-checks.json](artifacts/v04-20261018/source-checks.json)。`test:editor`已接入新增 [v04-render.test.mjs](tests/v04-render.test.mjs)，全套保留已有桌面runtime、资料库迁移、SRT、输入拒绝、取消清理和0.3像素/音频回归。

新增六项测试包含公开HTTP工作流和真实FFmpeg输出，不是模拟提供者或只检查过滤器字符串：

| 实际检查 | 观测结果 |
| --- | --- |
| 保存与重开 | 新动画、蒙版和转场所有字段保存重读一致；旧片段默认无动画/无蒙版/无转场。非法对象、数值、反转类型、音频蒙版、悬空/跨空隙/跨轨配对及重叠窗口返回400。 |
| 圆形与旋转矩形 | 蓝层中心/外部颜色符合椭圆范围；偏移矩形90°旋转后在预期位置可见。反转交换内外区域，原生透明PNG的原alpha继续保留。 |
| 羽化 | 绿底蓝层的矩形边界实际RGB `3,117,140`，内侧为蓝、外侧为绿；图像RGB没有被当作蒙版一起模糊。 |
| 画面渐变 | .8基础不透明度上渐显/中段/渐隐实际RGB `0,144,109` / `0,49,203` / `0,158,94`；原声音频对应RMS `0.07409/0.07423/0.07393`，表明画面动画不对声音施加包络。 |
| 透明叠化 | 半透明红与不透明蓝在绿底上的接点实际RGB `62,62,126`，接近预乘理论值64/64/128；第二接点为 `125,125,252`。测试阈值覆盖源/克隆交界的缺PTS重复帧问题。 |
| 图层与时长 | 4层同时合成，2/3层继续覆盖1层转场；6秒/180帧保持不变；上层结束后回到绿底 `0,252,0`，无末帧残留。 |
| 原声音频切点 | 转场中心为2秒。1.9秒440/880Hz投影幅度约 `0.03944/0.00000`，2.1秒为 `0.00000/0.03943`，说明视觉克隆不提前或延长原声。 |
| 不同帧率的定格 | 实际60fps源视频在最后一帧变色、叠加40ms渐隐；项目30→输出60和项目30→输出24的转场尾样本均为RGB `49,200,0`，项目60→输出30为 `0,228,23`，符合各自项目网格最后一帧及共享动画alpha。验证内容采样和短动画不会由输出fps重新选择。 |
| 转场窗口逐帧重连 | 逐帧解码30fps的180帧、24fps的144帧、60fps的360帧和29.97fps的180帧，所有帧颜色/叠化权重连续，无空洞或错位；首个普通入段重连帧98/79/197/97均为红色 `252,0,0`。 |
| 配对与预览模型 | 共享预览计划在接点为两段各50%并夹取边缘帧；移动产生空隙、目标ID替换及相邻半窗冲突均移除指定所有者，原输入不被修改。 |

`npm run build` 实际通过，命令墙钟2.472s；客户端为 `index-Sv80KXq_.js` 与 `index-xxTaVBU8.css`。随后 `npm run desktop:package` 内置构建再次通过，连同签名及独立ZIP审计总墙钟39.687s。日志见 [build.log](artifacts/v04-20261018/build.log)、[package.log](artifacts/v04-20261018/package.log) 和 [package-command.json](artifacts/v04-20261018/package-command.json)。这些是本次已完成命令耗时，不是冷/暖性能对比；任务token、CPU时间和进程族峰值内存未测量。

## 独立包核查与保全

已检查现有 `prepare-desktop`、`finalize-desktop` 和独立验证脚本：本版仍由同一esbuild主模块及静态客户端组成，新增模型与渲染代码进入main bundle，无额外外部运行时文件需要扩展包白名单；动态PGM蒙版只在资料库的单次导出work目录产生并随该工作目录清理。

包核查实际通过：稳定应用身份和0.4.0版本、最低macOS、严格深层ad-hoc签名、ASAR运行时白名单和完整性哈希、UI与刚构建dist字节一致、仅3个选定演示素材/8个演示文件、79个依赖声明及许可证、包内Node和物理FFmpeg/FFprobe可运行。没有复制环境、个人资料库、验收成片、`.env`或仓库工件。新临时目录独立解压ZIP后，**384个文件/符号链接的字节、权限和目标与发布应用一致**，严格验签和ZIP SHA-256与收据吻合。

最终包打包前后核对45个冻结源码/脚本/测试文件，0变化。旧0.3 ZIP仍为161,594,273字节，SHA-256仍为 `094fa33f338818341740a11dfa4e39ac1c1fc575f17445f00230c45489058425`；其校验文件、版本化构建/独立收据和旧说明字节保持。generic旧收据和说明另存本轮工件。保全见 [source-and-previous-release-preservation.json](artifacts/v04-20261018/source-and-previous-release-preservation.json)。

构建任务只生成release内应用与ZIP，没有操作已安装应用或桌面资料库。主任务随后独立执行正常退出、保留旧安装包、复制最终应用及访达双击；[最终安装收据](artifacts/v04-20261018/v04-reconnect-install-receipt.json) 绑定ZIP `f46d47e8…` 和安装ASAR `81600fd417df614048c6877828133566e93bb4c6a284dd45eb40a682754c262a`。该ASAR和最终UI文件的哈希也由实际安装进程的API验收再次核对。旧名为 `v04-final-install-receipt.json` 的记录绑定的是先前 `2e18…` 候选，不能当作最终f46安装证据。

## 0.4桌面界面与安装版API验收

原生GUI、独立成片解码及安装版API分别记录；完整操作/构建范围、截图和测量见 [V04-GUI-ACCEPTANCE.md](V04-GUI-ACCEPTANCE.md)，结构化总收据见 [v04-final-acceptance-result.json](artifacts/v04-20261018/v04-final-acceptance-result.json)。

| 检查范围 | 实际构建与结果 |
| --- | --- |
| 原生导入、SRT、基础参数与配乐 | 从本轮较早0.4构建开始，通过原生选择器导入自制blue/red视频、网格PNG与双频WAV，SRT入轨并编辑，实际形成4素材、2视频+1配乐、2字幕工程；不是最终f46上的一次全新首启导入。0.3完整基础流程另有独立通过记录。 |
| 最终逐键输入与Escape | 在f46原生窗口64800重新执行：蒙版X按Cmd+A、minus、1、0、Tab得到−10；旋转按Cmd+A、0、period、2、Tab得到0.2；X中输入未完成的minus后实际按Escape恢复已提交120。随后恢复X120/旋转15并保存。[动作与构建绑定](artifacts/v04-20261018/v04-final-native-input-actions.json)、[26负数](artifacts/v04-20261018/26-final-negative-input.jpg)、[27小数](artifacts/v04-20261018/27-final-decimal-input.jpg)、[28草稿](artifacts/v04-20261018/28-final-escape-draft.jpg)、[29恢复](artifacts/v04-20261018/29-final-escape-restored.jpg)。这三项为真实按键复验，不是从AX帮助文字推断。 |
| 标尺与椭圆预览版本 | [18](artifacts/v04-20261018/18-wj-v04-video-ellipse.jpg) 与 [19](artifacts/v04-20261018/19-wj-v04-sticky-audio.jpg) 属2e18候选，分别显示反转椭圆/羽化及音频轨、固定标尺、.25音量/.2秒淡入出；f46的相同前端字节绑定另列。 |
| 候选椭圆成片 | 2e18的原生反转椭圆/动画导出已独立测量通过，绑定中间ASAR `8319b52b…`；不称为f46重新原生导出椭圆。最终f46另有真实安装版API椭圆/动画输出验证。 |
| 最终UI继承 | [v04-final-ui-qa-match.json](artifacts/v04-20261018/v04-final-ui-qa-match.json) 核对f46的JS/CSS及相关前端源码与18/19截图所用2e18 UI字节相同；这是UI版本绑定，不将早期GUI导出自动当作最终renderer验收。 |
| 最终保存重开 | 正常退出后访达双击最终f46，PID68659/动态端口63701实际恢复原矩形工程；[v04-final-reopen-receipt.json](artifacts/v04-20261018/v04-final-reopen-receipt.json) 及独立字段比较确认除updatedAt外核心数据完全相同。 |
| 三能力同存再重开 | 将.5秒叠化、蓝片.5/.5渐显渐隐、红片50%×50%矩形/X+120/旋转15°、两字幕及25%配乐/.2秒音频淡入出同时保存。正常退出PID68659且runtime消失，再访达双击得到PID71094/新端口64800，[v04-combined-reopen-receipt.json](artifacts/v04-20261018/v04-combined-reopen-receipt.json) 确认全部核心字段一致。PID与端口只是本次动态记录。 |

三能力最终组合状态已保存、重开并预览；成片验收采用下述两份独立场景，不把组合保存等同于另一次组合状态导出。正常退出证据见 [v04-final-normal-quit.json](artifacts/v04-20261018/v04-final-normal-quit.json)。

两份最终成片均由f46实际GUI导出并通过原生另存对话框保存，为6.000秒、1280×720/30fps、H.264+AAC：

| 最终原生成片 | 已实际确认的结果 |
| --- | --- |
| [矩形与画面动画](/Users/macbook/Movies/微剪导出/weijian-v04-rectangle-final-20261018.mp4) | 126,971字节，SHA-256 `fc980df105d21d3ac2233a75c16ce7106ea36d9317c6934a0ecf8dfb9d817db0`。蓝片渐显/渐隐各.5秒，红片矩形宽高50%、项目X+120、顺时针15°；720p实测中心719.497/359.503、角15.0024°、本征尺寸约640.87×360.95，对应期望720/360、15°、640×360，含栅格边缘误差。两条字幕可见。 |
| [叠化、字幕与配乐](/Users/macbook/Movies/微剪导出/weijian-v04-dissolve-final-20261018.mp4) | 129,482字节，SHA-256 `36b9aa31f66dd084762b39a5330a4dd747fca80f8b4d2fcf5366c14a26f765f8`。蓝0–3秒、红3–6秒，居中叠化.5秒；完整解码180帧，没有异常黑色中心，第98–101帧连续红色 `229,30,27`。两条多行字幕进入成片，配乐淡入出和原声音频独立。 |

[矩形实测与联系表](artifacts/v04-20261018/v04-gui-rectangle-final-analysis/acceptance-measurements.json)、[叠化逐帧及音频/字幕测量](artifacts/v04-20261018/v04-gui-dissolve-final-analysis/acceptance-measurements.json)、[180帧记录](artifacts/v04-20261018/v04-gui-dissolve-final-analysis/framewise-all-180.json)。逐帧无黑中心不是对全部像素语义的完整证明；字幕按30fps离散采样，原输入.25/3.25秒边界实际首个可见帧为.266667/3.266667秒。

最终安装版还通过实际应用的动态本机监听与物理bundled媒体工具创建6个独立API工程，六份真实成片均保存重开一致：居中叠化、画面淡入出与反转羽化椭圆、旋转位移矩形，以及30→60、60→30、30→24三种项目/输出帧率。API核对第98–101帧连续红、原声音频切点不移、蒙版几何/羽化、短动画尾帧定格；10个既有工程JSON哈希、28条原有素材记录保持，未选择或改写GUI工程。完整收据见 [installed-v04-api-result.json](artifacts/v04-20261018/installed-v04-api-final-build/installed-v04-api-result.json)。API流程不代替上述原生GUI检查。

### 两种黑屏问题的边界

首次会话曾出现原生预览黑屏及“Unable to play media”；同一个首包正常退出、访达双击重启后蓝画面与紫色叠化预览恢复。[16号恢复截图](artifacts/v04-20261018/16-wj-first-build-restarted-dissolve.jpg) 证明本次恢复，原因仍未知；没有将锁屏、GPU、codec或源码变更当作已确定根因，也没有证明长期绝不复现。

另一个已定位、已修复的问题是首包原生成片在转场结束后第98帧背景全黑、字幕仍在。首次API稀疏采样也漏掉该帧，后续逐帧检查纠正了旧的验证范围。生产根因是 `98/30` 舍入为 `3.266667`，晚于实际帧98时间 `3.266666666…`：普通入段的gte判断晚一帧，而转场流已经结束；相似的绝对PTS小数往返也可能将帧放到相邻位置。

修复在时钟/覆盖表示的所有者处统一整数PTS和帧区间，去除小数秒的重复解释。真实GUI工程参数在隔离公开API中修复前复现唯一黑帧98，修复后180帧无黑，[before/after与根因摘要](artifacts/v04-20261018/reconnect-debug/fix-summary.json) 保留。最终f46再由原生GUI重新导出，并完整解码180帧确认第98–101帧连续红色，最终安装版API也确认同一边界。这一成片修复不能用来解释早先未知原因的会话预览黑屏。

## 验证边界

本轮成片测试使用本机短合成视频和PNG，未覆盖Intel、所有macOS和编码输入、15分钟工程或最坏4K/64片段容量。尚无关键帧、更多转场/动画预设、其他蒙版形状、抠像、曲线变速、ASR、资源库、AI或云协作。仍未复制剪映全部功能。

## 构建历史保全

首次0.4包394d…（161,601,840字节、30项源码检查）保留于 [first-package-0.4.0](artifacts/v04-20261018/first-package-0.4.0/)；含Escape与项目时钟尾帧修复的54129…中间包保留于 [intermediate-package-0.4.0](artifacts/v04-20261018/intermediate-package-0.4.0/)；再含标尺固定修复的2e18…包保留于 [pre-reconnect-package-0.4.0](artifacts/v04-20261018/pre-reconnect-package-0.4.0/)。各目录保存当时ZIP、校验、包收据及构建/源码检查日志；release当前同名0.4文件指向本页最终f46包。

项目时钟修复将定格尾帧从输出fps选择改为项目fps选择，真实动态尾部加40ms渐隐回归覆盖30→60、60→30和30→24。Escape修复只放弃未完成输入草稿，不对已提交值做部分回滚，以免其依赖字段停留在新值。标尺修复将标尺/指针与左空白头保持固定，音频轨滚动时仍可定位；前端隐藏Electron检查与原生19号截图分别记录。最终整数帧修复再覆盖转场末端重连空洞。各次GUI检查按构建归属保留，不将中间包的结果自动推广为最终renderer结果。
