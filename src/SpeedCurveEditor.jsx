import { useEffect, useMemo, useRef, useState } from "react";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import {
  clipSpeedCurve, clipTiming, speedCurveSamples, speedCurvePointBounds,
  createSpeedCurve, updateSpeedCurvePoint, addSpeedCurvePoint, removeSpeedCurvePoint,
  sourceTimeAt, timelineTimeAtSource, MAX_SPEED_CURVE_POINTS,
} from "../shared/model.mjs";
import { Button, NumberField } from "./EditorControls.jsx";

const LEFT = 22, RIGHT = 260, TOP = 15, BOTTOM = 132;
const pointX = position => LEFT + position * (RIGHT - LEFT);
const rateY = rate => BOTTOM - (Math.log2(rate) + 2) / 4 * (BOTTOM - TOP);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const presets = [["smooth", "平缓 1×"], ["rampUp", "逐渐加速"], ["rampDown", "逐渐减速"], ["montage", "快慢交替"]];

export function SpeedCurveEditor({ clip, media, time, totalPoints, onChange, onError, onGestureStart, onSeek }) {
  const [selectedId, setSelectedId] = useState(() => clipSpeedCurve(clip)?.points[0]?.id);
  const [draftClip, setDraftClip] = useState(null);
  const svgRef = useRef(null), dragRef = useRef(null), callbacksRef = useRef(null);
  const shownClip = draftClip || clip, curve = clipSpeedCurve(shownClip), timing = clipTiming(shownClip);
  const samples = useMemo(() => speedCurveSamples(shownClip, 161), [shownClip]);
  const polyline = useMemo(() => samples.map(sample => `${pointX(sample.position)},${rateY(sample.rate)}`).join(" "), [samples]);
  const selected = curve?.points.find(point => point.id === selectedId) || curve?.points[0];
  const bounds = selected ? speedCurvePointBounds(shownClip, selected.id) : null;
  const position = curve ? clamp((sourceTimeAt(shownClip, time) - shownClip.sourceStart) / curve.sourceDuration, 0, 1) : 0;
  const finishDrag = (commit, pointerId) => {
    const drag = dragRef.current;
    if (!drag || (pointerId !== undefined && pointerId !== drag.pointerId)) return;
    dragRef.current = null;
    setDraftClip(null);
    if (svgRef.current?.hasPointerCapture(drag.pointerId)) svgRef.current.releasePointerCapture(drag.pointerId);
    if (commit && drag.moved && drag.next !== drag.base) commitCurve(drag.next);
  };
  useEffect(() => {
    if (dragRef.current && dragRef.current.base !== clip) finishDrag(false);
    const points = clipSpeedCurve(clip)?.points || [];
    setSelectedId(id => points.some(point => point.id === id) ? id : points[0]?.id);
  }, [clip]);
  useEffect(() => {
    const down = () => callbacksRef.current.finish(false);
    const move = event => callbacksRef.current.move(event);
    const up = event => callbacksRef.current.finish(true, event.pointerId);
    const cancel = event => callbacksRef.current.finish(false, event.pointerId);
    const blur = event => { if (event.target === window) callbacksRef.current.finish(false); };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", blur, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", blur, true);
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag && svgRef.current?.hasPointerCapture(drag.pointerId)) svgRef.current.releasePointerCapture(drag.pointerId);
    };
  }, []);
  function commitCurve(next) {
    const nextCurve = clipSpeedCurve(next);
    if (totalPoints - (clipSpeedCurve(clip)?.points.length || 0) + (nextCurve?.points.length || 0) > MAX_SPEED_CURVE_POINTS) {
      onError(`工程最多支持 ${MAX_SPEED_CURVE_POINTS} 个速度曲线节点，请先删除一些节点`);
      return false;
    }
    onChange(next);
    return true;
  }
  function act(action) {
    onGestureStart?.();
    try { const next = action(); return next === clip || commitCurve(next) ? next : null; }
    catch (error) { onError(error.message || "无法修改这条速度曲线"); return null; }
  }
  function selectPoint(point) {
    setSelectedId(point.id);
    onGestureStart?.();
    onSeek?.(timelineTimeAtSource(clip, clip.sourceStart + point.position * clipSpeedCurve(clip).sourceDuration));
  }
  function beginDrag(event, point) {
    if (event.button !== 0) return;
    svgRef.current?.focus({ preventScroll: true });
    event.preventDefault();
    event.stopPropagation();
    selectPoint(point);
    dragRef.current = { base: clip, next: clip, pointId: point.id, pointerId: event.pointerId, moved: false };
    svgRef.current.setPointerCapture(event.pointerId);
  }
  function moveDrag(event) {
    const drag = dragRef.current, svg = svgRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    try {
      const next = updateSpeedCurvePoint(drag.base, drag.pointId, {
        position: clamp((point.x - LEFT) / (RIGHT - LEFT), 0, 1),
        speed: 2 ** (clamp((BOTTOM - point.y) / (BOTTOM - TOP), 0, 1) * 4 - 2),
      }, media);
      drag.next = next;
      drag.moved = true;
      setDraftClip(next);
    } catch (error) {
      const message = error.message || "无法修改这条速度曲线";
      if (!drag.error) onError(message);
      drag.error = message;
    }
  }
  function keyPoint(event, point) {
    const step = event.shiftKey ? .05 : .01;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (["ArrowLeft", "ArrowRight"].includes(event.key) && speedCurvePointBounds(clip, point.id).fixed) return;
      setSelectedId(point.id);
      const patch = event.key === "ArrowLeft" ? { position: point.position - step } : event.key === "ArrowRight" ? { position: point.position + step }
        : { speed: point.speed + (event.key === "ArrowUp" ? step : -step) };
      act(() => updateSpeedCurvePoint(clip, point.id, patch, media));
    } else if (["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      removePoint(point);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation(); selectPoint(point);
    }
  }
  function addPoint() {
    const points = curve.points;
    let index = 0;
    for (let i = 1; i < points.length - 1; i++)
      if (points[i + 1].position - points[i].position > points[index + 1].position - points[index].position) index = i;
    const next = act(() => addSpeedCurvePoint(clip, (points[index].position + points[index + 1].position) / 2, undefined, media));
    if (next) setSelectedId(clipSpeedCurve(next).points.find(point => !points.some(old => old.id === point.id))?.id || selectedId);
  }
  function removePoint(point) {
    if (speedCurvePointBounds(clip, point.id).fixed) return;
    svgRef.current?.focus({ preventScroll: true });
    const index = curve.points.findIndex(item => item.id === point.id), next = act(() => removeSpeedCurvePoint(clip, point.id, media));
    if (next) setSelectedId(clipSpeedCurve(next).points[Math.max(0, index - 1)].id);
  }
  callbacksRef.current = { move: moveDrag, finish: finishDrag };
  if (!curve) return null;
  return <>
    <label className="field"><span>速度预设</span><select aria-label="速度曲线预设" value="" onChange={event => {
      const next = act(() => createSpeedCurve(clip, event.target.value, media));
      if (next) setSelectedId(clipSpeedCurve(next).points[0].id);
    }}><option value="" disabled>自定义 / 选择预设</option>{presets.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <figure className={`speed-curve${draftClip ? " is-dragging" : ""}`}>
      <svg ref={svgRef} viewBox="0 0 280 156" tabIndex={-1} role="group" aria-label="平滑速度曲线，横轴为源素材位置，纵轴为倍速。拖动节点或用方向键微调。"
        onLostPointerCapture={event => finishDrag(false, event.pointerId)} onKeyDown={event => {
          if (event.key === "Escape" && dragRef.current) { event.preventDefault(); event.stopPropagation(); finishDrag(false); }
          else if (selected) keyPoint(event, selected);
        }}>
        {[.25, .5, 1, 2, 4].map(rate => <g key={rate}><line x1={LEFT} x2={RIGHT} y1={rateY(rate)} y2={rateY(rate)} stroke={rate === 1 ? "#505756" : "#363b3a"} strokeWidth=".7" /><text x="2" y={rateY(rate) + 3}>{rate}×</text></g>)}
        <line x1={pointX(position)} x2={pointX(position)} y1={TOP} y2={BOTTOM} stroke="#82a4a4" strokeDasharray="3 3" strokeWidth=".8" />
        <polyline points={polyline} fill="none" stroke="#dfc77b" strokeWidth="2" />
        {curve.points.map((point, index) => <g key={point.id} role="button" tabIndex={0}
          aria-label={`速度曲线节点 ${index + 1}，源位置 ${(clip.sourceStart + point.position * curve.sourceDuration).toFixed(3)} 秒，${point.speed.toFixed(3)} 倍`}
          aria-pressed={point.id === selected?.id} className={point.id === selected?.id ? "curve-node is-selected" : "curve-node"}
          onPointerDown={event => beginDrag(event, point)} onKeyDown={event => keyPoint(event, point)}>
          <circle cx={pointX(point.position)} cy={rateY(point.speed)} r="10" fill="transparent" />
          <circle cx={pointX(point.position)} cy={rateY(point.speed)} r="4.5" />
        </g>)}
        <text x={LEFT} y="150">{clip.sourceStart.toFixed(2)}s</text><text x="140" y="150" textAnchor="middle">源素材位置 →</text><text x={RIGHT} y="150" textAnchor="end">{timing.sourceEnd.toFixed(2)}s</text>
      </svg>
      <figcaption>连续平滑速度 · {curve.points.length} 个节点{draftClip ? " · 松手应用，Esc 取消" : ""}</figcaption>
    </figure>
    {selected && <>
      <div className="curve-node-header"><span>节点 {curve.points.indexOf(selected) + 1}{bounds.fixed ? " · 固定端点" : " · 自定义"}</span><small>{selected.speed.toFixed(2)}×</small></div>
      <NumberField key={`${selected.id}-source`} label="节点源位置" value={clip.sourceStart + selected.position * curve.sourceDuration} min={clip.sourceStart + bounds.min * curve.sourceDuration} max={clip.sourceStart + bounds.max * curve.sourceDuration}
        step={.01} precision={6} disabled={bounds.fixed || !!draftClip} onChange={value => act(() => updateSpeedCurvePoint(clip, selected.id, { position: (value - clip.sourceStart) / curve.sourceDuration }, media))} />
      <NumberField key={`${selected.id}-speed`} label="节点倍速" value={selected.speed} min={bounds.minSpeed} max={bounds.maxSpeed} step={.05} precision={6} suffix="×" disabled={!!draftClip}
        onChange={speed => act(() => updateSpeedCurvePoint(clip, selected.id, { speed }, media))} />
      <div className="inspector-actions compact"><Button Icon={PlusIcon} label="增加节点" disabled={!!draftClip} onClick={addPoint} /><Button Icon={TrashIcon} label="删除节点" disabled={bounds.fixed || !!draftClip} onClick={() => removePoint(selected)} /></div>
    </>}
    <p className="curve-duration"><span>保留源时长 <strong>{timing.sourceDuration.toFixed(3)}s</strong></span><span>变速后 <strong>{timing.duration.toFixed(3)}s</strong></span></p>
    <p className="inspector-hint">拖节点或精确输入位置和倍速。首尾位置固定；横向是源素材时间，输出时长按整条曲线计算。方向键微调，Shift 加大步长。</p>
  </>;
}
