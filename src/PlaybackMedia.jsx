import { useEffect, useRef, useState } from "react";
import { sourceTimeAt, sourceRateAt } from "../shared/model.mjs";
import { createPreviewController } from "./preview-controller.mjs";

export function PlaybackMedia({ media, clip, time, playing, style, onClick, onStatus, playbackKey }) {
  const ref = useRef(null), controller = useRef(null);
  const statusHandler = useRef(onStatus);
  const retryHandler = useRef(null);
  statusHandler.current = onStatus;
  const statusKey = playbackKey || `video:${clip.id}`;
  const [status, setStatus] = useState({ phase: "loading" });
  const [showWaiting, setShowWaiting] = useState(false);
  const [dismissedRecovery, setDismissedRecovery] = useState(false);
  const waiting = ["loading", "seeking", "buffering", "starting"].includes(status.phase);
  useEffect(() => {
    if (!waiting) { setShowWaiting(false); return; }
    const timer = setTimeout(() => setShowWaiting(true), 500);
    return () => clearTimeout(timer);
  }, [waiting]);

  useEffect(() => {
    const element = ref.current;
    const playback = createPreviewController(element, { onStatus: value => {
      setStatus(value);
      statusHandler.current?.({ ...value, key: statusKey });
    } });
    controller.current = playback;
    const reload = event => retryHandler.current?.(event);
    window.addEventListener("weijian:reload-preview", reload);
    return () => {
      playback.destroy();
      window.removeEventListener("weijian:reload-preview", reload);
      controller.current = null;
      statusHandler.current?.({ key: statusKey, phase: "disposed" });
    };
  }, [statusKey]);

  useEffect(() => {
    controller.current?.update({
      source: media.url,
      target: sourceTimeAt(clip, time),
      rate: sourceRateAt(clip, time),
      playing,
      muted: true,
      volume: 0,
    });
  }, [media.url, time, clip, playing, statusKey]);

  const retry = event => {
    event.stopPropagation();
    controller.current?.retry();
  };
  retryHandler.current = retry;
  const refreshDiagnostic = event => {
    event.stopPropagation();
    const current = controller.current?.snapshot();
    if (current) setStatus(current);
  };
  useEffect(() => { if (status.phase === "error") setDismissedRecovery(false); }, [status.phase]);
  const recovered = ["ready", "playing"].includes(status.phase) && status.lastFailure?.code === "PREVIEW_TIMEOUT";
  const metrics = { seeking: status.seeking, paused: status.paused, ready: status.readyState, network: status.networkState,
    currentTime: status.mediaTime, targetTime: status.targetTime, ended: status.ended,
    duration: status.duration, video: [status.videoWidth, status.videoHeight], visibility: status.visibility,
    hidden: status.hidden, focused: status.focused, buffered: status.buffered, seekable: status.seekable,
    decodedFrames: status.decodedFrames, droppedFrames: status.droppedFrames, quality: status.quality,
    audioOutput: "muted video; audio handled by isolated Worklet", muted: status.muted, volume: status.volume, requestedVolume: status.requestedVolume, playbackRate: status.playbackRate,
    mediaErrorCode: status.mediaErrorCode, sourceMatches: status.sourceMatches, lastFailure: status.lastFailure,
    controllerStartedAtNavigationMs: status.startedAtNavigationMs };
  return <>
    <video ref={ref} playsInline preload="auto" muted aria-label="视频预览" style={style} onClick={onClick}
      data-playback-key={statusKey}
      data-preview-state={status.phase} data-preview-code={status.code || undefined} />
    {waiting && showWaiting && <div role="status" style={{ position: "absolute", bottom: 12, left: 12,
      zIndex: 19, padding: "6px 9px", borderRadius: 4, fontSize: 11, color: "#ddd", background: "rgba(24,24,24,.88)", pointerEvents: "none" }}>
      {status.phase === "seeking" ? "正在定位画面…" : "正在准备预览…"}
    </div>}
    {(status.phase === "error" || (recovered && !dismissedRecovery)) && <div role={recovered ? "status" : "alert"} className="preview-error" data-diagnostic-key={statusKey} aria-label="画面预览诊断"
      style={{ position: "absolute", inset: "auto 12px 12px", zIndex: 20,
        padding: recovered ? "6px 9px" : "10px 12px", border: `1px solid ${recovered ? "#405e49" : "#765132"}`, borderRadius: 6, color: "#eee", background: "rgba(31,25,20,.96)", fontSize: 12 }}
      onClick={event => event.stopPropagation()}>
      <strong>{recovered ? "预览已就绪" : "画面预览未就绪"}</strong>
      {recovered ? <button type="button" className="icon-button" aria-label="关闭预览恢复提示" onClick={() => setDismissedRecovery(true)} style={{ float: "right", fontSize: 16 }}>×</button>
        : <><div style={{ margin: "5px 0 8px", lineHeight: 1.5 }}>{status.message}</div>
          <button type="button" className="button" aria-label="重新加载画面预览" onClick={retry}>重新加载预览</button></>}
      <details style={{ marginTop: 7, maxHeight: 180, overflow: "auto", color: "#b9afa5", fontSize: 11 }}>
        <summary>预览诊断</summary>
        <button type="button" className="button" onClick={refreshDiagnostic}>刷新诊断</button>
        <div>{status.revision} · 当前阶段 {status.phase}</div>
        <div>{status.code} · ready {status.readyState} / network {status.networkState}</div>
        <div>阶段 {status.failedPhase} · 首次定位{status.initialPositionRequested ? "已请求" : "未请求"}</div>
        <div>素材 {media.name} · 画面 {status.mediaTime?.toFixed(3) ?? "—"} / 目标 {status.targetTime?.toFixed(3) ?? "—"} 秒</div>
        <div style={{ marginTop: 6 }}>最近媒体事件（相对控制器启动，最多 32 条）</div>
        {status.eventTail?.map((item, index) => <div key={`event-${index}`} style={{ fontSize: 10, lineHeight: 1.5, overflowWrap: "anywhere" }}>{item.atMs}ms #{item.epoch} {item.event} ready{item.ready}/net{item.network} t={item.time} paused={String(item.paused)} seeking={String(item.seeking)}</div>)}
        <div style={{ marginTop: 6 }}>实时状态（点击刷新更新）</div>
        {Object.entries(metrics).map(([name, value]) => <div key={name} style={{ fontSize: 10, lineHeight: 1.5, overflowWrap: "anywhere" }}>{name}: {JSON.stringify(value) ?? "null"}</div>)}
      </details>
    </div>}
  </>;
}
