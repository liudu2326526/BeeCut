# 微剪 0.6 时间线与隐藏集成验证

本报告覆盖生产源码的隔离 Electron 集成与纯模块测试。主代理另行进行 Finder 启动、原生拖拽、保存重开及导出验收；这里的结果不代替原生验收。全部集成使用临时 profile 和内存工程 API，没有操作已安装主窗口或用户 Library。

## 实现与边界

- 四条明确的画面轨道支持素材库放入、轨内移动、跨轨移动，拖动时显示目标轨道、落点、吸附线及合法/拒绝反馈。
- `shared/timeline-placement.mjs` 统一预览与提交校验。视频同轨重叠明确拒绝，不挤动邻片；不同画面轨可重叠；音轨保留混音重叠。两端可吸附到播放头与片段/字幕边界。提交保留已解析的小数落点，避免二次取整破坏尾端对齐。
- 原片段在原 DOM 轨道内保留，目标轨使用独立 ghost。窗口 capture 监听统一拥有 pointermove/up/cancel；真实匹配 pointerup 才提交一次，按钮状态为0不会自动提交。取消、失去捕获、真正窗口失焦、Esc、新按下打断旧事务或释放到视口外均不提交。水平/垂直边缘滚动重新计算真实内容坐标，轨道头保持对齐。
- 内部素材库通过 Timeline 的 `beginMediaGesture` 进入同一指针事务，落点/预览/提交使用同一 owner。移除了内部 HTML5 拖放/MIME 替代表示。拖动或明确取消后的单次鼠标 click 被 owner 消费，普通 quick click 及 AX/键盘 detail0 激活仍添加一次。外部系统 Files drop 保持独立导入流程。
- 裁切、关键帧标记、字幕和音轨仍可使用。一次成功移动/裁切对应一次撤销。

## 已执行验证

1. `node --test tests/timeline-placement.test.mjs`：7/7 通过，97.41ms。覆盖碰撞/四层、两端合法吸附、导入时长与900秒边界、滚动坐标、取消/单次提交、非整帧时长的提交稳定性及素材指针事务；删除了已移除 MIME 表示的冗余单测。
2. `artifacts/v06-20261018/timeline-drag/verify-drag.cjs`：36/36 通过，5.995s。完整 App 使用 CDP 真实指针按下/移动/松开，覆盖同轨与跨轨、拒绝碰撞、一次撤销、水平/垂直边缘滚动、视口外释放、裁切，以及内部素材指针落点。新增 down buttons1 → move buttons0 → up 在轨道重新命中时一次提交/撤销；buttons0 期间仅预览。素材库精确落点只添加一段，quick click 与 AX detail0 激活各添加一次，取消前未移动也不会被尾随 click 添加。blur/pointercancel 单独合成；Esc、新按下与终结 up 使用 CDP。
3. `verify-curve-ui.cjs`：15/15 通过，11.048s。实际控件覆盖关键帧选择与数字草稿清理、插值编辑、平滑曲线预设/增加/删除/精确输入、曲线拖动一次撤销、取消/Esc、内存 API 保存重载，以及连续 Delete 的焦点保护。新增曲线图外重新命中的真实 up 一次提交/撤销，以及 blur/cancel/Esc/新按下不提交草稿。曾复现的最后关键帧删除后焦点落到 body、再次 Delete 删除整个片段的问题已由控件 owner 修复；修复后连续3次 Delete 保留片段。
4. 1680×1000、1480×940、1060×700 选中片段布局均无横向溢出，曲线和数值字段未被横向裁切。1480×940 四条画面轨完整可见；1060×700 通过滚动访问画面/音轨且轨道头对齐。

真实原创 H.264/AAC 八秒素材的平滑曲线播放采集30次、其中29次处于稳定播放状态。与同一生产映射 owner 的期望时钟比较，最大源时间偏差0.2010秒、倍速偏差0.0182，视频/音频均推进并可暂停；移动白条与视频帧回调的源时间误差小于4.5像素。全过程 AudioContext 构造数为0。这是消费同一模型的预览集成验证，不是独立导出时钟 oracle，也不证明物理扬声器听感。隐藏窗口显式关闭 background throttling 以运行 rAF，与原生窗口环境存在差异。

## 原生事件证据与结构修复

主代理取得的 `native-drag-diagnostic-raw.ax.txt` 中，trusted down/buttons1 后出现 move/buttons0，随后真实 up 到达窗口但 target 已是轨道，始终没有 got/lostcapture；旧版仅绑定片段节点的终结 handler 因而未运行，ghost 持续。`native-library-diagnostic-raw.ax.txt` 则记录内部 HTML5 dragstart 后 pointercancel，未收到 drop/end。这里按所记录的事件路径定位，不归因为网络、GPU或操作系统驱动损坏。

修复将整段事务交给窗口终结 owner，节点捕获只是可用时的输入辅助；内部素材库使用相同 owner，并将同类末端依赖一并从速度曲线 SVG 移除。隔离 CDP 的正常捕获路径会触发 got/lostcapture；为复现原生记录的“无可用捕获”边界，测试仅将 `setPointerCapture` 设为无效，未改业务函数或合成 pointerup。两套新增回归的 down/move0/up 全部 `isTrusted=true`，up 分别命中轨道及图外 SECTION。此有界测试说明结构修复覆盖观察到的边界，修复后原生验收仍由主代理执行。

## 证据与冻结

结果：`artifacts/v06-20261018/timeline-drag/drag-result.json`、`curve-ui-result.json`。截图：`four-track-layout.png`、`small-track-scroll.png`、`curve-controls.png`、`curve-playback.png`、`selected-layout-{1680,1480,1060}.png`。早期布局和关键帧故障证据保留，未覆盖成成功结果。

`frozen-source.json` 记录原生事件修复后的 Timeline、样式、手势/落点模块、单测及结果/生产源码隔离 bundle 的 SHA-256；此前收据保留为 `frozen-source-pre-native-repair.json`。最终15项曲线/键盘矩阵 bundle 为 `4765c425f764e6b809636bd292e704820ca04b083c2ff545577f42d96a5270c1`。早期10项矩阵 bundle 保留为 `curve-app-keyboard-pass.js`，不代表最终源码。

原生事件修复前，最终后端支持域定案后，`verify-final-guard.cjs` 另做2项窄验证，2/2通过、1.734s：先有合法拖动草稿，再拖至112.5倍/源秒被8倍/源秒支持边界拒绝，指针捕获与上一合法草稿均保留，保存JSON无提交；拖回另一合法点后松手成功，一次撤销恢复。两层曲线共444块，复制导致超过全工程512块预算时，保存JSON完全不变，撤销仍返回前一次合法数值编辑。该检查当时使用实际App/控件/owner代码，视频只有元数据，媒体请求404、未提供任何编码字节，没有启动解码或播放。它只验证编辑事务和错误恢复，保留原收据而不冒称修复后重新执行。

结果为 `final-guard-result.json`，最终窄检查bundle为 `guard-app.js`，SHA-256 `0021dc71951113d71ceaff6b87aba8bcc7c54a6be6f658e9b59233e4860623e2`。此bundle包括全工程音频曲线处理预算守卫，不回写先前完整矩阵结果。

## 最终安装版原生结果

上述隔离集成之后，最终安装版完成素材拖入指定轨道、片段水平/跨轨移动、两次撤销精确还原、冲突落点拒绝、曲线节点原生拖动及一次撤销。保存退出后Finder双击重开，所有片段、曲线、关键帧、转场、动画和字幕字段保留；原生1080P导出与125项独立成片检查均通过。完整包身份及逐步原生证据见 [V06-GUI-ACCEPTANCE.md](V06-GUI-ACCEPTANCE.md)，不将本文件的隔离矩阵冒称原生操作。
