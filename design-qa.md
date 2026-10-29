# 微剪 Design QA · 0.9 最终原生界面与历史记录

## 0.9 最终候选2 · 2026-10-19

final result: passed

限定范围：最终候选2已拍摄的1480×940原生界面与操作状态通过，没有待修P0/P1/P2；原生最终MP4/WAV独立1949/1949另验通过。本轮最终ZIP SHA256 `9abd0efa7c6df57179409d619238e41253f9c441a43ade62812b4bd163d0f176`，安装/交付390项相同、92项冻源一致。详见 [0.9详细QA](artifacts/v09-20261019/v09-design-qa.md)、[裁切/原图哈希](artifacts/v09-20261019/design-qa/comparison-manifest.json) 和 [最终交付](V09-RELEASE-VALIDATION.md)。

实际查看用户四轨真值、本轮剪映音频/资源参考和最终原生20/22/23/24/27/28/30/31/32/34/35–40，将它们放在同一全图/局部输入后逐张查看9张组合。五面向：字体/时间与dB/键列表可读；三栏、四画面轨或下滚四音轨、叠行/属性内部滚动保留；青色激活、白选中、绿波形与带文字的旧WAV提示明确；真实四层/字幕/源波形显示；本地有限目录与草听边界未冒充完整剪映。五产品表面为素材、播放器/预听、属性、时间线、保存导出，均在本次状态可达。

- 全图：[34重开四画面](artifacts/v09-20261019/design-qa/qa-v09-full-picture.png)、[40四音轨与键](artifacts/v09-20261019/design-qa/qa-v09-full-audio-keys.png)。
- 局部：[时间线/路由/波形](artifacts/v09-20261019/design-qa/qa-v09-timeline.png)、[基础/音量键](artifacts/v09-20261019/design-qa/qa-v09-audio-inspector.png)、[素材库](artifacts/v09-20261019/design-qa/qa-v09-library.png)、[新动画/转场](artifacts/v09-20261019/design-qa/qa-v09-effects.png)、[旧版/新WAV](artifacts/v09-20261019/design-qa/qa-v09-preview-states.png)、[导出/CmdW返回](artifacts/v09-20261019/design-qa/qa-v09-export-flow.png)。

旧候选1的15超时挤小画面只作历史负证据。[受控真实三404前后](artifacts/v09-20261019/design-qa/qa-v09-error-regression.png)已查看，旧canvas370.3125→44.4766px，新版保持370.3125px且独立详情/重试可滚达；这是隐藏完整App证明，不是本轮原生错误复现。最终20/34/40无大报错卡占位，37/38实际成片可播放；39的CmdW先返回主窗口完成modal，40随后回到编辑状态。

用户真值1680×1055密度未知，剪映3360×2110按2×归一；微剪2960×1880为1480×940外窗，裁去56物理像素标准标题栏后1480×912内容。素材、时长、状态与视口不同，不称像素clone。Phosphor/系统图标是独立资源；P3保留统一效果图标缺真实运动预览、导出首素材示意封面、辅助小字对比度。原生小窗、全面读屏/焦点/文字缩放与减少动态偏好未覆盖。

推荐交付原始 [40-final-audio-keys-four-tracks.png](artifacts/v09-20261019/40-final-audio-keys-four-tracks.png)，同屏包含真实四层、双行字幕、四音轨/源峰、音量键列表与菱形。独立1949/1949覆盖538全PTS、66抽帧/1411像素探针及有限声学/8字幕区域，不是全像素或OCR/物理听感证明。本次只写衍生图/文档，未碰主GUI/Library/声音/源码。

## 0.8 历史最终安装版界面 · 2026-10-18

final result: passed

**限定范围：最终原生界面与操作截图通过，最终MP4/WAV独立2322/2322另验通过。** 本轮ZIP SHA256 `2569b6f746a851e0d5d558299ac13839d65e8411fe3c0840ca605b73699e5a5c`，安装/交付390条目一致。实际查看用户四轨真值、本轮剪映01/02音频和06转场，以及微剪原生08–30的全图/局部；17张组合均已打开。见 [0.8详细QA](artifacts/v08-20261018/v08-design-qa.md)、[图像与裁切收据](artifacts/v08-20261018/design-qa/comparison-manifest.json) 和 [包/重开/WAV身份绑定](artifacts/v08-20261018/design-qa/native-binding.json)。

- 全图：[22重开](artifacts/v08-20261018/design-qa/qa-v08-full-reopened.png)、[23动画参数态](artifacts/v08-20261018/design-qa/qa-v08-full-selected.png)。
- 聚焦：[素材](artifacts/v08-20261018/design-qa/qa-v08-library.png)、[音频面板](artifacts/v08-20261018/design-qa/qa-v08-audio.png)、[四轨](artifacts/v08-20261018/design-qa/qa-v08-timeline.png)、[真实拖动序列](artifacts/v08-20261018/design-qa/qa-v08-drag-sequence.png)、[13种转场](artifacts/v08-20261018/design-qa/qa-v08-transition.png)、[复合动画参数](artifacts/v08-20261018/design-qa/qa-v08-animation.png)、[WAV播放/旧版状态](artifacts/v08-20261018/design-qa/qa-v08-preview-states.png)、[导出设置](artifacts/v08-20261018/design-qa/qa-v08-export-settings.png)。

五类面向已逐项查看：系统中文/时间码/精确音频参数可读；暗色三栏和选中态约34%/37%/29%、四画面轨与内部滚动保留；青色激活、白色选中及带文字的旧版告警明确；真实媒体/源波形/字幕可见；整工程WAV、草听增益上限和有限本地效果文案明确。五个产品表面（素材、播放器/预听、属性、时间线、保存导出）在本次状态未见P0/P1/P2。原生11/12/13分别显示库拖入、跨轨、同轨落位，14显示−6dB/.4正弦/.6缓出，16→17的WAV控件从约4秒推进到27.3664秒，18显示旧版提示，22重开JSON字节相同，23显示新复合动画类型及秒数；23播放头仍在0.9秒，不用该画面冒称蓝片动画姿态验证。

用户真值1680×1055（密度未知），本轮剪映3360×2110按2×归一；微剪2960×1880为1480×940外窗，裁去56物理像素标准标题栏后1480×912。媒体、时长、选中状态和视口不同，组合图不作逐像素等价或完整剪映复制声明。P3保留导出首素材示意缩略图、效果目录缺少真实运动缩略演示、图标/小字光学差异及原生拖后短暂文本选中；22/23已无该文本高亮。没有全面无障碍、原生小窗、其他硬件/编码或物理听感结论。

最终补图：[29四层/字幕/波形](artifacts/v08-20261018/design-qa/qa-v08-final-full.png)、[30音频参数](artifacts/v08-20261018/design-qa/qa-v08-final-audio.png)、[25完成→28 CmdW返回](artifacts/v08-20261018/design-qa/qa-v08-final-export-flow.png)、[26/27成片播放](artifacts/v08-20261018/design-qa/qa-v08-final-movie.png)已实际打开。27暂停于21.026秒；正常退出收据确认项目字节相同、PID/runtime消失、work为空。MP4 3,281,941字节/SHA `38d9ba8bc8bd19eeb98c989607595522f60d6be52a29d008db023feacae219e6`，WAV 12,601,678字节/SHA `5a615bc85976ca2b46fdc9883ff686fd888ed5907ac79f34819e50e7ee951d86`，均由当前包产生。[独立2322/2322](artifacts/v08-20261018/final-native-analysis/RESULT.md)覆盖1969个解码PTS、102抽样画面/1471像素探针、48源帧码、每输出28音高/12标记/299源格点窗、12配乐增益窗、8字幕区域；不是全片每像素、字幕OCR或物理听感结论。本次只写衍生图与文档，未改生产源或主Library，历史候选失败记录保留。


## 0.7 候选2最终安装版 · 2026-10-18

final result: passed

**当前结论：候选2限定范围验收通过。** 候选2 ZIP SHA256 `4ef55b327025bb15d4de43851654e085bfdafc6794d7e61df0b0e5b55402f86c`，161644057 bytes；安装包/交付目录384条目完全一致。新原生42四轨、43/44效果、45设置、48导出完成、49系统另存、50返回及51/52成片预览均已实际查看。候选2独立成片检查1642/1642通过，最终视觉QA在本报告范围内 passed。旧13张组合图仍为候选1布局历史；候选1约25ms导出动态pose失败与修复记录保留。

候选2补充：[重开四轨全图](artifacts/v07-20261018/design-qa/qa-v07-candidate2-full.png)、[动画对照](artifacts/v07-20261018/design-qa/qa-v07-candidate2-animation.png)、[转场对照](artifacts/v07-20261018/design-qa/qa-v07-candidate2-transition.png)。3张新组合均已实际打开；[源码/打包UI等价](artifacts/v07-20261018/design-qa/candidate2-ui-equivalence.json)确认18个src文件、5个shared文件及5个UI条目候选间完全一致，复用下方候选1五类/五surface分析。详见[候选2比较收据](artifacts/v07-20261018/design-qa/candidate2-comparison-manifest.json)与[当前安装包身份](artifacts/v07-20261018/installed-release-equivalence.json)。只变render与相关测试，布局通过不能替代导出动态pose的独立验证。

最终补图：[45→48→50导出闭环](artifacts/v07-20261018/design-qa/qa-v07-candidate2-export-completed.png)、[51/52真实成片预览](artifacts/v07-20261018/design-qa/qa-v07-candidate2-movie-preview.png)均已实际查看；49系统另存原图也已查看。[最终SHA绑定](artifacts/v07-20261018/design-qa/candidate2-final-validation-binding.json)关联新包、源码、3463143字节MP4（SHA `228391824d920d16a0af90b1dcf1452e9bae85756722ff48ab9048ae276f9187`）、正常退出和独立oracle。1642/1642覆盖1969解码PTS、102抽样画面/1465像素探针（最大通道误差4）、48源帧码、34音调窗、6配乐增益窗及8字幕区域；不是全片逐像素、OCR或物理听感证明。P3装饰缩略图及候选1失败历史保持。

本次实际查看用户四轨图 [reference-multitrack.png](artifacts/v06-20261018/reference-multitrack.png)、本轮剪映 JY03/04/08，以及候选1安装版原生15/18/22/23/25/26/29/31/32/33；将源图与实现放入同一全图/聚焦组合后，逐张查看13张组合图。完整五类视觉、五个产品表面、原图哈希和裁切/密度边界见 [0.7详细报告](artifacts/v07-20261018/v07-design-qa.md) 与 [比较收据](artifacts/v07-20261018/design-qa/comparison-manifest.json)。候选1包 ZIP SHA256 为 `4993c4690be1008e70b48b6d6a9efab12f0f4458f0486c184571a2d921526996`，候选1安装/交付文件等价见 [归档收据](artifacts/v07-20261018/candidate-1/installed-release-equivalence.json)。

- 全图：[候选1选中四轨](artifacts/v07-20261018/design-qa/qa-v07-full-final-selected.png)、[四轨重开](artifacts/v07-20261018/design-qa/qa-v07-full-reopened.png)、[关键帧](artifacts/v07-20261018/design-qa/qa-v07-full-keyframes.png)、[曲线](artifacts/v07-20261018/design-qa/qa-v07-full-curve.png)。
- 聚焦：[素材](artifacts/v07-20261018/design-qa/qa-v07-library.png)、[属性](artifacts/v07-20261018/design-qa/qa-v07-inspector.png)、[时间线/真实波形](artifacts/v07-20261018/design-qa/qa-v07-timeline.png)、[预览](artifacts/v07-20261018/design-qa/qa-v07-preview.png)、[动画](artifacts/v07-20261018/design-qa/qa-v07-animation.png)、[转场](artifacts/v07-20261018/design-qa/qa-v07-transition-context.png)、[导出流程](artifacts/v07-20261018/design-qa/qa-v07-export-flow.png)。

| 五类表面 | 本轮结果 |
| --- | --- |
| 字体/排版 | 紧凑系统中文、时间码和关键数字可读；图标与次要小字有P3光学差异，未声称字体/抗锯齿等价。 |
| 间距/布局 | 选中态约34%/37%/29%；四画面轨、字幕和音乐均可见，长属性有区域滚动；未选中重开时播放器变宽，按不同状态记录。 |
| 色彩/状态 | 深灰、青色激活/导出、白色选中及分轨颜色延续参考；示例面板中位RGB源38/38/38、实现36/36/36，不作ICC或逐像素匹配。 |
| 图像/质量 | 实际视频、四层、字幕与真实PCM相对波形可见。教室/山景与原创测试媒体不同。导出卡片用首个素材缩略图，尚非合成帧，保留P3改进。 |
| 文案/内容 | 本地资料库、保存状态、素材数量和真实参数有截图/AX支撑；八类转场与有限本地动画范围明确，不冒称云/会员/完整剪映功能。 |

五个产品表面（素材库、播放器、属性/曲线/效果、四轨时间线、导出/保存反馈）在候选1布局/可读性范围未见P0/P1/P2；候选2独立成片探针已通过，候选1采样失败历史保留。P3包括导出示意缩略图精度和图标/小字光学差异。源图1680×1055硬件密度未知；微剪原图3354–3356×2110，按2×下采样并裁去56物理像素标准标题栏，内容约1677–1678×1027。媒体、视口与状态不同，禁止把组合图当成像素等价或全部功能复制证明。

本次只写截图衍生物和文档，没有操作主UI或修改冻结生产源/主Library。29/30/31实际显示导出完成、系统另存和返回；保存重开/最终成片结论由 [0.7原生验收](V07-GUI-ACCEPTANCE.md) 和主代理发布验证负责。没有本轮完整无障碍、较小原生窗口、其他Mac/编码、物理听感或全视频逐帧覆盖结论。33接点预览实际有旋转蓝片/字幕，角落黑背景不直接解释成解码黑屏；单张恢复图也不代表全过程无等待。


## 0.6 最终安装版 · 2026-10-18

final result: passed

本次以用户本轮四轨截图 `codex-clipboard-27914b60-aa2e-40fe-a474-9a6689b3f3c9.png`（工作区同字节 [reference-multitrack.png](artifacts/v06-20261018/reference-multitrack.png)，1680×1055）为视觉真值。最终安装版40关键帧/43已存曲线为主状态，29–36、38–42补充实际拖拽、导入、四层预览、重开、动画/转场和导出完成。截图绑定ZIP SHA-256 `d4e027118ab8467e9c4e6b0cd9e678b2de8d6139715cac4157c7e345faa7eeb9`；[详细QA](artifacts/v06-20261018/v06-design-qa.md) 与 [输入/裁切/检查收据](artifacts/v06-20261018/design-qa/comparison-manifest.json) 记录完整范围。

原生主截图3356×2110，对应1678×1055外窗、2×；仅裁去56物理像素macOS标题栏并下采样至1678×1027内容。源图硬件密度未知。36重开是1480×940外窗、未选中工程属性状态，单独标记；不把不同视口、素材或状态当成像素一致对照。源图与实现已放入同一组合图，并逐张实际打开检查：

- 全图：[关键帧态](artifacts/v06-20261018/design-qa/qa-v06-full-keyframes.png)、[曲线态](artifacts/v06-20261018/design-qa/qa-v06-full-curve.png)、[较小窗口重开](artifacts/v06-20261018/design-qa/qa-v06-state-reopen.png)。
- 局部：[素材库](artifacts/v06-20261018/design-qa/qa-v06-library.png)、[参数](artifacts/v06-20261018/design-qa/qa-v06-inspector.png)、[四轨](artifacts/v06-20261018/design-qa/qa-v06-timeline.png)、[真实预览](artifacts/v06-20261018/design-qa/qa-v06-preview.png)、[新增功能页](artifacts/v06-20261018/design-qa/qa-v06-functional-additions.png)。

| 五类表面 | 本轮结论 |
| --- | --- |
| 字体/排版 | 系统/PingFang fallback、紧凑元数据、时间码和字段可辨；与源字形/图标光学重量有P3差异，不作字体文件或抗锯齿等价声明。 |
| 间距/布局 | 选中态约34%/37%/29%，四画面轨可见；新增字幕/配乐及右侧长字段通过区域内滚动访问。主操作未被横溢或遮挡。 |
| 颜色/状态 | 暗灰、青色激活/导出和选中边框延续源图；面板区域中位采样源38/38/38、实现36/36/36，仅为不同截图条件下的示例，不是ICC等价。 |
| 图像质量 | 实际H.264/AAC、WAV、PNG测试资产、缩略图、四层和字幕可见；源视频本体未提供，媒体内容不同明确保留，未伪造波形。 |
| 文案/内容 | 本地资料库、保存状态、素材数量、关键帧与效果数值有实际状态支撑；云/会员与未实现功能不虚构。 |

本轮约定范围内无尚待修复P0/P1/P2。数字字段及集中关键帧列表代替源图部分滑杆，素材卡片密度、图标和次要小字存在明确取舍/P3差异；不宣称逐控件或全剪映复刻。早期原生拖动P1及内部HTML5悬留已经以窗口终结owner修复，最终29–33重新实操并核对工程/撤销；[故障历史](V06-NATIVE-DRAG-DIAGNOSIS.md) 保留，没有用旧候选通过替代本次最终图。

实际流程与包身份见 [V06-GUI-ACCEPTANCE.md](V06-GUI-ACCEPTANCE.md)、[V06-RELEASE-VALIDATION.md](V06-RELEASE-VALIDATION.md)。最终成片独立检查125/125通过，但实际为46个不同视频采样帧、13个短音调窗、字幕区域而非OCR；323是帧数元数据，不是全片PTS或逐帧画面验收。没有本轮完整无障碍/VoiceOver、文字缩放、其他设备/编码或物理听感结论。本次QA只写截图衍生文件和文档，未改冻结生产源。

## 0.5 最终安装版状态 · 2026-10-18

最终安装版已另行实操 Finder 首启与正常退出重开0秒画面、原生素材导入与保存、关键帧中间值、分段速度、播放字幕及导出另存。源码测试49/49、最终成片独立检查21/21。完整原生截图、包身份和逐项结果见 [V05-GUI-ACCEPTANCE.md](V05-GUI-ACCEPTANCE.md) 和 [V05-RELEASE-VALIDATION.md](V05-RELEASE-VALIDATION.md)。

本次文档更新没有重新制作0.5全图/窄窗五表面组合对照，因此不把下方旧版设计 passed 直接套用于0.5，也不作剪映像素级还原声明。布局仍沿用户 `artifacts/reference.png` 的暗色三栏与时间线，新功能实际定义见 [FEATURE-GUIDE.md](FEATURE-GUIDE.md) 与 [V05-JIANYING-REFERENCE.md](V05-JIANYING-REFERENCE.md)。

**早期0.5候选的历史检查结果为 blocked。** 当时原生冷启动ready1/seeking、无解码帧，首帧seek与手动prime没有充分解决。最终源码移除WebAudio预初始化后，最终安装包的冷启动与重开已实际正常；只用HTMLAudio预览，增益最高100%，超过100%仅导出。历史故障与因果对照保留在 [诊断报告](V05-PREVIEW-DIAGNOSIS.md)，不撤回当时失败，也不把0.4重启恢复解释为同一根因。

## 0.4 历史界面对照 · 2026-10-18

final result: passed

此结果仅是当前安装版界面与预览显示的设计 QA，不是0.4最终发布验收。此前成片转场出口黑帧已触发后端修复；最终安装版API与原生导出验收仍在进行，本报告不预先确认结果。

- 整体视觉真值为 `artifacts/reference.png`（2051×1072，原密度未知）；功能页参考为 `artifacts/v04-20261018/09-jy-inverted-ellipse.jpg`（1680×1055）。
- 原生实现为 `artifacts/v04-20261018/18-wj-v04-video-ellipse.jpg`、`19-wj-v04-sticky-audio.jpg`，2960×1880，对应1480×940 CSS、2×。整体对照裁去微剪macOS标题栏56物理像素，保留纵横比，再等宽缩放，不作像素等价声称。
- 完整组合图为 `artifacts/v04-20261018/qa-v04-candidate-full.png`；聚焦图为 `qa-v04-candidate-mask-preview.png`、`qa-v04-candidate-mask-controls.png`、`qa-v04-candidate-timeline.png`。均已放入同一比较输入并实际目视检查。
- 先前原生视频黑屏在正常退出、Finder双击同一首包后恢复（16），本候选18又重复显示视频和反转椭圆。根因仍未知，不称作源码修复。
- 音频滚动后时间标尺消失P2已通过sticky标尺、固定左空白头、标尺内播放头指针修复；原生19显示完整音频轨和时间标尺。另以1480×940/1060×700隐藏窗口检查纵横滚动、对齐及定位，共16项通过。
- 五表面已复核：系统/PingFang紧凑文字、约32%/19%三栏间距、深灰与青色状态、真实视频/图片和蒙版、对应实际参数的中文文案。不同素材/显示色彩、独立羽化标度、窄栏纵向字段和有限本地资源属于明确取舍；图标/字体栅格为P3。当前对照范围无其他可执行P0/P1/P2界面差异。

最终安装版又补原生 `artifacts/v04-20261018/22-wj-final-reopened-rectangle.jpg`：保存重开后红色视频及X=120项目px、50%宽高、15°矩形蒙版可见。新增 `qa-v04-final-full.png`、`qa-v04-final-rectangle-preview.png`、`qa-v04-final-rectangle-controls.png` 均已打开目视比较，未见新增可执行P0/P1/P2界面差异。`v04-final-ui-qa-match.json` 确认最终安装版JS/CSS逐字节哈希与18/19候选前端相同、四个前端源码文件相同；`v04-final-reopen-receipt.json` 记录核心数据重开相同。因此18/19是相同前端的前序原生证据，不冒称在最终包重复操作。

详细状态、比较历史、交互与剩余门禁见 [0.4安装版界面报告](artifacts/v04-20261018/v04-design-qa.md)，资源关联与最终匹配收据均在同目录。后续前端若变化必须重做比较；UI通过不替代完整导出与发布验收。

## 0.3 历史验收概览（2026-10-17冻结）

final result: blocked

当时已检查安装版0.3主界面的实际截图，并与用户参考图制作组合图；当时受锁屏限制，新增参数交互和完整原生流程未补验，不能将以下0.1通过记录套用到0.3。2026-10-18父流程已另完成0.3素材/字幕/保存重开/视频导出复验；这里保留当时设计检查的历史状态，不作为当前锁屏或运行状态描述。

本轮证据、布局观察和待办见文末 [0.3 布局检查](#v03-layout-observations)；运行和打包验证见 [V03-RELEASE-VALIDATION.md](V03-RELEASE-VALIDATION.md)。

## 0.1 历史记录

以下内容是原 0.1 范围的历史证据，不代表 0.3 新功能或新版响应式布局通过。

0.1 historical final result: passed

## Target and comparison evidence

- Source: `artifacts/reference.png`, copied unchanged from the user-supplied剪映截图, 2051 × 1072 pixels. Source hardware density is unknown; supplied pixels define the comparison canvas.
- Implementation: http://127.0.0.1:4173/ in Codex in-app browser; `artifacts/editor-2051.png`, 2051 × 1072 pixels at the same CSS viewport. Effective screenshot density: 1 pixel per CSS pixel.
- State: dark editor, media tab, no selection, two 15-second picture clips, paused at the end, project properties visible. Added subtitle/music lanes are part of the user's requested scope. Source footage was not supplied as media, so the implementation uses separately generated cloud-and-mountain footage.
- Full comparison opened and judged together: `artifacts/comparison-full-final.png` (source left, implementation right, equally reduced for overview).
- Equal-size focused comparisons opened together: `artifacts/comparison-library-final.png`, `artifacts/comparison-inspector-final.png`, `artifacts/comparison-timeline-final.png`.
- Additional views: `artifacts/editor-1440.png` (1440 × 900), `artifacts/editor-1024-final.png` (1024 × 768), `artifacts/subtitle-editor-2051.png`, `artifacts/export-completed.png`.

## Findings and iteration history

1. Initial large-view comparison retained the three-column composition, large 16:9 player, compact media cards, narrow panel gaps, dark panel rhythm and cyan active states. Removed an unrequested decorative sentence from the inspector to preserve the reference's quiet lower area. Final full/inspector comparisons show the correction.
2. **P2, fixed:** at 1024 × 768 the music lane was partly below the visible area, and the settings action crowded the last project property (`artifacts/editor-1024.png`). Corrected short-height track/header dimensions and property spacing; replaced the overlapping sticky action with a normal flex-column action. Recaptured and visually reviewed `artifacts/editor-1024-final.png`: all lanes and settings action are visible.
3. Final comparison aligns timeline zoom (54 px/second) and end position. End preview preserves the actual last frame: paused, readyState 4, source currentTime 14.966666 in the final 15-second clip.
4. No actionable P0/P1/P2 findings remain within the agreed desktop first-version scope.

## Five required fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts/typography | System/PingFang UI text, compact 9–12 px metadata and monospace timecodes retain the source density. Phosphor glyphs have small optical differences from the original icons (P3). Subtitles use Hiragino Sans GB in preview and backend. |
| Spacing/layout | Left library / player / inspector proportions and top/bottom split follow the reference. 1440 and 1024 windows have no document-width overflow. Short-height crowding was corrected and rechecked. |
| Colors/tokens | #151515 shell, #242424 panels, lighter tool headers, cyan active/export controls and gray metadata follow the source palette. Music/subtitle colors distinguish the additional working lanes. |
| Image quality/assets | Real generated raster artwork is encoded into sample footage; actual media thumbnails appear on the timeline. No CSS illustration or fabricated waveform stands in for media. Example content differs from the original and is identified as AI generated. |
| Copy/content | Chinese labels describe real editing actions. Project properties reflect actual local data; local save location does not falsely identify the original剪映目录. Out-of-scope tools are disabled and marked as future-version controls. |

## Browser interactions tested

Real file chooser import of two MP4s and a WAV; adding clips; field-based trim/source offset; 1.5× speed; 35% music volume; double-line Chinese subtitle; ruler seek; split; undo/redo; pointer drag reorder; pointer edge trim; decoded preview playback; save and library reopen; export settings; real 12-second MP4 export and browser download; opening a second export offers a fresh render. Search/no-result/clear states were checked. Latest browser error/warning log query returned an empty list.

## Remaining scope and P3 polish

Phone editing, touch gestures and comprehensive accessibility are not fully verified. One main picture track plus music/subtitle lanes is intentional. Advanced effects, speech recognition and剪映工程互通 are not claimed. Original icons, font rasterization and sample footage differ, so this is not a pixel-identical reproduction.

## Checklist

- [x] Open source and rendered implementation together, full view and focused regions.
- [x] Evaluate all five fidelity surfaces.
- [x] Fix P2 issues and recapture/review.
- [x] Complete the core flow through a real downloaded movie.
- [x] Check console errors and leave a running local preview.

0.1 historical final result: passed


<a id="v03-layout-observations"></a>
## 0.3 布局检查 · 2026-10-17

final result: blocked

### 本轮证据与归一方式

- 视觉参考：用户提供的 `artifacts/reference.png`，2051 × 1072 原始像素；原始硬件密度未知。
- 实际实现：父流程通过 Finder 双击安装版后抓取的 `artifacts/v03-release-20261017/01-finder-double-click-v03.jpg`，2960 × 1880 像素，对应 1480 × 940 CSS 像素、2× 密度。当前打开的是旧工程“Mac桌面验收-20261017”，没有选择片段，右侧显示草稿参数。
- [完整组合图](artifacts/v03-release-20261017/qa-comparison-v03.png)：两幅原图各缩放到 1280 像素宽，保留原纵横比，显示高度分别为 669 与 813 像素。标签明确记录不同视口和密度，不拉伸、不重画截图，也不把等宽处理当作等 CSS 视口。
- [时间线局部组合图](artifacts/v03-release-20261017/qa-timeline-v03.png)：从上述原图裁取真实时间线区域，再等宽缩放，重点检查工具条、空叠加轨和底部可见性。
- 两张组合图都已打开目视检查。状态不同：参考图为约 30 秒处有画面；0.3 截图播放头为 16 秒，主轨画面在约 10 秒结束、配乐持续到 30 秒。截图中的黑色预览与时间线空隙相符，不能据此判定解码或播放故障。

### 已观察到的布局

1. 旧工程标题、3 个素材卡片、字幕片段、主轨片段和配乐片段均显示，截图中没有加载遮罩、报错弹窗或布局塌陷。
2. 紧凑暗色三栏仍保持：左侧素材与工具、中间 16:9 播放区、右侧草稿属性，下方为时间线。顶栏工程操作、导出按钮、播放控制和底部状态栏均可见。
3. 新增空“叠加 1”轨道可见，主轨在其下方。图层多于原参考的一条画面轨，因此轨道区的垂直访问方式需要滚动；本轮截图只证明轨道出现，不能证明滚动交互已验收。
4. 当前截图未选中片段，没有显示“画面/调节/音频”的新增参数，因此不能用于判断参数面板布局、输入交互或预览/导出一致性。

### 优先问题与限制

- **P2 候选，待滚动交互复核：初始可视区域仅显示音频片段上缘。** 当前截图底部可以看到绿色配乐片段的上方，音频轨头未完整出现在可见区域。空叠加轨增加了纵向内容；需要手动滚动确认音频轨、裁剪边缘和轨道头可完整访问。如果滚动完整可达，则将此项记录为多轨滚动的预期行为；若无法到达或轨道头不同步，需要调整 `.tl-scroll` / `.tl-track-headers-inner` 的滚动或轨道尺寸后重新截图。本轮未修改冻结的源码，也未把候选当成已复现的遮挡故障。
- 在这一张已捕获的无选择状态中，未观察到 P0 或 P1 布局问题。该结论不覆盖新增参数状态、文件选择框、导出对话框或较小窗口。
- Mac 锁屏阻断了进一步 GUI 操作。同状态同视口的源图复核、1440/1024 等新版适配、焦点/键盘可达性和完整流程仍未完成。截图不能证明可访问性合规，也没有本轮新版控制台检查证据。

### 五类视觉检查

| 类别 | 本轮实际观察与边界 |
| --- | --- |
| 字体与排版 | 中文标签、紧凑小字、时间码层次可读；未见截断影响主要操作。因 CSS 视口、密度和原生窗口栏不同，未作字号或栅格化的像素等价判断。 |
| 间距与布局 | 三栏及上下区划稳定；右侧“修改”和工具条未与属性文字相互遮盖。音频轨可视范围需滚动补验；未复验更小窗口。 |
| 色彩 | 大面积暗灰面板、青色激活/导出控件延续参考方向；新增字幕黄褐色与音频绿色用于区分轨道。不声称逐像素色值匹配。 |
| 图像与素材 | 真实素材缩略图出现在素材区和主轨；当前红色测试片、云海画面与原参考素材不同。黑预览对应当前时间线空隙，未伪造画面或波形。 |
| 文案与状态 | 旧工程名、素材数量、已保存状态可见；顶部“调节”可用，其余未实现工具保持灰色。仅根据截图记录状态，未将可见控件当成操作通过。 |

### 待完成清单

- [x] 打开用户参考图和本轮实际安装版截图。
- [x] 制作并打开全图与时间线局部组合图，注明不同视口和密度。
- [x] 隔离 0.1 历史通过记录，列明 0.3 未验范围。
- [ ] 解锁后检查时间线滚动，确认完整音频轨和轨道头访问。
- [ ] 实测新增参数和 SRT 原生文件入口，保存重开与导出后核验。
- [ ] 捕获 0.3 同状态、同视口图及较小窗口，完成新版本视觉闭环。

0.3 historical final result: blocked

上述0.3清单为2026-10-17历史冻结记录。0.4历史候选界面对照以本文对应节及独立报告为准；0.5最终安装版状态见首节及独立原生报告。

0.4 historical final result: passed
