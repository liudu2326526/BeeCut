import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { Button, IconButton, NumberField } from "./EditorControls.jsx";
import { createSpeedCurve } from "../shared/model.mjs";
import { SpeedCurveEditor } from "./SpeedCurveEditor.jsx";

export function SpeedEditor({ clip, media, timing, time, totalCurvePoints, onEdit, onAdd, onMerge, onCurveChange, onError, onGestureStart, onSeek }) {
  const segmented = timing.mode === "segments", curved = timing.mode === "curve";
  const parts = timing.segments.map(s => ({ sourceDuration: s.sourceDuration, speed: s.speed }));
  const update = (i, patch) => onEdit(parts.map((p, j) => j === i ? { ...p, ...patch } : p));
  const points = timing.segments.flatMap(s => [
    `${s.start / timing.duration * 240},${90 - s.speed / 4 * 76}`,
    `${(s.start + s.duration) / timing.duration * 240},${90 - s.speed / 4 * 76}`,
  ]).join(" ");
  return <>
    <div className="section-label">变速</div>
    <div className="preset-buttons">
      <button className={!segmented && !curved ? "active" : ""} aria-pressed={!segmented && !curved} onClick={() => onEdit(null, clip.speed || 1)}>常规变速</button>
      <button className={segmented ? "active" : ""} aria-pressed={segmented} onClick={() => onEdit(parts)}>分段变速</button>
      <button className={curved ? "active" : ""} aria-pressed={curved} onClick={() => {
        if (curved) return;
        onGestureStart?.();
        try { onCurveChange(createSpeedCurve(clip, "smooth", media)); }
        catch (error) { onError(error.message); }
      }}>平滑曲线</button>
    </div>
    {curved ? <SpeedCurveEditor clip={clip} media={media} time={time} totalPoints={totalCurvePoints} onChange={onCurveChange} onError={onError} onGestureStart={onGestureStart} onSeek={onSeek} /> : !segmented ? <NumberField label="播放倍速" value={clip.speed || 1} min={.25} max={4} step={.25} suffix="×" onChange={v => onEdit(null, v)} /> : <>
      <figure className="speed-chart">
        <svg viewBox="0 0 240 100" role="img" aria-label="分段速度阶梯图：横轴为输出时间，纵轴为倍速">
          {[1, 2, 4].map(rate => <g key={rate}><line x1="0" x2="240" y1={90 - rate / 4 * 76} y2={90 - rate / 4 * 76} stroke="#454545" strokeWidth=".6" /><text x="3" y={87 - rate / 4 * 76} fill="#8a8a8a" fontSize="8">{rate}×</text></g>)}
          <polyline points={points} fill="none" stroke="#dfc77b" strokeWidth="2" />
        </svg>
        <figcaption><span>0 秒</span><span>输出时间 →</span><span>{timing.duration.toFixed(2)} 秒</span></figcaption>
      </figure>
      <p className="inspector-hint">每段保持固定倍速，段与段之间直接切换。</p>
      <div className="speed-segments">
        {timing.segments.map((s, i) => <section className="speed-segment" key={i}>
          <header><strong>第 {i + 1} 段</strong><small>源 {s.sourceStart.toFixed(2)}–{(s.sourceStart + s.sourceDuration).toFixed(2)}s</small><IconButton Icon={TrashIcon} label={`合并第 ${i + 1} 段`} disabled={parts.length <= 1} onClick={() => onMerge(i)} /></header>
          <NumberField label={`第 ${i + 1} 段源时长`} value={s.sourceDuration} min={Math.min(.04, s.sourceDuration)} max={Math.max(s.sourceDuration, media.duration - clip.sourceStart - timing.sourceDuration + s.sourceDuration)} step={.1} onChange={v => update(i, { sourceDuration: v })} />
          <NumberField label={`第 ${i + 1} 段倍速`} value={s.speed} min={.25} max={4} step={.25} suffix="×" onChange={v => update(i, { speed: v })} />
        </section>)}
      </div>
      <Button Icon={PlusIcon} label="增加分段" onClick={onAdd} />
    </>}
    {!curved && <p className="inspector-hint">源区间 {timing.sourceDuration.toFixed(2)} 秒 · 变速后 {timing.duration.toFixed(2)} 秒。合并分段会保留素材，采用相邻段的倍速。</p>}
  </>;
}
