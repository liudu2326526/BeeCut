import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ArrowUUpLeft,
  ArrowUUpRight,
  CaretDown,
  Copy,
  Cursor,
  FilmStrip,
  LinkSimple,
  Magnet,
  Minus,
  Plus,
  Scissors,
  SkipBack,
  SpeakerHigh,
  Stack,
  TextT,
  Trash,
  Diamond,
} from "@phosphor-icons/react";
import { projectDuration, timelineLabel, clipLayer, inspectTransitions, clipTrimBounds, trimClip, transformKeyframes, transformKeyNavigation, AUDIO_LANE_COUNT, projectAudioLanes, audioGainKeyframes, audioGainKeyNavigation } from "../shared/model.mjs";
import { resolveTimelinePlacement, TIMELINE_END_LIMIT } from "../shared/timeline-placement.mjs";
import { contentTime, edgeScrollVelocity, finishTimelineGesture } from "./timeline-gesture.mjs";
import { transitionLabel } from "../shared/effects.mjs";
import { ClipWaveform } from "./ClipWaveform.jsx";
import { audioLaneLayout, audioClipTop } from "./audio-lane-layout.mjs";
import "./timeline.css";

const MIN_DURATION = 0.1;
const clamp = (value, min, max) =>
  Math.min(Math.max(value, min), Math.max(min, max));
const rulerTime = (value) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

function ToolButton({ label, children, disabled, onClick, active = false }) {
  return (
    <button
      type="button"
      className={`tl-tool${active ? " is-active" : ""}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const Timeline = forwardRef(function Timeline({
  project,
  time,
  onSeek,
  selected,
  onSelect,
  onTrimClip,
  onMoveClip,
  onEditSubtitle,
  onDropMedia,
  onSplit,
  onDelete,
  onDuplicate,
  onSelectTransition,
  onSelectTransformKey,
  onSelectAudioKey,
  activeAudioLane = 0,
  onSelectAudioLane,
  onEditAudioLane,
  onGestureStart,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  zoom = 44,
  onZoom,
}, ref) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const headersRef = useRef(null);
  const trackRefs = useRef(new Map());
  const gestureRef = useRef(null);
  const mediaClickRef = useRef(null);
  const updateGestureRef = useRef(null), endGestureRef = useRef(null), beginMediaRef = useRef(null);
  const [gesture, setGesture] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [snap, setSnap] = useState(true);
  const mediaById = useMemo(
    () => new Map(project.media.map((media) => [media.id, media])),
    [project.media],
  );
  const duration = projectDuration(project);
  const transitions = useMemo(() => inspectTransitions(project).transitions, [project]);
  const videoLayers = [3, 2, 1, 0];
  const audioLanes = projectAudioLanes(project);
  const audioLayout = useMemo(() => audioLaneLayout(project.clips, AUDIO_LANE_COUNT), [project.clips]);
  const extending = gesture?.resolution?.placement;
  const totalTime = Math.min(TIMELINE_END_LIMIT + 2, Math.max(30, duration + 8, extending ? extending.start + (gesture?.resolution?.duration || 0) + 8 : 0));
  const width = Math.max(920, totalTime * zoom);
  const rulerStep = zoom < 22 ? 10 : zoom < 60 ? 5 : 2;
  const frameTime = (value) => Math.round(value * project.fps) / project.fps;
  const preview = (kind, item) =>
    gesture?.kind === kind && gesture.id === item.id && !(kind === "clip" && gesture.mode === "move")
      ? { ...item, ...gesture.patch }
      : item;
  const selectedClip =
    selected?.kind === "clip" &&
    project.clips.find((clip) => clip.id === selected.id);
  const canSplit =
    selectedClip &&
    time > selectedClip.start + 0.04 &&
    time < selectedClip.start + selectedClip.duration - 0.04;
  const placementPreview = ["clip", "media"].includes(gesture?.kind) && gesture.mode === "move" && gesture.moved ? gesture : null;
  const targetIs = (track, layer) => placementPreview?.target?.track === track && placementPreview.target.layer === layer;
  const targetClass = (track, layer) => targetIs(track, layer) ? ` is-drop-target${placementPreview.resolution?.ok ? "" : " is-drop-invalid"}` : "";

  function showAudioTrack(lane = selectedClip?.track === "audio" ? clipLayer(selectedClip) : activeAudioLane) {
    const scroll = scrollRef.current, track = trackRefs.current.get(`audio:${lane}`);
    if (!scroll || !track) return;
    const selectedRow = selectedClip?.track === "audio" && clipLayer(selectedClip) === lane
      ? audioClipTop(audioLayout[lane], selectedClip.id) : null;
    const top = track.offsetTop + (selectedRow ?? 0);
    const bottom = top + (selectedRow === null ? Math.min(track.offsetHeight, 52) : 38);
    const rulerHeight = contentRef.current?.querySelector('.tl-ruler')?.offsetHeight || 29;
    if (bottom > scroll.scrollTop + scroll.clientHeight)
      scroll.scrollTop = bottom - scroll.clientHeight + 8;
    else if (top < scroll.scrollTop + rulerHeight) scroll.scrollTop = Math.max(0, top - rulerHeight);
  }
  useEffect(() => {
    if (selectedClip?.track === "audio") showAudioTrack();
  }, [selectedClip?.id, selectedClip?.layer, audioLayout]);
  useEffect(() => {
    const current = gestureRef.current;
    if (!current) return;
    const item = (current.kind === 'media' ? project.media : current.kind === 'clip' ? project.clips : project.subtitles).find(item => item.id === current.id);
    if (!item || (current.kind !== 'media' && (item.start !== current.original.start || item.duration !== current.original.duration || (current.kind === 'clip' && clipLayer(item) !== clipLayer(current.original)))))
      endGesture({ pointerId: current.pointerId }, true);
  }, [project]);

  const seekAt = (event) => {
    const bounds = contentRef.current.getBoundingClientRect();
    onSeek(clamp(contentTime(event.clientX, bounds.left, zoom), 0, totalTime));
  };

  function trackAt(clientY, clientX) {
    const viewport = scrollRef.current?.getBoundingClientRect();
    const ruler = contentRef.current?.querySelector('.tl-ruler')?.getBoundingClientRect();
    if (!viewport || clientX < viewport.left || clientX > viewport.right || clientY < (ruler?.bottom ?? viewport.top) || clientY > viewport.bottom) return null;
    for (const [key, element] of trackRefs.current) {
      const bounds = element.getBoundingClientRect();
      if (clientY >= bounds.top && clientY < bounds.bottom) {
        const [track, layer] = key.split(':');
        return { track, layer: Number(layer) };
      }
    }
    return null;
  }
  function placementFor(request) {
    return resolveTimelinePlacement(project, request, { snap, zoom, time });
  }
  function noTrack() {
    return { ok: false, message: "请将片段拖到目标轨道内再松开", placement: null };
  }

  function snapTime(value, original, kind) {
    if (!snap) return frameTime(value);
    const points = [
      0,
      time,
      ...project.clips
        .filter((clip) => clip.id !== original.id)
        .flatMap((clip) => [clip.start, clip.start + clip.duration]),
      ...project.subtitles
        .filter((subtitle) => subtitle.id !== original.id)
        .flatMap((subtitle) => [
          subtitle.start,
          subtitle.start + subtitle.duration,
        ]),
    ];
    let result = value;
    let distance = 7 / zoom;
    for (const point of points) {
      const nextDistance = Math.abs(point - value);
      if (nextDistance < distance) {
        distance = nextDistance;
        result = point;
      }
    }
    return frameTime(result);
  }

  function beginGesture(event, kind, item, mode = "move") {
    if (event.button !== 0) return;
    if (gestureRef.current) endGestureRef.current({ pointerId: gestureRef.current.pointerId }, true);
    event.currentTarget.closest('[role="button"]')?.focus({ preventScroll: true });
    event.preventDefault();
    event.stopPropagation();
    onSelect({ kind, id: item.id });
    onGestureStart?.();
    setFeedback("");
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = contentRef.current.getBoundingClientRect();
    const next = {
      kind,
      id: item.id,
      mode,
      original: item,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      originTime: contentTime(event.clientX, bounds.left, zoom),
      grabOffset: contentTime(event.clientX, bounds.left, zoom) - item.start,
      patch: {},
      moved: false,
    };
    gestureRef.current = next;
    setGesture(next);
  }

  function beginMediaGesture(event, id) {
    if (event.button !== 0 || !mediaById.has(id)) return false;
    if (gestureRef.current) endGestureRef.current({ pointerId: gestureRef.current.pointerId }, true);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    onGestureStart?.();
    setFeedback("");
    // Capture is useful while available. Window owns completion even when the
    // platform releases pending capture before the next pointer event.
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { kind: 'media', mode: 'move', id, pointerId: event.pointerId,
      captureTarget: event.currentTarget, clientX: event.clientX, clientY: event.clientY,
      pointerX: event.clientX, pointerY: event.clientY, moved: false, patch: {} };
    gestureRef.current = next;
    setGesture(next);
    return true;
  }
  beginMediaRef.current = beginMediaGesture;
  useImperativeHandle(ref, () => ({
    beginMediaGesture: (event, id) => beginMediaRef.current(event, id),
    consumeMediaClick: (id, event) => {
      const pending = mediaClickRef.current;
      if (!pending || pending.id !== id) return false;
      mediaClickRef.current = null;
      // AX/keyboard activation has detail 0 and remains an ordinary Add.
      if (!event.detail) return false;
      const pointerId = event.pointerId ?? event.nativeEvent?.pointerId;
      return pointerId === undefined || pointerId === pending.pointerId;
    },
  }), []);

  function moveGesture(event) {
    const current = gestureRef.current;
    if (!current || (event.pointerId !== undefined && event.pointerId !== current.pointerId)) return;
    const { original, kind, mode } = current;
    const pointerTime = contentTime(event.clientX, contentRef.current.getBoundingClientRect().left, zoom);
    const delta = pointerTime - current.originTime;
    let patch, target, resolution, attempt;
    if (mode === "move") {
      if (kind === "clip" || kind === "media") {
        target = trackAt(event.clientY, event.clientX);
        const start = Math.max(0, frameTime(pointerTime - (current.grabOffset || 0)));
        attempt = target ? { start, ...target } : null;
        resolution = target ? placementFor({ ...(kind === 'media' ? { mediaId: current.id } : { clipId: original.id }), ...attempt }) : noTrack();
        patch = resolution.ok ? resolution.placement : {};
      } else patch = { start: Math.max(0, snapTime(original.start + delta, original, kind)) };
    } else if (mode === "left") {
      const media = kind === "clip" ? mediaById.get(original.mediaId) : null;
      let minStart =
        kind === "clip" ? clipTrimBounds(original, media).minStart : 0;
      if (kind === "clip" && original.track === "video") {
        minStart = Math.max(
          minStart,
          ...project.clips
            .filter(
              (clip) =>
                clip.id !== original.id &&
                clip.track === "video" &&
                clipLayer(clip) === clipLayer(original) &&
                clip.start + clip.duration <= original.start + 0.001,
            )
            .map((clip) => clip.start + clip.duration),
        );
      }
      const start = clamp(
        snapTime(original.start + delta, original, kind),
        Math.max(0, minStart),
        original.start + original.duration - MIN_DURATION,
      );
      patch = kind === "clip" ? trimClip(original, { start, end: original.start + original.duration }, media)
        : { start, duration: original.start + original.duration - start };
    } else {
      const media = kind === "clip" ? mediaById.get(original.mediaId) : null;
      let maxEnd =
        kind === "clip" ? clipTrimBounds(original, media).maxEnd : Infinity;
      if (kind === "clip" && original.track === "video") {
        maxEnd = Math.min(
          maxEnd,
          ...project.clips
            .filter(
              (clip) =>
                clip.id !== original.id &&
                clip.track === "video" &&
                clipLayer(clip) === clipLayer(original) &&
                clip.start >= original.start + original.duration - 0.001,
            )
            .map((clip) => clip.start),
        );
      }
      const end = clamp(
        snapTime(original.start + original.duration + delta, original, kind),
        original.start + MIN_DURATION,
        maxEnd,
      );
      patch = kind === "clip" ? trimClip(original, { end }, media) : { duration: end - original.start };
    }
    const next = {
      ...current,
      patch,
      target, resolution, attempt,
      pointerX: event.clientX, pointerY: event.clientY,
      moved: current.moved || Math.max(Math.abs(event.clientX - current.clientX), Math.abs(event.clientY - current.clientY)) > 2,
    };
    gestureRef.current = next;
    setGesture(next);
  }

  function endGesture(event, cancel = false) {
    if (!cancel && gestureRef.current) moveGesture(event);
    const current = gestureRef.current;
    if (!current) return;
    if (event.pointerId !== undefined && event.pointerId !== current.pointerId) return;
    gestureRef.current = null;
    setGesture(null);
    if (current.kind === 'media' && (current.moved || cancel)) mediaClickRef.current = { id: current.id, pointerId: current.pointerId };
    if (current.captureTarget.hasPointerCapture(current.pointerId)) current.captureTarget.releasePointerCapture(current.pointerId);
    const outcome = finishTimelineGesture(current, cancel);
    if (outcome.type === 'cancelled') setFeedback("已取消拖动，工程未修改");
    else if (outcome.type === 'rejected') setFeedback(outcome.message);
    else if (outcome.type === 'subtitle') onEditSubtitle(outcome.id, outcome.patch);
    else if (outcome.type === 'move') onMoveClip(outcome.id, outcome.placement);
    else if (outcome.type === 'media') onDropMedia(outcome.id, outcome.placement.track, outcome.placement.start, outcome.placement.layer);
    else if (outcome.type === 'trim') onTrimClip(outcome.id, outcome.bounds);
  }

  updateGestureRef.current = moveGesture;
  endGestureRef.current = endGesture;
  useEffect(() => {
    const matches = event => gestureRef.current && event.pointerId === gestureRef.current.pointerId;
    const move = event => { if (matches(event)) updateGestureRef.current(event); };
    const up = event => { if (matches(event)) endGestureRef.current(event); };
    const pointerCancel = event => { if (matches(event)) endGestureRef.current(event, true); };
    const lostCapture = event => { if (matches(event) && event.target === gestureRef.current.captureTarget) endGestureRef.current(event, true); };
    const blur = event => { if (event.target === window && gestureRef.current) endGestureRef.current({ pointerId: gestureRef.current.pointerId }, true); };
    const down = () => {
      // A new press cannot complete a previous press whose release was lost.
      if (gestureRef.current) endGestureRef.current({ pointerId: gestureRef.current.pointerId }, true);
      mediaClickRef.current = null;
    };
    const cancel = event => { if (event.key === "Escape" && gestureRef.current) { event.preventDefault(); endGestureRef.current({ pointerId: gestureRef.current.pointerId }, true); } };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', pointerCancel, true);
    window.addEventListener('lostpointercapture', lostCapture, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('blur', blur, true);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', pointerCancel, true);
      window.removeEventListener('lostpointercapture', lostCapture, true);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('blur', blur, true);
      window.removeEventListener('keydown', cancel);
    };
  }, []);
  useEffect(() => () => {
    const current = gestureRef.current;
    gestureRef.current = null;
    if (current?.captureTarget.hasPointerCapture(current.pointerId)) current.captureTarget.releasePointerCapture(current.pointerId);
  }, []);
  useEffect(() => {
    if (!gesture) return;
    let frame, previous;
    const tick = now => {
      const current = gestureRef.current, scroll = scrollRef.current;
      if (!current || !scroll) return;
      if (!current.moved) { previous = now; frame = requestAnimationFrame(tick); return; }
      const bounds = scroll.getBoundingClientRect();
      const elapsed = Math.min(32, previous === undefined ? 16 : now - previous) / 1000;
      previous = now;
      const x = current.pointerX, y = current.pointerY;
      const dx = edgeScrollVelocity(x, bounds.left, bounds.right) * elapsed;
      const top = contentRef.current.querySelector('.tl-ruler').getBoundingClientRect().bottom;
      const dy = edgeScrollVelocity(y, top, bounds.bottom, 30, 420) * elapsed;
      const beforeX = scroll.scrollLeft, beforeY = scroll.scrollTop;
      scroll.scrollLeft += dx; scroll.scrollTop += dy;
      if (scroll.scrollLeft !== beforeX || scroll.scrollTop !== beforeY) {
        if (gestureRef.current) updateGestureRef.current({ clientX: x, clientY: y });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [!!gesture]);

  function renderGhost(track, layer) {
    if (!targetIs(track, layer)) return null;
    const { resolution, attempt } = placementPreview;
    const placement = resolution.placement || attempt;
    const length = resolution.duration || (gesture?.original?.duration ?? 1);
    const name = gesture?.kind === 'media' ? mediaById.get(gesture.id)?.name : mediaById.get(gesture.original.mediaId)?.name;
    return <div className={`tl-placement-ghost${resolution.ok ? '' : ' is-invalid'}`} data-testid="timeline-placement-ghost" data-placement-valid={String(!!resolution.ok)}
      style={{ left: placement.start * zoom, width: Math.max(8, length * zoom) }}>
      <strong>{name}</strong><span>{resolution.ok ? timelineLabel(placement.start, project.fps) : resolution.message}</span>
    </div>;
  }

  const renderClip = (raw) => {
    const clip = preview("clip", raw);
    const media = mediaById.get(clip.mediaId);
    const active = selected?.kind === "clip" && selected.id === clip.id;
    const currentKey = transformKeyNavigation(clip, time).current;
    const audioKeys = audioGainKeyframes(clip), currentAudioKey = audioGainKeyNavigation(clip, time).current;
    return (
      <div
        key={clip.id}
        tabIndex={0}
        role="button"
        aria-label={`${media?.name || "未找到素材"}，${clip.track === "audio" ? `音频轨道 ${clipLayer(clip) + 1}` : `画面轨道 ${clipLayer(clip)}`}片段，${clip.duration.toFixed(1)}秒`}
        data-testid={`timeline-clip-${clip.id}`}
        title={`${media?.name || "未找到素材"} · ${timelineLabel(clip.duration, project.fps)}`}
        className={`tl-clip tl-${clip.track}-clip${active ? " is-selected" : ""}${gesture?.id === clip.id ? " is-dragging" : ""}${gesture?.id === clip.id && gesture.mode === 'move' && gesture.moved ? ' is-drag-origin' : ''}`}
        style={{
          left: clip.start * zoom,
          width: Math.max(8, clip.duration * zoom),
          ...(clip.track === "audio" ? { top: audioClipTop(audioLayout[clipLayer(raw)], raw.id), height: 38 } : {}),
        }}
        onPointerDown={(event) => beginGesture(event, "clip", raw)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onSelect({ kind: "clip", id: raw.id });
            onSeek(raw.start);
          }
        }}
      >
        <span className="tl-clip-caption">
          {clip.track === "audio" && <SpeakerHigh size={10} />}
          <span>{media?.name || "未找到素材"}</span>
          <small>{timelineLabel(clip.duration, project.fps)}</small>
        </span>
        {clip.track === "video" && (
          <span
            className="tl-frames"
            style={
              media?.thumbnailUrl
                ? { backgroundImage: `url("${media.thumbnailUrl}")` }
                : {}
            }
          >
            {!media?.thumbnailUrl && <FilmStrip size={24} />}
          </span>
        )}
        <ClipWaveform clip={clip} media={media} layoutKey={clip.track === "audio"
          ? audioLayout.slice(0, clipLayer(raw)).reduce((height, lane) => height + lane.height, 0) + audioClipTop(audioLayout[clipLayer(raw)], raw.id)
          : undefined} />
        {clip.track === "video" && active && <span className="tl-keyframes">
          {transformKeyframes(clip).map(key => <button key={key.id} type="button"
            className={`tl-keyframe${currentKey?.id === key.id ? " is-current" : ""}`}
            style={{ left: Math.max(10, Math.min(clip.duration * zoom - 10, key.time * zoom)) }}
            aria-label={`变换关键帧 ${timelineLabel(clip.start + key.time, project.fps)}`}
            title={`变换关键帧 · ${timelineLabel(clip.start + key.time, project.fps)}`}
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onSelectTransformKey?.(clip.id, key.id); onSeek(clip.start + key.time); }}
          ><Diamond size={11} weight="fill" /></button>)}
        </span>}
        {active && audioKeys.length > 0 && <span className="tl-keyframes tl-audio-keyframes">
          {audioKeys.map(key => <button key={key.id} type="button"
            className={`tl-keyframe${currentAudioKey?.id === key.id ? " is-current" : ""}`}
            style={{ left: Math.max(10, Math.min(clip.duration * zoom - 10, key.time * zoom)) }}
            aria-label={`音量关键帧 ${timelineLabel(clip.start + key.time, project.fps)}`}
            title={`音量关键帧 · ${Math.round(key.gain * 100)}%`}
            onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); onSelectAudioKey?.(clip.id, key.id); onSeek(clip.start + key.time); }}
          ><Diamond size={11} weight="fill" /></button>)}
        </span>}
        <span
          className="tl-trim tl-trim-left"
          role="separator"
          aria-label="裁剪片段起点"
          onPointerDown={(event) => beginGesture(event, "clip", raw, "left")}
        />
        <span
          className="tl-trim tl-trim-right"
          role="separator"
          aria-label="裁剪片段终点"
          onPointerDown={(event) => beginGesture(event, "clip", raw, "right")}
        />
      </div>
    );
  };

  return (
    <section className="timeline" aria-label="剪辑时间线">
      <div className="tl-toolbar">
        <div className="tl-tools-left">
          <ToolButton label="跳到时间线开头" onClick={() => onSeek(0)}>
            <SkipBack size={17} />
          </ToolButton>
          <span className="tl-separator" />
          <span className="tl-pointer-mode" title="选择工具">
            <Cursor size={16} />
            <CaretDown size={9} />
          </span>
          <ToolButton label="撤销" disabled={!canUndo} onClick={onUndo}>
            <ArrowUUpLeft size={17} />
          </ToolButton>
          <ToolButton label="重做" disabled={!canRedo} onClick={onRedo}>
            <ArrowUUpRight size={17} />
          </ToolButton>
          <span className="tl-separator" />
          <ToolButton label="分割片段" disabled={!canSplit} onClick={onSplit}>
            <Scissors size={17} />
          </ToolButton>
          <ToolButton
            label="删除选中内容"
            disabled={!selected}
            onClick={onDelete}
          >
            <Trash size={17} />
          </ToolButton>
          <ToolButton label="复制画面到上层轨道 (⌘ D)" disabled={!selectedClip || selectedClip.track !== "video" || clipLayer(selectedClip) >= 3} onClick={onDuplicate}>
            <Copy size={17} />
          </ToolButton>
          <span className="tl-toolbar-hint">上下拖动切换轨道 · 拖动两端裁剪 · Esc 取消</span>
        </div>
        <div className="tl-tools-right">
          <ToolButton label="显示音频轨道" onClick={() => showAudioTrack()}>
            <SpeakerHigh size={17} />
          </ToolButton>
          <span className="tl-duration">
            {timelineLabel(time, project.fps)}{" "}
            <span>/ {timelineLabel(duration, project.fps)}</span>
          </span>
          <ToolButton
            label={snap ? "关闭时间线吸附" : "开启时间线吸附"}
            active={snap}
            onClick={() => setSnap((value) => !value)}
          >
            <Magnet size={17} />
          </ToolButton>
          <span className="tl-link-icon" title="独立轨道">
            <LinkSimple size={17} />
          </span>
          <span className="tl-separator" />
          <ToolButton
            label="缩小时间线"
            disabled={zoom <= 12}
            onClick={() => onZoom(Math.max(12, zoom - 12))}
          >
            <Minus size={15} />
          </ToolButton>
          <input
            className="tl-zoom"
            type="range"
            aria-label="时间线缩放"
            min="12"
            max="140"
            value={zoom}
            onChange={(event) => onZoom(Number(event.target.value))}
          />
          <ToolButton
            label="放大时间线"
            disabled={zoom >= 140}
            onClick={() => onZoom(Math.min(140, zoom + 12))}
          >
            <Plus size={15} />
          </ToolButton>
        </div>
      </div>
      <div className="tl-body">
        <div className="tl-track-headers">
          <div className="tl-ruler-head tl-ruler-head-fixed" />
          <div className="tl-track-headers-inner" ref={headersRef}>
          <div className="tl-ruler-head" />
          <div className="tl-head tl-head-subtitle">
            <TextT size={15} />
            <span>字幕</span>
          </div>
          {videoLayers.map(layer => <div key={layer} className={`tl-head tl-head-video${layer > 0 ? " tl-head-overlay" : ""}`}>
            <FilmStrip size={15} />
            <span>{layer === 0 ? "主轨道" : `叠加 ${layer}`}</span>
            <SpeakerHigh size={12} />
          </div>)}
          {audioLayout.map(({ lane, height, rowCount }) => <div key={lane} className={`tl-head tl-head-audio${activeAudioLane === lane ? " is-active-lane" : ""}`} style={{ height }} data-audio-lane-header={lane} onKeyDown={event => { if ([" ", "Enter", "Delete", "Backspace"].includes(event.key)) event.stopPropagation(); }}>
            <button type="button" className="tl-lane-name" aria-label={`选择音频轨道 ${lane + 1}`} aria-pressed={activeAudioLane === lane} onClick={() => { onSelectAudioLane?.(lane); showAudioTrack(lane); }}>
              <SpeakerHigh size={12} aria-hidden="true" /><span>音频 {lane + 1}</span>{rowCount > 1 && <small>{rowCount} 叠行</small>}
            </button>
            <span className="tl-lane-controls" onKeyDown={event => { if ([" ", "Enter", "Delete", "Backspace"].includes(event.key)) event.stopPropagation(); }}>
              <button type="button" aria-label={`音频轨道 ${lane + 1} 静音`} title="静音此音轨" aria-pressed={audioLanes[lane].muted} onClick={() => onEditAudioLane?.(lane, { muted: !audioLanes[lane].muted })}>M</button>
              <button type="button" aria-label={`音频轨道 ${lane + 1} 独听`} title="独听此音轨；隔离其他音轨与画面原声" aria-pressed={audioLanes[lane].solo} onClick={() => onEditAudioLane?.(lane, { solo: !audioLanes[lane].solo })}>S</button>
            </span>
          </div>)}
          </div>
        </div>
        <div className="tl-scroll" ref={scrollRef} onScroll={event => {
          if (headersRef.current) headersRef.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
          const current = gestureRef.current;
          if (gestureRef.current) updateGestureRef.current({ clientX: current.pointerX, clientY: current.pointerY });
        }}>
          <div className="tl-content" ref={contentRef} style={{ width }}>
            <div
              className="tl-ruler"
              aria-label="时间标尺，点击定位"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                seekAt(event);
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) seekAt(event);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              style={{ "--tl-tick-width": `${zoom}px` }}
            >
              {Array.from(
                { length: Math.floor(width / (zoom * rulerStep)) + 1 },
                (_, index) => (
                  <span
                    className="tl-ruler-label"
                    key={index}
                    style={{ left: index * rulerStep * zoom }}
                  >
                    {rulerTime(index * rulerStep)}
                  </span>
                ),
              )}
              <div
                className="tl-playhead"
                style={{ left: time * zoom }}
                aria-hidden="true"
              ><span /></div>
            </div>
            <div
              className="tl-track tl-subtitle-track"
              onPointerDown={(event) => {
                onSelect(null);
                seekAt(event);
              }}
            >
              {project.subtitles.map((raw) => {
                const subtitle = preview("subtitle", raw);
                return (
                  <div
                    key={subtitle.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`字幕：${subtitle.text}`}
                    className={`tl-subtitle${selected?.kind === "subtitle" && selected.id === subtitle.id ? " is-selected" : ""}`}
                    style={{
                      left: subtitle.start * zoom,
                      width: Math.max(8, subtitle.duration * zoom),
                    }}
                    onPointerDown={(event) =>
                      beginGesture(event, "subtitle", raw)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter")
                        onSelect({ kind: "subtitle", id: subtitle.id });
                    }}
                  >
                    <TextT size={12} />
                    <span>{subtitle.text}</span>
                    <span
                      className="tl-trim tl-trim-left"
                      role="separator"
                      aria-label="裁剪字幕起点"
                      onPointerDown={(event) =>
                        beginGesture(event, "subtitle", raw, "left")
                      }
                    />
                    <span
                      className="tl-trim tl-trim-right"
                      role="separator"
                      aria-label="裁剪字幕终点"
                      onPointerDown={(event) =>
                        beginGesture(event, "subtitle", raw, "right")
                      }
                    />
                  </div>
                );
              })}
            </div>
            {videoLayers.map(layer => <div
              key={layer}
              className={`tl-track tl-video-track${layer > 0 ? " tl-overlay-track" : ""}${targetClass('video', layer)}`}
              ref={node => { if (node) trackRefs.current.set(`video:${layer}`, node); else trackRefs.current.delete(`video:${layer}`); }}
              data-timeline-track="video" data-timeline-layer={layer}
              aria-label={layer === 0 ? "视频主轨道" : `叠加画面轨道 ${layer}`}
              onPointerDown={(event) => {
                onSelect(null);
                seekAt(event);
              }}
            >
              {project.clips
                .filter((clip) => clip.track === "video" && clipLayer(clip) === layer)
                .map(renderClip)}
              {renderGhost('video', layer)}
              {transitions.filter(plan => plan.layer === layer).map(plan => <button
                key={`transition-${plan.fromId}`}
                type="button"
                className={`tl-transition${selected?.id === plan.fromId ? " is-selected" : ""}`}
                aria-label={`${transitionLabel(plan.type)}转场，${plan.duration.toFixed(2)}秒`}
                title={`转场 · ${plan.duration.toFixed(2)}秒`}
                style={{ left: plan.start * zoom, width: Math.max(18, plan.duration * zoom) }}
                onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
                onClick={event => {
                  event.stopPropagation();
                  onSelectTransition?.(plan.fromId);
                  onSeek(plan.cut);
                }}
              ><Stack size={14} /></button>)}
              {!project.clips.some((clip) => clip.track === "video" && clipLayer(clip) === layer) && (
                <span className="tl-empty">
                  <FilmStrip size={20} />
                  {layer === 0 ? "将视频或图片拖到这里，开始创作" : `拖入视频或图片，叠加在${layer === 1 ? "主轨道" : "下层画面"}上方`}
                </span>
              )}
            </div>)}
            {audioLayout.map(({ lane, height, rowCount }) => <div
              key={lane}
              className={`tl-track tl-audio-track${activeAudioLane === lane ? " is-active-lane" : ""}${audioLanes[lane].muted ? " is-lane-muted" : ""}${targetClass('audio', lane)}`}
              style={{ height }}
              ref={node => { if (node) trackRefs.current.set(`audio:${lane}`, node); else trackRefs.current.delete(`audio:${lane}`); }}
              data-timeline-track="audio" data-timeline-layer={lane}
              aria-label={`音频轨道 ${lane + 1}`}
              onPointerDown={(event) => { onSelectAudioLane?.(lane); onSelect(null); seekAt(event); }}
            >
              {Array.from({ length: rowCount - 1 }, (_, row) => <span key={row} className="tl-audio-row-divider" style={{ top: 48 + row * 44 }} aria-hidden="true" />)}
              {project.clips.filter(clip => clip.track === "audio" && clipLayer(clip) === lane).map(renderClip)}
              {renderGhost('audio', lane)}
              {!project.clips.some(clip => clip.track === "audio" && clipLayer(clip) === lane) && <span className="tl-audio-empty">拖入音乐或分离原声 · 音频 {lane + 1}</span>}
            </div>)}
            <div
              className="tl-playhead"
              style={{ left: time * zoom }}
              aria-hidden="true"
            />
            {placementPreview?.resolution?.snap && <div className="tl-snap-guide" style={{ left: placementPreview.resolution.snap.time * zoom }} aria-hidden="true" />}
          </div>
        </div>
      </div>
      <div className="tl-footer">
        <span role="status" aria-live="polite" className={placementPreview && !placementPreview.resolution?.ok ? 'tl-feedback-error' : ''}>
          {placementPreview ? placementPreview.resolution?.ok ? `${placementPreview.target.track === 'audio' ? `音频 ${placementPreview.target.layer + 1}` : placementPreview.target.layer === 0 ? '主轨道' : `叠加 ${placementPreview.target.layer}`} · 松开放置${placementPreview.resolution.snap ? ` · ${placementPreview.resolution.snap.edge === 'end' ? '尾端' : '起点'}已吸附` : ''}` : placementPreview.resolution?.message : feedback || '本地剪辑 · 素材不会上传'}
        </span>
        <span>
          项目 {project.width} × {project.height} · {project.fps} fps
        </span>
      </div>
    </section>
  );
});
