import { useEffect, useRef, useState } from "react";
import { CaretLeftIcon, CaretRightIcon, DiamondIcon } from "@phosphor-icons/react";
import { audioGainKeyframes, audioGainKeyNavigation, audioGainMultiplierAt, audioGainKeyProgressAt, timelineLabel } from "../shared/model.mjs";
import { gainToDb, dbToGain, MAX_AUDIO_DB, MIN_AUDIO_DB } from "../shared/audio.mjs";
import { Button, IconButton, NumberField } from "./EditorControls.jsx";

const easingOptions = [["linear", "线性"], ["easeInOut", "缓入缓出"], ["easeIn", "缓入"], ["easeOut", "缓出"]];

export function AudioGainKeyEditor({ clip, time, fps, playing = false, onSeek, onToggle, onRemove, onEasing, onGain, onClear }) {
  const keys = audioGainKeyframes(clip), playheadNavigation = audioGainKeyNavigation(clip, time);
  const [selectedId, setSelectedId] = useState(null);
  const previousIds = useRef(new Set());
  const current = keys.find(key => key.id === selectedId) || playheadNavigation.current;
  const navigation = audioGainKeyNavigation(clip, current ? clip.start + current.time : time);
  const gain = current?.gain ?? audioGainMultiplierAt(clip, time), listRef = useRef(null), toggleRef = useRef(null);
  useEffect(() => { setSelectedId(null); previousIds.current = new Set(keys.map(key => key.id)); }, [clip.id]);
  useEffect(() => { const added = keys.find(key => !previousIds.current.has(key.id)); if (added) setSelectedId(added.id); previousIds.current = new Set(keys.map(key => key.id)); }, [clip.audioGainKeys]);
  const choose = key => { setSelectedId(key.id || null); onSeek(key); };
  useEffect(() => {
    const list = listRef.current, row = list?.querySelector('[aria-selected="true"]');
    if (!row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }, [current?.id]);
  const curve = Array.from({ length: 41 }, (_, i) => `${8 + i * 3},${48 - audioGainKeyProgressAt(current || { easing: "linear" }, i / 40) * 40}`).join(" ");
  return <section className="audio-gain-editor" aria-label="音量自动化" onKeyDown={event => {
    if ([" ", "Enter", "Delete", "Backspace"].includes(event.key)) event.stopPropagation();
  }}>
    <div className="keyframe-bar" onKeyDown={event => {
      if ([" ", "Enter", "Delete", "Backspace"].includes(event.key)) event.stopPropagation();
      if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); if (current) onRemove(current); }
    }}>
      <span>音量关键帧 <small>{keys.length}</small></span>
      <IconButton Icon={CaretLeftIcon} label="上一个音量关键帧" disabled={!navigation.previous} onClick={() => choose(navigation.previous)} />
      <span ref={toggleRef} className="audio-gain-toggle"><IconButton Icon={DiamondIcon} label={current ? "删除当前音量关键帧" : "添加音量关键帧"} data-audio-key-toggle className={current ? "active-key" : ""} onClick={() => onToggle(current)} /></span>
      <IconButton Icon={CaretRightIcon} label="下一个音量关键帧" disabled={!navigation.next} onClick={() => choose(navigation.next)} />
    </div>
    <NumberField label="自动化位置" value={current?.time ?? Math.max(0, Math.min(clip.duration, time - clip.start))} min={0} max={clip.duration} step={1 / fps} precision={6} onChange={value => choose({ time: value })} />
    <NumberField label="关键帧增益 dB" value={gainToDb(gain)} min={gain > 0 ? Math.min(MIN_AUDIO_DB, gainToDb(gain)) : MIN_AUDIO_DB} max={MAX_AUDIO_DB} step={.1} precision={2} suffix="dB" nonFiniteDisplay="−∞" disabled={playing && !current} onChange={value => onGain(dbToGain(value), current)} />
    <Button label="当前增益归零" disabled={playing && !current} onClick={() => onGain(0, current)} />
    {keys.length > 0 && <>
      <div className="keyframe-list" ref={listRef} role="listbox" aria-label="音量关键帧列表">
        {keys.map((key, index) => <button type="button" key={key.id} role="option" aria-selected={current?.id === key.id}
          tabIndex={current?.id === key.id || (!current && index === 0) ? 0 : -1}
          onClick={() => choose(key)} onKeyDown={event => {
            if ([" ", "Enter", "Delete", "Backspace", "ArrowUp", "ArrowDown"].includes(event.key)) event.stopPropagation();
            if (["Delete", "Backspace"].includes(event.key)) {
              event.preventDefault();
              const fallback = event.currentTarget.nextElementSibling || event.currentTarget.previousElementSibling || toggleRef.current?.querySelector('button');
              fallback?.focus({ preventScroll: true }); onRemove(key);
            } else if (["ArrowUp", "ArrowDown"].includes(event.key)) {
              event.preventDefault();
              const next = Math.max(0, Math.min(keys.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
              choose(keys[next]); event.currentTarget.parentElement.children[next]?.focus({ preventScroll: true });
            }
          }}>
          <DiamondIcon size={10} weight={current?.id === key.id ? "fill" : "regular"} />
          <span><strong>{index + 1} · {timelineLabel(clip.start + key.time, fps)}</strong><small>{key.gain === 0 ? "−∞" : gainToDb(key.gain).toFixed(2)} dB · {Math.round(key.gain * 100)}%</small></span>
          {current?.id === key.id && <em>当前</em>}
        </button>)}
      </div>
      <label className="field"><span>音量关键帧插值</span><select aria-label="音量关键帧插值" disabled={!current} value={current?.easing || "linear"} onChange={event => onEasing(event.target.value, current)}>
        {easingOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {current && <div className="keyframe-easing"><svg viewBox="0 0 136 56" role="img" aria-label="音量关键帧插值曲线"><path d="M8 8V48H128" fill="none" stroke="#494949" /><polyline points={curve} fill="none" stroke="#7bd4a6" strokeWidth="2" /></svg><span>{navigation.next ? "作用到下一关键帧" : "末键之后保持增益"}</span></div>}
      <Button label="清除音量关键帧" onClick={onClear} />
    </>}
    <p className="inspector-hint">关键帧是相对增益，乘以基础音量和淡化。选择一键后修改增益会更新该键，播放时选择保持不变；未选键时在播放头添加一键；无关键帧时为 0 dB（100%）。</p>
  </section>;
}
