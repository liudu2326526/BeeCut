# 0.6 原生拖拽结束事件诊断

2026-10-18。本轮候选曾通过隔离 DOM/CDP 指针检查，但原生控制发现拖动只出现 ghost、释放后没有落位。失败记录保留，不能算成验收通过。其原始 ZIP 已保留于 `artifacts/v06-20261018/pre-native-drag-fix-package/`，不是最终交付包。

## 实际证据

正常保存并退出，在**已安装副本**的 UI asset 末尾临时追加被动事件观察器并重新签名。观察器只记64条事件，以 Ctrl+Alt+D 显示；不调用业务函数、保存、提交、取消或指针捕获。原 release 和冻结生产源保持独立。临时副本须在最终交付前被正常 release 替换，并重新做文件同一性验证。

[原生片段事件](artifacts/v06-20261018/native-drag-diagnostic-raw.ax.txt) 中，真实系统事件顺序为：

1. trusted `pointerdown`，pointerId=1，buttons=1，目标是片段内缩略图。
2. 约7ms后 trusted `pointermove`，pointerId=1，buttons=0，目标仍是原片段；没有 `gotpointercapture` 或 `lostpointercapture`。
3. trusted `pointerup` 与 `mouseup`，目标已是**轨道容器**。窗口确实收到松手，原片段没有收到其节点终结回调。
4. 终结后 ghost 和原片段的拖动样式仍在。Esc 可以取消，工程未提交。

旧实现把终结只挂到原片段节点，因而无法覆盖已观察到的“捕获未建立、松手重定向到轨道”路径。这一证据不等于所有实体鼠标在所有 Mac 上都失败，也不能仅归咎于控制工具。

[原生素材库事件](artifacts/v06-20261018/native-library-diagnostic-raw.ax.txt) 记录 down→move(buttons=0)→HTML5 dragstart→pointercancel，没有可确认的 drop/dragend；不把出现素材卡片 ghost 算成导入轨道成功。

Retina截图是2倍物理像素。此次环境的原生 drag 坐标采用截图像素，记录到 DOM 的 clientXY 为像素/2，并扣除28点原生标题栏。AX点击和坐标点击另有命中语义；早期 `21-*`、`22-*` 文件名/操作备注只是尝试，不代表成功，实际轨道仍为0片段。最终结论以每次操作后的 UI 和保存工程字段为准。

## 结构修复与验证状态

修复将由窗口统一拥有活跃指针手势的移动与真实终结，按 pointerId 匹配实际 pointerup 提交；pointercancel、窗口失焦和Esc取消。不会把 buttons=0 本身当作提交许可。内部素材库拖放复用同一落点、ghost、撤销和结束逻辑，避免另走异步 OS HTML5 拖拽事务；普通点击、AX/键盘添加和外部本机文件导入另行保留。

曲线图的指针手势也审查相同终结边界。生产源修改后的隔离回归、最终打包身份及**修复后原生实际拖放**将在最终 GUI 验收报告中记录；本诊断记录本身不代替这些检查。

## 最终原生复验

最终 release 已替换临时诊断副本，384 项文件/链接与安装版完全一致，严格签名通过；临时观察器已退役。最终 ZIP SHA 为 `d4e027118ab8467e9c4e6b0cd9e678b2de8d6139715cac4157c7e345faa7eeb9`。

最终安装版重新完成素材库→轨道、同轨移动、跨轨移动、连续撤销、碰撞拒绝、速度曲线节点原生拖动与一次撤销；保存后的只读工程字段和截图验证实际落位，未用 ghost 作为成功证据。详细步骤和收据见 [V06-GUI-ACCEPTANCE.md](V06-GUI-ACCEPTANCE.md) 及 [最终拖动核对](artifacts/v06-20261018/native-final-drag-validation.json)。同一包随后完成正常退出、Finder 双击重开及真实1080P导出，成片独立检查125/125通过。
