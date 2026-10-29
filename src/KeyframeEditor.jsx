import { useEffect, useRef } from "react";
import { CaretLeftIcon, CaretRightIcon, DiamondIcon } from "@phosphor-icons/react";
import { transformKeyProgressAt, timelineLabel, transformKeyframes, transformKeyNavigation } from "../shared/model.mjs";
import { Button, IconButton } from "./EditorControls.jsx";

const easingOptions = [["linear", "线性"], ["easeInOut", "缓入缓出"], ["easeIn", "缓入"], ["easeOut", "缓出"]];

export function KeyframeEditor({ clip, time, fps, onSeek, onToggle, onRemove, onEasing, onClear, children }) {
  const keys = transformKeyframes(clip), navigation = transformKeyNavigation(clip, time);
  const current = navigation.current, listRef = useRef(null);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector('[aria-selected="true"]');
    if (!active) return;
    const top = active.offsetTop, bottom = top + active.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [current?.id]);
  const curve = Array.from({ length: 41 }, (_, i) => `${8 + i / 40 * 120},${48 - transformKeyProgressAt(current || { easing: "linear" }, i / 40) * 40}`).join(" ");
  return <>
    <div className="keyframe-bar" onKeyDown={event => {
      if ([" ", "Enter"].includes(event.key)) event.stopPropagation();
      if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (current) onRemove(current); }
    }}>
      <span>变换关键帧 <small>{keys.length}</small></span>
      <IconButton Icon={CaretLeftIcon} label="上一个变换关键帧" disabled={!navigation.previous} onClick={() => onSeek(navigation.previous)} />
      <IconButton Icon={DiamondIcon} label={current ? "删除当前变换关键帧" : "添加变换关键帧"} data-keyframe-toggle className={current ? "active-key" : ""} onClick={onToggle} />
      <IconButton Icon={CaretRightIcon} label="下一个变换关键帧" disabled={!navigation.next} onClick={() => onSeek(navigation.next)} />
    </div>
    {keys.length > 0 ? <>
      <div className="keyframe-list" ref={listRef} role="listbox" aria-label="变换关键帧列表">
        {keys.map((key, index) => <button type="button" key={key.id} role="option" aria-selected={current?.id === key.id}
          tabIndex={current?.id === key.id || (!current && index === 0) ? 0 : -1}
          onClick={() => onSeek(key)} title={`第 ${index + 1} 个关键帧，片内 ${key.time.toFixed(3)} 秒`}
          onKeyDown={event => {
            if ([" ", "Enter"].includes(event.key)) event.stopPropagation();
            if (["Delete", "Backspace"].includes(event.key)) {
              event.preventDefault(); event.stopPropagation();
              const fallback = event.currentTarget.nextElementSibling || event.currentTarget.previousElementSibling
                || listRef.current?.previousElementSibling?.querySelector('[data-keyframe-toggle]');
              fallback?.focus({ preventScroll: true });
              onRemove(key);
            }
            else if (["ArrowUp", "ArrowDown"].includes(event.key)) {
              event.preventDefault(); event.stopPropagation();
              const nextIndex = Math.max(0, Math.min(keys.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
              onSeek(keys[nextIndex]); event.currentTarget.parentElement.children[nextIndex]?.focus({ preventScroll: true });
            }
          }}>
          <DiamondIcon size={10} weight={current?.id === key.id ? "fill" : "regular"} />
          <span><strong>{index + 1} · {timelineLabel(clip.start + key.time, fps)}</strong><small>{Math.round(key.values.scale * 100)}% · X {Number(key.values.x.toFixed(1))} · Y {Number(key.values.y.toFixed(1))}</small></span>
          {current?.id === key.id && <em>当前</em>}
        </button>)}
      </div>
      <p className="keyframe-context">{current ? `第 ${keys.indexOf(current) + 1} 个关键帧 · 片内 ${current.time.toFixed(3)} 秒` : "播放头位于关键帧之间；修改变换会添加新键"}</p>
    </> : <p className="inspector-hint">在不同时间添加菱形，画面会在两次姿态之间变化。</p>}
    {children}
    {keys.length > 0 && <>
      <label className="field"><span>关键帧插值</span><select aria-label="关键帧插值" disabled={!current} value={current?.easing || "linear"} onChange={e => onEasing(e.target.value)}>
        {easingOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {current && <div className="keyframe-easing"><svg viewBox="0 0 136 56" aria-label="当前关键帧到下一帧的插值曲线" role="img"><path d="M8 8V48H128" fill="none" stroke="#494949" /><polyline points={curve} fill="none" stroke="#48c7cd" strokeWidth="2" /></svg><span>{navigation.next ? "作用到下一关键帧" : "末键之后保持姿态"}</span></div>}
      <p className="inspector-hint">点击列表或时间线菱形定位；五项变换作为一组记录。</p>
      <Button label="清除变换关键帧" onClick={onClear} />
    </>}
  </>;
}
