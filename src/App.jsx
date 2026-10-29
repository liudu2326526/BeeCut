import { useCallback, useEffect, useRef, useState } from "react";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
  CaretDownIcon,
  FolderOpenIcon,
  FloppyDiskIcon,
  ExportIcon,
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  ArrowsOutIcon,
  TextTIcon,
  MusicNotesIcon,
  FilmStripIcon,
  StickerIcon,
  SparkleIcon,
  SlidersHorizontalIcon,
  PaletteIcon,
  MagicWandIcon,
  StackIcon,
  CheckIcon,
  XIcon,
  TrashIcon,
  DownloadSimpleIcon,
  CircleIcon,
  QuestionIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  SpinnerGapIcon,
  CaretRightIcon,
  ScissorsIcon,
  UploadSimpleIcon,
  GaugeIcon,
  ArrowClockwiseIcon,
} from "@phosphor-icons/react";
import {
  newProject,
  projectDuration,
  timelineLabel,
  splitClip,
  clipLayer,
  clipTransform,
  clipAdjustments,
  clipAnimation,
  animationAlphaAt,
  clipMask,
  maskGeometry,
  clipTransitionOut,
  nextVideoClip,
  transitionForClip,
  maxTransitionDuration,
  visualLayersAt,
  reconcileTransitions,
  transformAt,
  pictureTransformAt,
  transformKeyframes,
  upsertTransformKey,
  removeTransformKey,
  setTransformKeyEasing,
  transformKeyNavigation,
  clipTiming,
  changeClipTiming,
  trimClip,
  clipTrimBounds,
  MAX_TRANSFORM_KEYS,
  MAX_DECODE_INPUTS,
  MAX_SPEED_CURVE_POINTS,
  clipSpeedCurve,
  projectDecodeInputCount,
  detachClipAudio,
  MAX_AUDIO_GAIN_KEYS,
  projectAudioLanes,
  audioGainKeyframes,
  audioGainMultiplierAt,
  audioGainKeyNavigation,
  upsertAudioGainKey,
  removeAudioGainKey,
  setAudioGainKeyEasing,
} from "../shared/model.mjs";
import { Timeline } from "./Timeline.jsx";
import { PlaybackMedia } from "./PlaybackMedia.jsx";
import { useRealtimeAudio } from "./realtime-audio.mjs";
import { audioProjectClock } from "../shared/audio-dsp.mjs";
import { Button, IconButton, NumberField } from "./EditorControls.jsx";
import { SpeedEditor } from "./SpeedEditor.jsx";
import { KeyframeEditor } from "./KeyframeEditor.jsx";
import { AudioInspector } from "./AudioInspector.jsx";
import { JianyingDraftImport } from "./JianyingDraftImport.jsx";
import { serializeSrt } from "../shared/srt.mjs";
import { subtitlesFromSrt } from "./subtitle-import.mjs";
import { resolveTimelinePlacement, TIMELINE_END_LIMIT } from "../shared/timeline-placement.mjs";
import { pushFollowingVideoClips } from "./clip-edits.mjs";
import { ANIMATION_EFFECTS, TRANSITION_EFFECTS, transitionSampleStyle } from "../shared/effects.mjs";

const uid = () => crypto.randomUUID();
const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));
const round = (n) => Math.round(n * 1000) / 1000;
const transitionTypes = TRANSITION_EFFECTS.map(effect => [effect.type, effect.label]);
const animationTypes = ANIMATION_EFFECTS.map(effect => [effect.type, effect.inLabel, effect.outLabel]);
function editCapacityError(project) {
  if (project.clips.length > 64)
    return "工程最多支持 64 个片段，请先删除一些片段";
  if (projectDuration(project) > TIMELINE_END_LIMIT)
    return "工程最长支持 15 分钟，请缩短片段或提高速度";
  if (project.clips.reduce((n, c) => n + transformKeyframes(c).length, 0) > MAX_TRANSFORM_KEYS)
    return `工程最多支持 ${MAX_TRANSFORM_KEYS} 个变换关键帧，请先删除一些关键帧`;
  if (project.clips.reduce((n, clip) => n + audioGainKeyframes(clip).length, 0) > MAX_AUDIO_GAIN_KEYS)
    return `工程最多支持 ${MAX_AUDIO_GAIN_KEYS} 个音量关键帧，请先删除一些关键帧`;
  if (projectDecodeInputCount(project) > MAX_DECODE_INPUTS)
    return `工程最多支持 ${MAX_DECODE_INPUTS} 个素材分段，请先合并分段或删除片段`;
  if (project.clips.reduce((n, c) => n + (clipSpeedCurve(c)?.points.length || 0), 0) > MAX_SPEED_CURVE_POINTS)
    return `工程最多支持 ${MAX_SPEED_CURVE_POINTS} 个速度曲线节点，请先删除一些节点`;
}
const tools = [
  { id: "media", label: "素材", Icon: FilmStripIcon },
  { id: "audio", label: "音频", Icon: MusicNotesIcon },
  { id: "text", label: "文本", Icon: TextTIcon },
  { id: "sticker", label: "贴纸", Icon: StickerIcon, later: true },
  { id: "effects", label: "特效", Icon: SparkleIcon, later: true },
  { id: "transition", label: "转场", Icon: StackIcon },
  { id: "filter", label: "滤镜", Icon: PaletteIcon, later: true },
  { id: "adjust", label: "调节", Icon: SlidersHorizontalIcon },
  { id: "ai", label: "智能工具", Icon: MagicWandIcon, later: true },
];
async function api(path, options = {}) {
  const r = await fetch(path, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `请求失败 (${r.status})`);
  return data;
}
const post = (value) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
function Modal({ title, onClose, children, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("button")?.focus();
    return () => previous?.focus();
  }, []);
  function keyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [
      ...ref.current.querySelectorAll(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, a[href]",
      ),
    ];
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault();
      items[0]?.focus();
    }
  }
  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={ref}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={keyDown}
      >
        <header>
          <strong>{title}</strong>
          <IconButton Icon={XIcon} label="关闭弹窗" onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}
function maskImage(clip, project) {
  const m = maskGeometry(clip, project);
  if (m.type === "none") return undefined;
  const shape = m.type === "ellipse"
    ? `<ellipse cx="${m.cx}" cy="${m.cy}" rx="${m.width / 2}" ry="${m.height / 2}"/>`
    : `<rect x="${m.cx - m.width / 2}" y="${m.cy - m.height / 2}" width="${m.width}" height="${m.height}"/>`;
  const filter = m.sigma > 0 || m.invert;
  const padding = m.padding;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${project.width}" height="${project.height}" viewBox="0 0 ${project.width} ${project.height}"><defs><filter id="soft" filterUnits="userSpaceOnUse" x="${-padding}" y="${-padding}" width="${project.width + 2 * padding}" height="${project.height + 2 * padding}" color-interpolation-filters="sRGB">${m.sigma > 0 ? `<feGaussianBlur stdDeviation="${m.sigma}"/>` : ""}${m.invert ? '<feComponentTransfer><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>' : ""}</filter></defs><g fill="white"${filter ? ' filter="url(#soft)"' : ""}><g transform="rotate(${m.rotation} ${m.cx} ${m.cy})">${shape}</g></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
function visualStyle(clip, project, time, weight = 1) {
  const t = pictureTransformAt(clip, time, project), a = clipAdjustments(clip);
  const mask = maskImage(clip, project);
  return {
    transform: `translate(${t.x / project.width * 100}%, ${t.y / project.height * 100}%) rotate(${t.rotation}deg) scale(${t.scale * (t.flipX ? -1 : 1)}, ${t.scale * (t.flipY ? -1 : 1)})`,
    opacity: t.opacity * animationAlphaAt(clip, time) * weight,
    filter: `brightness(${a.brightness}) contrast(${a.contrast}) saturate(${a.saturation})`,
    zIndex: clipLayer(clip),
    maskImage: mask,
    maskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskImage: mask,
    WebkitMaskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
    mixBlendMode: "plus-lighter",
  };
}

export function App() {
  const [history, setHistory] = useState(() => ({
    past: [],
    present: newProject(),
    future: [],
  }));
  const project = history.present;
  const [ready, setReady] = useState(false),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("media"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [zoom, setZoom] = useState(42),
    [muted, setMuted] = useState(false);
  const [inspectorTab, setInspectorTab] = useState("basic");
  const [pictureTab, setPictureTab] = useState("transform");
  const [audioSection, setAudioSection] = useState("basic"), [activeAudioLane, setActiveAudioLane] = useState(0);
  const [, setPreviewRevision] = useState(0);
  const [uploading, setUploading] = useState(false),
    [toast, setToast] = useState(null),
    [saveStatus, setSaveStatus] = useState("saved"),
    [health, setHealth] = useState(null);
  const [dialog, setDialog] = useState(null),
    [projects, setProjects] = useState([]),
    [exportJob, setExportJob] = useState(null),
    [exportStarting, setExportStarting] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [grid, setGrid] = useState(true);
  const [audioPreview, setAudioPreview] = useState(null), [audioPreviewStarting, setAudioPreviewStarting] = useState(false);
  const [exportSettings, setExportSettings] = useState({
    width: 1920,
    height: 1080,
    fps: 30,
    quality: "high",
  });
  const importRef = useRef(null),
    subtitleImportRef = useRef(null),
    projectImportRef = useRef(null),
    playerRef = useRef(null),
    timelineRef = useRef(null),
    toastTimer = useRef(null),
    currentProject = useRef(project),
    cleanProject = useRef(null),
    pendingSaves = useRef(0),
    saveGeneration = useRef(0),
    saveQueue = useRef(Promise.resolve());
  const clipClipboard = useRef(null);
  const draftImportSwitchSnapshot = useRef(null);
  const mediaStatus = useRef(new Map());
  const activePlaybackKeys = useRef([]);
  currentProject.current = project;
  const contentDuration = projectDuration(project);
  const duration = contentDuration > 0 ? audioProjectClock(project).outputDuration : 0;
  const selectedClip =
    selected?.kind === "clip"
      ? project.clips.find((c) => c.id === selected.id)
      : null;
  const selectedSubtitle =
    selected?.kind === "subtitle"
      ? project.subtitles.find((s) => s.id === selected.id)
      : null;
  const selectedMedia = selectedClip
    ? project.media.find((m) => m.id === selectedClip.mediaId)
    : null;
  const selectedTransform = selectedClip ? transformAt(selectedClip, time) : null;
  const selectedKeys = selectedClip ? transformKeyframes(selectedClip) : [];
  const keyNavigation = selectedClip ? transformKeyNavigation(selectedClip, time) : {};
  const selectedTiming = selectedClip ? clipTiming(selectedClip) : null;
  const selectedBounds = selectedClip ? clipTrimBounds(selectedClip, selectedMedia) : null;
  const previewTime = duration > 0 ? Math.min(time, Math.max(0, duration - 1 / project.fps)) : time;
  const activeVisualClips = project.clips.filter(
    (c) =>
      c.track === "video" && previewTime >= c.start && previewTime < c.start + c.duration,
  ).sort((a, b) => clipLayer(a) - clipLayer(b));
  const activeClip = activeVisualClips.at(-1);
  const visualLayers = visualLayersAt(project, previewTime);
  activePlaybackKeys.current = [
    ...visualLayers.flatMap(layer => layer.samples.filter(s => project.media.find(m => m.id === s.clip.mediaId)?.type !== "image").map(s => `video:${s.clip.id}`)),
  ];
  const allowMediaPlayback = activePlaybackKeys.current.every(key => ["ready", "playing", "starting"].includes(mediaStatus.current.get(key)));
  const reportMediaStatus = useCallback(status => {
    const previous = mediaStatus.current.get(status.key);
    if (status.phase === "disposed") mediaStatus.current.delete(status.key);
    else mediaStatus.current.set(status.key, status.phase);
    if (previous !== (status.phase === "disposed" ? undefined : status.phase)) setPreviewRevision(n => n + 1);
    if (status.phase === "error" && activePlaybackKeys.current.includes(status.key)) setPlaying(false);
  }, []);
  const realtimeAudio = useRealtimeAudio({ project, time, playing, muted });
  const realtimeAudioRef = useRef(realtimeAudio); realtimeAudioRef.current = realtimeAudio;
  const selectedTransition = selectedClip?.track === "video" ? clipTransitionOut(selectedClip) : { type: "none", duration: 0 };
  const transitionNext = selectedClip?.track === "video" ? nextVideoClip(project, selectedClip) : null;
  const transitionLimit = selectedClip?.track === "video" ? maxTransitionDuration(project, selectedClip) : 0;
  const activeSubtitles = project.subtitles.filter(
    (s) => previewTime >= s.start && previewTime < s.start + s.duration,
  );
  useEffect(() => {
    setInspectorTab(selected?.audioKey || selectedClip?.track === "audio" ? "audio" : ["adjust", "transition"].includes(tab) ? tab : "basic");
    if (selectedClip?.track === "audio") setActiveAudioLane(clipLayer(selectedClip));
  }, [selected?.id, selectedClip?.layer]);
  const notify = useCallback((text, error = false) => {
    clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = setTimeout(() => setToast(null), 4600);
  }, []);
  const apply = useCallback(
    (updater) =>
      setHistory((h) => {
        const draft = structuredClone(h.present);
        try {
          updater(draft);
          const capacityError = editCapacityError(draft);
          if (capacityError) throw new Error(capacityError);
        }
        catch (error) { return { ...h, editError: { message: error.message || "无法应用这项修改" } }; }
        draft.updatedAt = new Date().toISOString();
        const reconciled = reconcileTransitions(draft);
        return {
          past: [...h.past.slice(-59), h.present],
          present: reconciled.project,
          future: [],
          removedTransitions: reconciled.removedCount,
        };
      }),
    [],
  );
  useEffect(() => {
    if (history.removedTransitions)
      notify("已移除不再相邻或时长不足的转场");
  }, [project, notify]);
  useEffect(() => {
    if (history.editError) notify(history.editError.message, true);
  }, [history.editError, notify]);
  function replaceProject(p, { persisted = true, initialTime = 0 } = {}) {
    saveGeneration.current++;
    cleanProject.current = persisted ? p : null;
    setHistory({ past: [], present: p, future: [] });
    seek(initialTime, { project: p, playing: false });
    setPlaying(false);
    setSelected(null);
    setActiveAudioLane(0);
    setAudioSection("basic");
    setSaveStatus(persisted ? "saved" : "dirty");
    localStorage.setItem("weijian:lastProject", p.id);
  }
  function undo() {
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            present: h.past.at(-1),
            future: [h.present, ...h.future],
          }
        : h,
    );
  }
  function redo() {
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.present],
            present: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );
  }
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const status = await api("/api/health");
        if (live) setHealth(status);
        const last = localStorage.getItem("weijian:lastProject");
        let loadedDemo = false;
        let data = last ? await api(`/api/projects/${encodeURIComponent(last)}`).catch(() => null) : null;
        if (!data?.project) {
          const list = await api('/api/projects');
          const latest = list.projects?.[0];
          loadedDemo = !latest;
          data = await api(latest ? `/api/projects/${encodeURIComponent(latest.id)}` : '/api/demo').catch(() => null);
        }
        if (live && data?.project) {
          replaceProject(data.project, { persisted: !loadedDemo, initialTime: loadedDemo ? 16 : 0 });
        }
      } catch (e) {
        if (live) notify(`本地服务暂不可用：${e.message}`, true);
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  async function persist(manual = false) {
    const snapshot = currentProject.current,
      generation = ++saveGeneration.current;
    if (!manual && snapshot === cleanProject.current && pendingSaves.current === 0) return true;
    pendingSaves.current++;
    setSaveStatus("saving");
    const task = saveQueue.current
      .catch(() => {})
      .then(() => api("/api/projects", post(snapshot)));
    saveQueue.current = task;
    try {
      await task;
      // A completed queued write is the disk's current version even if Undo
      // changed this project's in-memory snapshot while that write ran.
      if (currentProject.current.id === snapshot.id) cleanProject.current = snapshot;
      if (
        currentProject.current === snapshot &&
        generation === saveGeneration.current
      ) {
        setSaveStatus("saved");
        localStorage.setItem("weijian:lastProject", snapshot.id);
      }
      if (manual) notify("工程已保存到本机");
      return true;
    } catch (e) {
      if (
        currentProject.current === snapshot &&
        generation === saveGeneration.current
      )
        setSaveStatus("error");
      notify(`保存失败：${e.message}`, true);
      return false;
    } finally { pendingSaves.current--; }
  }
  useEffect(() => {
    const saveForDesktop = async event => {
      const requestId = event.detail?.requestId;
      if (typeof requestId !== 'string') return;
      const ok = await persist();
      window.dispatchEvent(new CustomEvent('weijian:save-complete', { detail: { requestId, ok } }));
    };
    window.addEventListener('weijian:save-request', saveForDesktop);
    return () => window.removeEventListener('weijian:save-request', saveForDesktop);
  });
  useEffect(() => {
    const guardUnsaved = event => {
      if (!ready || saveStatus === 'saved') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guardUnsaved);
    return () => window.removeEventListener('beforeunload', guardUnsaved);
  }, [ready, saveStatus]);
  useEffect(() => {
    if (!ready) return;
    if (project === cleanProject.current && pendingSaves.current === 0) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("dirty");
    const timer = setTimeout(() => persist(), 1300);
    return () => clearTimeout(timer);
  }, [project, ready]);
  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);
  useEffect(() => {
    if (!playing) return;
    let frame,
      previous = performance.now();
    function tick(now) {
      const delta = (now - previous) / 1000;
      previous = now;
      if (document.hidden || delta > 1) {
        setPlaying(false);
        return;
      }
      const phases = activePlaybackKeys.current.map(key => mediaStatus.current.get(key));
      const audioTime = realtimeAudioRef.current.clockTime(null);
      if (audioTime === null && phases.some(phase => !["ready", "playing"].includes(phase))) {
        frame = requestAnimationFrame(tick);
        return;
      }
      setTime((t) => {
        const next = audioTime === null ? t + delta : Math.max(t, audioTime);
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  useEffect(() => {
    if (time > duration) seek(duration);
    if (!duration) setPlaying(false);
  }, [duration]);
  useEffect(() => {
    if (!exportJob || !["queued", "rendering"].includes(exportJob.status))
      return;
    let live = true;
    const poll = async () => {
      try {
        const job = await api(`/api/exports/${exportJob.id}`);
        if (live) setExportJob(job);
      } catch (e) {
        if (live)
          setExportJob((j) => ({ ...j, status: "failed", error: e.message }));
      }
    };
    const timer = setInterval(poll, 700);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [exportJob?.id, exportJob?.status]);
  useEffect(() => {
    const job = audioPreview?.job;
    if (!job || !["queued", "rendering"].includes(job.status)) return;
    let live = true;
    const timer = setInterval(async () => {
      try {
        const next = await api(`/api/exports/${job.id}`);
        if (live) setAudioPreview(current => current?.job.id === job.id ? { ...current, job: next } : current);
      } catch (error) {
        if (live) setAudioPreview(current => current?.job.id === job.id ? { ...current, job: { ...current.job, status: "failed", error: error.message } } : current);
      }
    }, 700);
    return () => { live = false; clearInterval(timer); };
  }, [audioPreview?.job.id, audioPreview?.job.status]);
  useEffect(() => {
    const handle = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        persist(true);
        return;
      }
      if (
        /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
        e.target.isContentEditable
      )
        return;
      if (!dialog && !helpOpen && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && selectedClip?.track === "video") {
        e.preventDefault();
        clipClipboard.current = structuredClone(selectedClip);
        notify("画面片段已复制，⌘ V 粘贴到上层轨道");
      } else if (!dialog && !helpOpen && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && clipClipboard.current) {
        e.preventDefault();
        duplicateClip(clipClipboard.current);
      } else if (!dialog && !helpOpen && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && selectedClip?.track === "video") {
        e.preventDefault();
        duplicateClip();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (!dialog && !helpOpen && e.code === "Space") {
        e.preventDefault();
        togglePlaying();
      } else if (
        !dialog &&
        !helpOpen &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        removeSelected();
      } else if (!dialog && !helpOpen && e.key.toLowerCase() === "b")
        splitSelected();
      else if (e.key === "Escape") {
        setDialog(null);
        setHelpOpen(false);
        setSelected(null);
      } else if (!dialog && !helpOpen && e.key === "ArrowRight") {
        e.preventDefault();
        seek(time + 1 / project.fps);
      } else if (!dialog && !helpOpen && e.key === "ArrowLeft") {
        e.preventDefault();
        seek(time - 1 / project.fps);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  function seek(t, options = {}) {
    const p = options.project;
    const end = p ? projectDuration(p) > 0 ? audioProjectClock(p).outputDuration : 0 : duration;
    const target = clamp(t, 0, end);
    realtimeAudioRef.current.seek(target, options);
    setTime(target);
  }
  function togglePlaying() {
    if (!duration) return;
    if (activePlaybackKeys.current.some(key => mediaStatus.current.get(key) === "error")) {
      setPlaying(false);
      notify("预览未就绪，请重新加载预览", true);
      return;
    }
    if (time >= duration - 0.02) seek(0);
    setPlaying((p) => !p);
  }
  async function importFiles(files) {
    if (!files?.length) return;
    setUploading(true);
    const body = new FormData();
    [...files].forEach((file) => body.append("files", file));
    try {
      const data = await api("/api/media", { method: "POST", body });
      apply((p) => p.media.push(...data.media));
      notify(`已导入 ${data.media.length} 个素材`);
    } catch (e) {
      notify(`导入失败：${e.message}`, true);
    } finally {
      setUploading(false);
      if (importRef.current) importRef.current.value = "";
    }
  }
  function addMedia(id, track, at, layer) {
    const m = project.media.find((m) => m.id === id);
    if (!m) return;
    const lane = m.type === "audio" ? "audio" : "video";
    layer = layer ?? (lane === "audio" ? activeAudioLane : 0);
    if (track && track !== lane)
      return notify(
        m.type === "audio" ? "请将音乐放到音频轨道" : "请将画面放到视频轨道",
      );
    const start = Number.isFinite(at)
      ? Math.max(0, at)
      : lane === "video"
        ? Math.max(
            0,
            ...project.clips
              .filter((c) => c.track === "video")
              .filter((c) => clipLayer(c) === layer)
              .map((c) => c.start + c.duration),
          )
        : 0;
    const resolved = resolveTimelinePlacement(project, { mediaId: id, start, track: track || lane, layer });
    if (!resolved.ok) return notify(resolved.message, true);
    const c = { id: uid(), mediaId: id, ...resolved.placement, sourceStart: 0, duration: resolved.duration, speed: 1, volume: 1 };
    const capacityError = editCapacityError({ ...project, clips: [...project.clips, c] });
    if (capacityError) return notify(capacityError, true);
    apply((p) => {
      const checked = resolveTimelinePlacement(p, { mediaId: id, ...resolved.placement });
      if (!checked.ok) throw new Error(checked.message);
      p.clips.push({ ...c, ...checked.placement });
    });
    setSelected({ kind: "clip", id: c.id });
    seek(c.start);
    notify(lane === "audio" ? "配乐已添加到音频轨道" : "已添加到时间线");
  }
  function editClip(id, patch) {
    apply((p) => {
      const index = p.clips.findIndex((c) => c.id === id);
      if (index < 0) return;
      const c = p.clips[index], media = p.media.find(m => m.id === c.mediaId);
      const timing = {}, fields = { ...patch };
      for (const key of ["start", "sourceStart", "duration", "speed", "speedSegments", "speedCurve"])
        if (key in fields) { timing[key] = fields[key]; delete fields[key]; }
      p.clips[index] = { ...(Object.keys(timing).length ? changeClipTiming(c, timing, media) : c), ...fields };
      if (["start", "track", "layer"].some(key => key in patch)) {
        const edited = p.clips[index];
        const placed = resolveTimelinePlacement(p, { clipId: id, start: edited.start, track: edited.track, layer: clipLayer(edited) });
        if (!placed.ok) throw new Error(placed.message);
        Object.assign(edited, placed.placement);
      } else if (Object.keys(timing).length) pushFollowingVideoClips(p, id);
    });
  }
  function detachSelectedAudio() {
    if (!selectedClip) return;
    const id = uid();
    try {
      const detached = detachClipAudio(project, selectedClip.id, id, activeAudioLane);
      const capacityError = editCapacityError(detached);
      if (capacityError) throw new Error(capacityError);
      setPlaying(false);
      apply(draft => Object.assign(draft, detachClipAudio(draft, selectedClip.id, id, activeAudioLane)));
      setSelected({ kind: "clip", id });
      notify(`音频已分离到音频 ${activeAudioLane + 1}；原画面不重复发声`);
    } catch (error) { notify(error.message, true); }
  }
  function editAudioLane(lane, patch) {
    apply(p => { const lanes = projectAudioLanes(p); p.audioLanes = lanes.map((settings, index) => index === lane ? { ...settings, ...patch } : settings); });
  }
  function mutateAudioGain(mutation) {
    if (!selectedClip) return;
    apply(p => { const index = p.clips.findIndex(clip => clip.id === selectedClip.id); if (index >= 0) p.clips[index] = mutation(p.clips[index]); });
  }
  function toggleAudioGainKey(chosen) {
    mutateAudioGain(clip => {
      const current = chosen || audioGainKeyNavigation(clip, time).current;
      return current ? removeAudioGainKey(clip, current.id) : upsertAudioGainKey(clip, time, audioGainMultiplierAt(clip, time));
    });
  }
  function trimTimelineClip(id, bounds) {
    apply(p => {
      const index = p.clips.findIndex(c => c.id === id);
      if (index < 0) return;
      p.clips[index] = trimClip(p.clips[index], bounds, p.media.find(m => m.id === p.clips[index].mediaId));
    });
  }
  function moveClip(id, target) {
    const requested = typeof target === "number" ? { start: target } : target;
    const resolved = resolveTimelinePlacement(project, { clipId: id, ...requested });
    if (!resolved.ok) return notify(resolved.message, true);
    if (resolved.unchanged) return;
    setPlaying(false);
    apply(p => {
      const checked = resolveTimelinePlacement(p, { clipId: id, ...resolved.placement });
      if (!checked.ok) throw new Error(checked.message);
      const index = p.clips.findIndex(c => c.id === id), clip = p.clips[index];
      p.clips[index] = { ...changeClipTiming(clip, { start: checked.placement.start }, p.media.find(m => m.id === clip.mediaId)), ...checked.placement };
    });
  }
  function editTransform(patch) {
    if (!selectedClip || selectedClip.track !== "video") return;
    setPlaying(false);
    if (!selectedKeys.length || "flipX" in patch || "flipY" in patch)
      return editClip(selectedClip.id, { transform: { ...clipTransform(selectedClip), ...patch } });
    apply(p => {
      const index = p.clips.findIndex(c => c.id === selectedClip.id);
      const clip = p.clips[index];
      p.clips[index] = upsertTransformKey(clip, time, patch, transformKeyNavigation(clip, time).current?.easing || "linear");
    });
  }
  function toggleTransformKey() {
    if (!selectedClip) return;
    setPlaying(false);
    apply(p => {
      const i = p.clips.findIndex(c => c.id === selectedClip.id), c = p.clips[i];
      const current = transformKeyNavigation(c, time).current;
      p.clips[i] = current ? removeTransformKey(c, current.id, time) : upsertTransformKey(c, time);
    });
  }
  function changeKeyEasing(easing) {
    if (!selectedClip || !keyNavigation.current) return;
    apply(p => { const i = p.clips.findIndex(c => c.id === selectedClip.id); p.clips[i] = setTransformKeyEasing(p.clips[i], keyNavigation.current.id, easing); });
  }
  function setSpeedParts(parts) {
    editClip(selectedClip.id, { speedSegments: parts });
  }
  function addSpeedPart() {
    const total = projectDecodeInputCount(project);
    if (total >= MAX_DECODE_INPUTS) return notify(`当前工程已达 ${MAX_DECODE_INPUTS} 个素材分段，请先合并一些分段`, true);
    const parts = selectedTiming.segments.map(s => ({ sourceDuration: s.sourceDuration, speed: s.speed }));
    const index = parts.reduce((largest, p, i) => p.sourceDuration > parts[largest].sourceDuration ? i : largest, 0);
    const part = parts[index];
    if (part.sourceDuration < .08) return notify("这段素材太短，请先扩大源区间再分段");
    parts.splice(index, 1, { ...part, sourceDuration: part.sourceDuration / 2 }, { ...part, sourceDuration: part.sourceDuration / 2 });
    setSpeedParts(parts);
  }
  function mergeSpeedPart(index) {
    const parts = selectedTiming.segments.map(s => ({ sourceDuration: s.sourceDuration, speed: s.speed }));
    if (parts.length < 2) return;
    parts[index === 0 ? 1 : index - 1].sourceDuration += parts[index].sourceDuration;
    parts.splice(index, 1);
    setSpeedParts(parts);
  }
  function editAdjustments(patch) {
    if (!selectedClip || selectedClip.track !== "video") return;
    editClip(selectedClip.id, { adjustments: { ...clipAdjustments(selectedClip), ...patch } });
  }
  function editMask(patch) {
    if (!selectedClip || selectedClip.track !== "video") return;
    editClip(selectedClip.id, { mask: { ...clipMask(selectedClip), ...patch } });
  }
  function editAnimation(patch) {
    if (!selectedClip || selectedClip.track !== "video") return;
    editClip(selectedClip.id, { animation: { ...clipAnimation(selectedClip), ...patch } });
  }
  function applyTransition(type = "dissolve") {
    if (!selectedClip || selectedClip.track !== "video") return notify("先选择转场前的画面片段");
    if (!transitionNext || transitionLimit < .04) return notify("转场需要同轨道上前后紧邻的两个画面片段");
    editClip(selectedClip.id, { transitionOut: { type, duration: Math.min(selectedTransition.duration || .5, transitionLimit), nextClipId: transitionNext.id } });
    setInspectorTab("transition");
    notify(`已添加${transitionTypes.find(t => t[0] === type)?.[1] || "转场"}`);
  }
  function duplicateClip(source = selectedClip) {
    if (!source || source.track !== "video") return;
    if (project.clips.length >= 64) return notify("工程已达到 64 个片段，请先删除片段再粘贴", true);
    if (!project.media.some(m => m.id === source.mediaId))
      return notify("复制的片段不在当前工程，请先导入对应素材", true);
    const layer = [1, 2, 3].find(layer => layer > clipLayer(source) && !project.clips.some(c =>
      c.track === "video" && clipLayer(c) === layer &&
      source.start < c.start + c.duration - 0.001 && source.start + source.duration > c.start + 0.001,
    ));
    if (layer === undefined) return notify("上方轨道在这个位置没有空位，请先移动片段");
    const copy = { ...structuredClone(source), id: uid(), layer };
    const capacityError = editCapacityError({ ...project, clips: [...project.clips, copy] });
    if (capacityError) return notify(capacityError, true);
    apply(p => p.clips.push(copy));
    setSelected({ kind: "clip", id: copy.id });
    seek(copy.start);
    notify(`已复制到叠加轨道 ${layer}`);
  }
  function addSubtitle() {
    const s = {
      id: uid(),
      text: "添加一段文字",
      start: round(time),
      duration: Math.max(
        0.04,
        duration > time ? Math.min(3, duration - time) : 3,
      ),
      fontSize: 56,
      color: "#ffffff",
      position: "bottom",
    };
    apply((p) => p.subtitles.push(s));
    setSelected({ kind: "subtitle", id: s.id });
    setTab("text");
  }
  async function importSubtitles(file) {
    if (!file) return;
    const targetProjectId = project.id;
    try {
      if (file.size > 1024 * 1024) throw new Error("SRT 文件不能超过 1 MB");
      const content = await file.text();
      const target = currentProject.current;
      if (target.id !== targetProjectId) throw new Error("读取字幕期间切换了工程，请在目标工程重新导入");
      const subtitles = subtitlesFromSrt(content, target.subtitles, uid);
      apply(p => p.subtitles.push(...subtitles));
      if (subtitles[0]) {
        setSelected({ kind: "subtitle", id: subtitles[0].id });
        seek(subtitles[0].start);
      }
      notify(`已导入 ${subtitles.length} 条字幕`);
    } catch (e) {
      notify(`字幕导入失败：${e.message}`, true);
    } finally {
      subtitleImportRef.current.value = "";
    }
  }
  function downloadSubtitles() {
    try {
      const url = URL.createObjectURL(new Blob(["\uFEFF", serializeSrt(project.subtitles)], { type: "application/x-subrip;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name || "未命名项目"}.srt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { notify(`字幕导出失败：${e.message}`, true); }
  }
  function editSubtitle(id, patch) {
    apply((p) => {
      const s = p.subtitles.find((s) => s.id === id);
      if (s)
        Object.assign(s, patch, {
          start: Math.max(0, patch.start ?? s.start),
          duration: Math.max(0.04, patch.duration ?? s.duration),
        });
    });
  }
  function removeSelected() {
    if (!selected) return;
    apply((p) => {
      if (selected.kind === "clip")
        p.clips = p.clips.filter((c) => c.id !== selected.id);
      else p.subtitles = p.subtitles.filter((s) => s.id !== selected.id);
    });
    setSelected(null);
  }
  function splitSelected() {
    const c = selectedClip || activeClip;
    if (!c) return notify("请先选择一个片段");
    const parts = splitClip(
      c,
      time,
      project.media.find((m) => m.id === c.mediaId),
    );
    if (!parts) return notify("请将播放头移到片段内部再分割");
    const capacityError = editCapacityError({ ...project, clips: [...project.clips.filter(clip => clip.id !== c.id), ...parts] });
    if (capacityError) return notify(capacityError, true);
    apply((p) => {
      const i = p.clips.findIndex((c) => c.id === parts[0].id);
      p.clips.splice(i, 1, ...parts);
    });
    setSelected({ kind: "clip", id: parts[1].id });
    notify("片段已分割");
  }
  async function openProjects() {
    try {
      const d = await api("/api/projects");
      setProjects(d.projects);
      setDialog("projects");
    } catch (e) {
      notify(e.message, true);
    }
  }
  function openJianyingDraftImport() {
    setPlaying(false);
    setDialog("jianying-import");
  }
  useEffect(() => window.weijianDesktop?.onImportJianyingDraft?.(openJianyingDraftImport), []);
  async function saveBeforeDraftImport() {
    const snapshot = currentProject.current;
    if (!(await persist()) || currentProject.current !== snapshot) return false;
    draftImportSwitchSnapshot.current = snapshot;
    return true;
  }
  function openImportedDraft(importedProject) {
    // Import creates an independent saved project. If another desktop action
    // changed the current edit while copying, keep that edit on screen.
    if (currentProject.current === draftImportSwitchSnapshot.current) {
      replaceProject(importedProject);
      notify("剪映草稿已导入为独立工程，请核对导入报告");
    } else notify("草稿已导入并保存，可从“我的工程”打开；当前编辑已保留");
    setDialog(null);
  }
  async function openProject(id) {
    try {
      if (!(await persist())) return;
      const d = await api(`/api/projects/${id}`);
      replaceProject(d.project);
      setDialog(null);
      notify("工程已打开");
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function useDemo() {
    try {
      if (!(await persist())) return;
      const d = await api("/api/demo");
      replaceProject({ ...d.project, id: uid(), name: "云海 · 一场远行" }, { persisted: false, initialTime: 16 });
      notify("示例工程已载入，可以自由剪辑");
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function createProject() {
    if (!(await persist())) return;
    replaceProject(newProject(), { persisted: false });
    setDialog(null);
  }
  function downloadProject() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(project, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name}.weijian.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importProject(file) {
    if (!file) return;
    try {
      const p = JSON.parse(await file.text());
      if (!(await persist())) return;
      const r = await api("/api/projects", post(p));
      replaceProject(r.project);
      setDialog(null);
      notify("工程文件已打开");
    } catch (e) {
      notify(`无法打开工程：${e.message}`, true);
    } finally {
      projectImportRef.current.value = "";
    }
  }
  async function startExport() {
    if (exportStarting) return;
    setExportStarting(true);
    setPlaying(false);
    setExportJob(null);
    try {
      if (!(await persist())) return;
      setExportJob(
        await api("/api/exports", post({ project, settings: exportSettings })),
      );
    } catch (e) {
      notify(e.message, true);
    } finally {
      setExportStarting(false);
    }
  }
  async function startAudioPreview() {
    if (audioPreviewStarting) return;
    setPlaying(false);
    setDialog("audio-preview");
    if (audioPreview?.job && ["queued", "rendering"].includes(audioPreview.job.status)) return;
    setAudioPreviewStarting(true);
    const snapshot = currentProject.current;
    try {
      const job = await api("/api/audio-previews", post({ project: snapshot }));
      setAudioPreview({ job, binding: JSON.stringify({ ...snapshot, updatedAt: undefined }), name: snapshot.name });
    } catch (error) { notify(error.message, true); }
    finally { setAudioPreviewStarting(false); }
  }
  const media = project.media.filter(
    (m) =>
      (tab !== "audio" || m.type === "audio") &&
      (filter === "all" || m.type === filter) &&
      m.name.toLowerCase().includes(search.toLowerCase()),
  );
  const busy = exportJob && ["queued", "rendering"].includes(exportJob.status);
  const audioPreviewBusy = audioPreview?.job && ["queued", "rendering"].includes(audioPreview.job.status);
  const audioPreviewStale = audioPreview && audioPreview.binding !== JSON.stringify({ ...project, updatedAt: undefined });
  return (
    <main
      className="editor-shell"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          importFiles(e.dataTransfer.files);
        }
      }}
    >
      <input
        hidden
        ref={importRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        aria-label="选择素材文件"
        onChange={(e) => importFiles(e.target.files)}
      />
      <input
        hidden
        ref={projectImportRef}
        type="file"
        accept=".json"
        onChange={(e) => importProject(e.target.files[0])}
      />
      <input hidden ref={subtitleImportRef} type="file" accept=".srt" aria-label="选择 SRT 字幕文件" onChange={e => importSubtitles(e.target.files[0])} />
      <header className="app-header">
        <div className="app-identity">
          <span className="window-dots" aria-hidden="true">
            <CircleIcon weight="fill" />
            <CircleIcon weight="fill" />
            <CircleIcon weight="fill" />
          </span>
          <span className="app-wordmark">
            <ScissorsIcon size={17} weight="bold" />
            微剪<small>WORKSPACE</small>
          </span>
        </div>
        <div className="project-title">
          <input
            aria-label="工程名称"
            value={project.name}
            onChange={(e) =>
              apply((p) => {
                p.name = e.target.value;
              })
            }
          />
          <span className={`save-indicator ${saveStatus}`}>
            {saveStatus === "saving" ? (
              <SpinnerGapIcon className="spin" />
            ) : saveStatus === "saved" ? (
              <CheckIcon />
            ) : (
              <CircleIcon weight="fill" />
            )}
            {saveStatus === "saved"
              ? "已保存"
              : saveStatus === "saving"
                ? "保存中"
                : saveStatus === "error"
                  ? "保存失败"
                  : "未保存"}
          </span>
        </div>
        <div className="header-actions">
          <IconButton
            Icon={QuestionIcon}
            label="快捷键与使用说明"
            onClick={() => setHelpOpen(true)}
          />
          <Button
            Icon={FolderOpenIcon}
            label="打开工程"
            onClick={openProjects}
          />
          <Button
            Icon={FloppyDiskIcon}
            label="保存"
            onClick={() => persist(true)}
          />
          <Button
            className="primary export-button"
            Icon={ExportIcon}
            label="导出"
            onClick={() => {
              if (
                !exportJob ||
                !["queued", "rendering"].includes(exportJob.status)
              )
                setExportJob(null);
              setExportSettings((s) => ({
                ...s,
                width: project.width,
                height: project.height,
                fps: project.fps,
              }));
              setDialog("export");
            }}
          />
        </div>
      </header>
      <div className={`editing-workspace${selectedClip ? " is-clip-selected" : ""}`}>
        <section className="library-panel panel" aria-label="素材与工具">
          <nav className="tool-tabs">
            {tools.map(({ id, label, Icon, later }) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                title={later ? `${label} · 后续版本` : label}
                disabled={later}
                onClick={() => {
                  setTab(id);
                  setFilter("all");
                  if (id === "adjust" || id === "transition") {
                    if (selectedClip?.track !== "video") setSelected(null);
                    setInspectorTab(id);
                  }
                  else setSelected(null);
                }}
              >
                <Icon size={21} weight={tab === id ? "fill" : "regular"} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="library-body">
            <aside className="library-sidebar">
              <button
                className="sidebar-group active"
                onClick={() => {
                  setTab("media");
                  setFilter("all");
                }}
              >
                导入
                <CaretDownIcon size={12} />
              </button>
              <button
                className={
                  filter === "all" && tab === "media" ? "active-text" : ""
                }
                onClick={() => {
                  setTab("media");
                  setFilter("all");
                }}
              >
                素材<span>{project.media.length}</span>
              </button>
              <button
                onClick={() => {
                  setTab("media");
                  setFilter("video");
                }}
              >
                视频
              </button>
              <button
                onClick={() => {
                  setTab("audio");
                  setFilter("all");
                }}
              >
                音乐音效
              </button>
              <button
                onClick={() => {
                  setTab("media");
                  setFilter("image");
                }}
              >
                图片
              </button>
              <div className="sidebar-divider" />
              <button className="sidebar-group" onClick={openProjects}>
                我的工程
                <CaretDownIcon size={12} />
              </button>
              <button className="sidebar-group" onClick={useDemo}>
                示例素材
                <CaretRightIcon size={12} />
              </button>
              <span className="local-mark">
                <CircleIcon size={6} weight="fill" />
                本地工作空间
              </span>
            </aside>
            <div className="library-content">
              {tab === "transition" ? (
                <>
                  <div className="library-heading">本地转场</div>
                  <div className="transition-grid">{transitionTypes.map(([type, label]) => <button key={type} className="transition-card" onClick={() => applyTransition(type)}>
                    <span className="transition-thumbnail" aria-hidden="true"><StackIcon size={30} /></span>
                    <span>{label}</span><PlusIcon size={15} />
                  </button>)}</div>
                  <p className="subtle adjustment-guide">选择前一画面片段，将转场应用到同一轨道的下一个接点。</p>
                  <div className="library-heading spaced">画面片段</div>
                  <div className="subtitle-list">
                    {project.clips.filter(c => c.track === "video").sort((a, b) => clipLayer(a) - clipLayer(b) || a.start - b.start).map(c => (
                      <button key={c.id} className={selected?.id === c.id ? "selected" : ""} onClick={() => {
                        setSelected({ kind: "clip", id: c.id }); setInspectorTab("transition"); seek(c.start);
                      }}>
                        <StackIcon size={17} /><span>{project.media.find(m => m.id === c.mediaId)?.name || "画面片段"}</span><small>{c.start.toFixed(1)}s</small>
                      </button>
                    ))}
                    {!project.clips.some(c => c.track === "video") && <p className="subtle">先将两个画面片段添加到时间线。</p>}
                  </div>
                </>
              ) : tab === "adjust" ? (
                <>
                  <div className="library-heading">画面调节</div>
                  <p className="subtle adjustment-guide">选择时间线中的视频或图片，在右侧调节亮度、对比度和饱和度。</p>
                  <div className="subtitle-list">
                    {project.clips.filter(c => c.track === "video").map(c => (
                      <button key={c.id} className={selected?.id === c.id ? "selected" : ""} onClick={() => {
                        setSelected({ kind: "clip", id: c.id });
                        setInspectorTab("adjust");
                        seek(c.start);
                      }}>
                        <SlidersHorizontalIcon size={17} />
                        <span>{project.media.find(m => m.id === c.mediaId)?.name || "画面片段"}</span>
                        <small>{c.start.toFixed(1)}s</small>
                      </button>
                    ))}
                    {!project.clips.some(c => c.track === "video") && <p className="subtle">先将视频或图片添加到时间线。</p>}
                  </div>
                </>
              ) : tab === "text" ? (
                <>
                  <div className="library-heading">新建文本</div>
                  <button className="text-template" onClick={addSubtitle}>
                    <TextTIcon size={35} />
                    <span>默认文本</span>
                    <PlusIcon size={16} />
                  </button>
                  <Button
                    Icon={PlusIcon}
                    label="添加字幕"
                    onClick={addSubtitle}
                    className="add-text-button"
                  />
                  <div className="subtitle-file-actions">
                    <Button Icon={UploadSimpleIcon} label="导入 SRT" onClick={() => subtitleImportRef.current.click()} />
                    <Button Icon={DownloadSimpleIcon} label="导出 SRT" disabled={!project.subtitles.length} onClick={downloadSubtitles} />
                  </div>
                  <div className="library-heading spaced">
                    字幕列表<span>{project.subtitles.length}</span>
                  </div>
                  <div className="subtitle-list">
                    {project.subtitles.length ? (
                      project.subtitles.map((s) => (
                        <button
                          key={s.id}
                          className={selected?.id === s.id ? "selected" : ""}
                          onClick={() => {
                            setSelected({ kind: "subtitle", id: s.id });
                            seek(s.start);
                          }}
                        >
                          <TextTIcon size={17} />
                          <span>{s.text}</span>
                          <small>{s.start.toFixed(1)}s</small>
                        </button>
                      ))
                    ) : (
                      <p className="subtle">在播放头位置添加第一条字幕。</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="import-toolbar">
                    <Button
                      Icon={PlusIcon}
                      label={uploading ? "导入中…" : "导入"}
                      disabled={uploading}
                      onClick={() => importRef.current.click()}
                    />
                    <label className="search-box">
                      <MagnifyingGlassIcon size={13} />
                      <input
                        placeholder="搜索文件名"
                        aria-label="搜索素材"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <IconButton
                      Icon={SquaresFourIcon}
                      label={grid ? "切换列表视图" : "切换网格视图"}
                      onClick={() => setGrid((g) => !g)}
                    />
                  </div>
                  <div className="library-heading">
                    {tab === "audio"
                      ? "本地音乐"
                      : filter === "video"
                        ? "视频"
                        : filter === "image"
                          ? "图片"
                          : "全部"}
                    <span>{media.length ? `${media.length} 个素材` : ""}</span>
                  </div>
                  <div className={`media-grid ${grid ? "" : "list"}`}>
                    {media.map((m) => (
                      <div
                        className="media-card"
                        key={m.id}
                      >
                        <button
                          className="media-preview"
                          aria-label={`添加素材 ${m.name}`}
                          onPointerDown={event => timelineRef.current?.beginMediaGesture(event, m.id)}
                          onClick={event => {
                            if (!timelineRef.current?.consumeMediaClick(m.id, event)) addMedia(m.id);
                          }}
                        >
                          {m.type === "audio" ? (
                            <div className="audio-art">
                              <MusicNotesIcon size={30} />
                              <span>原声音乐</span>
                            </div>
                          ) : (
                            <img
                              src={m.thumbnailUrl || m.url}
                              alt={m.name}
                              draggable={false}
                            />
                          )}
                          <span className="media-duration">{`${Math.floor(
                            m.duration / 60,
                          )
                            .toString()
                            .padStart(2, "0")}:${Math.floor(m.duration % 60)
                            .toString()
                            .padStart(2, "0")}`}</span>
                          {project.clips.some((c) => c.mediaId === m.id) && (
                            <span className="added-badge">已添加</span>
                          )}
                          <span className="media-add">
                            <PlusIcon size={17} />
                          </span>
                        </button>
                        <span className="media-name" title={m.name}>
                          {m.name}
                        </span>
                      </div>
                    ))}
                  </div>
                  {!media.length && (
                    <div className="media-empty">
                      <UploadSimpleIcon size={34} weight="light" />
                      <strong>
                        {search
                          ? "没有找到相关素材"
                          : tab === "audio"
                            ? "添加喜欢的音乐"
                            : "开始你的创作"}
                      </strong>
                      <p>
                        {search
                          ? "试试其他文件名"
                          : "将素材拖到这里，或点击导入"}
                      </p>
                      <Button
                        Icon={PlusIcon}
                        label="导入素材"
                        onClick={() => importRef.current.click()}
                      />
                      {!search && (
                        <button className="text-link" onClick={useDemo}>
                          先体验示例工程
                          <ArrowRightIcon size={12} />
                        </button>
                      )}
                    </div>
                  )}
                  {!!media.length && (
                    <div className="library-tip">
                      拖拽素材到时间线，或点击添加
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
        <section className="player-panel panel" aria-label="播放器">
          <div className="panel-header">
            播放器<span className="panel-header-muted">— 时间线 01</span>
            <button className="player-fit" onClick={() => setDialog("canvas")}>
              适应
              <CaretDownIcon size={11} />
            </button>
          </div>
          <div
            className="player-stage"
            ref={playerRef}
            onClick={() => setSelected(null)}
          >
            <div
              className="video-canvas"
              style={{
                aspectRatio: `${project.width}/${project.height}`,
                "--canvas-ratio": project.width / project.height,
              }}
            >
              {visualLayers.length ? visualLayers.map(layer => <div key={layer.layer} className="preview-layer" style={{ zIndex: layer.layer }}>
              {layer.samples.map(sample => {
                const c = sample.clip;
                const m = project.media.find(m => m.id === c.mediaId);
                if (!m) return null;
                const select = e => { e.stopPropagation(); setSelected({ kind: "clip", id: c.id }); };
                return <div key={c.id} className="preview-sample" style={transitionSampleStyle(sample)}>
                  {m.type === "image" ? <img src={m.url} alt="图片预览" style={visualStyle(c, project, sample.sampleTime, sample.weight)} onClick={select} />
                    : <PlaybackMedia video media={m} clip={c} time={sample.sampleTime} playing={playing && allowMediaPlayback && Math.abs(sample.sampleTime - previewTime) < .001} muted playbackKey={`video:${c.id}`} onStatus={reportMediaStatus} style={visualStyle(c, project, sample.sampleTime, sample.weight)} onClick={select} />}
                </div>;
              })}
              {layer.blackOpacity > 0 && <div className="preview-black" style={{ opacity: layer.blackOpacity }} />}
              {layer.whiteOpacity > 0 && <div className="preview-black" style={{ background: "#fff", opacity: layer.whiteOpacity }} />}
              </div>) : (
                <div className="preview-empty" style={duration ? { background: "#000000" } : undefined}>
                  {!duration && (
                    <>
                      <FilmStripIcon size={42} weight="light" />
                      <span>将素材添加到时间线</span>
                      <small>让灵感，从这一帧开始</small>
                    </>
                  )}
                </div>
              )}
              {activeSubtitles.map((s) => (
                <div
                  key={s.id}
                  className={`preview-subtitle ${s.position}`}
                  style={{
                    color: s.color,
                    fontSize: `${(s.fontSize / project.width) * 100}cqw`,
                    WebkitTextStroke: `${((s.outlineWidth ?? Math.max(1, s.fontSize / 24)) / project.width) * 200}cqw ${s.outlineColor || "#000000"}`,
                    paintOrder: "stroke fill",
                    textShadow: "none",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected({ kind: "subtitle", id: s.id });
                    setTab("text");
                  }}
                >
                  {s.text}
                </div>
              ))}
            </div>
          </div>
          <div className="realtime-audio-status" role="region" aria-label="实时音频" onKeyDown={event => { if ([" ", "Enter", "Delete", "Backspace"].includes(event.key)) event.stopPropagation(); }}>
            <span role="status">{({ idle: "实时音频未启动", preparing: "正在准备保调音频…", initializing: "正在连接音频设备…", priming: "正在定位音频…", ready: "实时音效已就绪", playing: "实时音效播放中", paused: "实时音效已暂停", applied: "音频设置已应用", buffering: "音频缓冲中；画面继续", error: "音频不可用；画面继续", unsupported: "实时音频请使用 Mac 桌面版", "device-paused": "音频设备已暂停；画面继续" })[realtimeAudio.status.phase] || "实时音频"}</span>
            <button type="button" className="button" onClick={realtimeAudio.start} disabled={realtimeAudio.status.phase === "unsupported"}>{realtimeAudio.enabled ? "重试音频" : "启动实时音频"}</button>
            <button type="button" className="button" disabled={!["ready", "playing", "paused", "applied"].includes(realtimeAudio.status.phase) || ["starting", "recording"].includes(realtimeAudio.captureState)} onClick={realtimeAudio.capture}>录制实时混音</button>
            {["starting", "recording"].includes(realtimeAudio.captureState) && <button type="button" className="button" onClick={realtimeAudio.stopCapture}>停止录制</button>}
            {realtimeAudio.captureState === "completed" && <button type="button" className="button" onClick={() => realtimeAudio.saveCapture().then(result => { if (!result.cancelled) notify("实时混音 WAV 和样本时钟记录已保存"); }).catch(error => notify(error.message, true))}>保存实时录制</button>}
            <details><summary>音频诊断与录制说明</summary><p>录制最多 30 秒，直接记录 AudioWorklet 的最终混音；暂停时不计入，定位时结束本段。数字录制不代表扬声器响应。</p><pre>{JSON.stringify(realtimeAudio.status, null, 2)}</pre>{realtimeAudio.status.failures?.map(failure => <p key={failure.clipId}>{project.media.find(media => media.id === project.clips.find(clip => clip.id === failure.clipId)?.mediaId)?.name || failure.clipId}：{failure.message}</p>)}</details>
          </div>
          <div className="player-controls">
            <div className="time-display">
              <span>{timelineLabel(time, project.fps)}</span>
              <small>/</small>
              {timelineLabel(duration, project.fps)}
            </div>
            <div className="transport">
              <IconButton
                Icon={SkipBackIcon}
                label="回到开头"
                onClick={() => seek(0)}
              />
              <IconButton
                Icon={playing ? PauseIcon : PlayIcon}
                label={playing ? "暂停" : "播放"}
                className="play-control"
                disabled={!duration}
                onClick={togglePlaying}
              />
              <IconButton
                Icon={SkipForwardIcon}
                label="跳到结尾"
                onClick={() => {
                  setPlaying(false);
                  seek(duration);
                }}
              />
            </div>
            <div className="player-options">
              <span className="quality-tag">原画</span>
              <IconButton Icon={ArrowClockwiseIcon} label="重新加载预览" onClick={() => window.dispatchEvent(new Event("weijian:reload-preview"))} />
              <IconButton
                Icon={muted ? SpeakerSlashIcon : SpeakerHighIcon}
                label={muted ? "取消静音" : "静音预览"}
                className="preview-mute"
                onClick={() => setMuted((m) => !m)}
              />
              <IconButton
                Icon={ArrowsOutIcon}
                label="全屏预览"
                onClick={() => playerRef.current.requestFullscreen?.()}
              />
            </div>
          </div>
        </section>
        <section className="inspector-panel panel" aria-label="属性面板">
          <div className="panel-header">
            {selectedSubtitle
              ? "文本参数"
              : selectedClip
                ? selectedClip.track === "audio"
                  ? "音频参数"
                  : "视频参数"
                : "草稿参数"}
            {selected && (
              <IconButton
                Icon={XIcon}
                label="取消选择"
                onClick={() => setSelected(null)}
              />
            )}
          </div>
          <div
            key={`${project.id}:${selected?.id || "project"}`}
            className={`inspector-body${!selectedClip && !selectedSubtitle ? " project-inspector" : ""}`}
          >
            {selectedSubtitle ? (
              <>
                <div className="inspector-tabs">
                  <span className="active">基础</span>
                </div>
                <label className="text-field">
                  <span>文本内容</span>
                  <textarea
                    aria-label="字幕内容"
                    value={selectedSubtitle.text}
                    onChange={(e) =>
                      editSubtitle(selectedSubtitle.id, {
                        text: e.target.value,
                      })
                    }
                    rows={4}
                  />
                </label>
                <div className="section-label">时间</div>
                <NumberField
                  label="字幕开始"
                  value={selectedSubtitle.start}
                  onChange={(v) =>
                    editSubtitle(selectedSubtitle.id, { start: v })
                  }
                />
                <NumberField
                  label="字幕时长"
                  value={selectedSubtitle.duration}
                  min={0.04}
                  onChange={(v) =>
                    editSubtitle(selectedSubtitle.id, { duration: v })
                  }
                />
                <div className="section-label">样式</div>
                <label className="field">
                  <span>字体</span>
                  <span className="field-static">系统黑体</span>
                </label>
                <NumberField
                  label="字号"
                  value={selectedSubtitle.fontSize}
                  min={12}
                  max={180}
                  step={1}
                  suffix="px"
                  onChange={(v) =>
                    editSubtitle(selectedSubtitle.id, { fontSize: v })
                  }
                />
                <label className="field">
                  <span>颜色</span>
                  <div className="color-control">
                    <input
                      aria-label="字幕颜色"
                      type="color"
                      value={selectedSubtitle.color}
                      onChange={(e) =>
                        editSubtitle(selectedSubtitle.id, {
                          color: e.target.value,
                        })
                      }
                    />
                    <span>{selectedSubtitle.color.toUpperCase()}</span>
                  </div>
                </label>
                <label className="field">
                  <span>位置</span>
                  <select
                    aria-label="字幕位置"
                    value={selectedSubtitle.position}
                    onChange={(e) =>
                      editSubtitle(selectedSubtitle.id, {
                        position: e.target.value,
                      })
                    }
                  >
                    <option value="top">顶部居中</option>
                    <option value="center">画面居中</option>
                    <option value="bottom">底部居中</option>
                  </select>
                </label>
                <NumberField label="描边宽度" value={selectedSubtitle.outlineWidth ?? Math.max(1, selectedSubtitle.fontSize / 24)} min={0} max={32} step={0.5} suffix="px" onChange={v => editSubtitle(selectedSubtitle.id, { outlineWidth: v })} />
                <label className="field">
                  <span>描边颜色</span>
                  <div className="color-control">
                    <input type="color" aria-label="字幕描边颜色" value={selectedSubtitle.outlineColor || "#000000"} onChange={e => editSubtitle(selectedSubtitle.id, { outlineColor: e.target.value })} />
                    <span>{(selectedSubtitle.outlineColor || "#000000").toUpperCase()}</span>
                  </div>
                </label>
                <Button
                  Icon={TrashIcon}
                  label="删除字幕"
                  className="inspector-delete"
                  onClick={removeSelected}
                />
              </>
            ) : selectedClip ? (
              <>
                <div className="inspector-tabs clip-inspector-tabs">
                  <button className={inspectorTab === "basic" ? "active" : ""} onClick={() => setInspectorTab("basic")}>{selectedClip.track === "video" ? "画面" : "基础"}</button>
                  {selectedClip.track === "video" && <button className={inspectorTab === "adjust" ? "active" : ""} onClick={() => setInspectorTab("adjust")}>调节</button>}
                  {selectedClip.track === "video" && <button className={inspectorTab === "animation" ? "active" : ""} onClick={() => setInspectorTab("animation")}>动画</button>}
                  {selectedClip.track === "video" && <button className={inspectorTab === "mask" ? "active" : ""} onClick={() => setInspectorTab("mask")}>蒙版</button>}
                  {selectedClip.track === "video" && <button className={inspectorTab === "transition" ? "active" : ""} onClick={() => setInspectorTab("transition")}>转场</button>}
                  <button className={inspectorTab === "audio" ? "active" : ""} onClick={() => setInspectorTab("audio")}>音频</button>
                </div>
                <div className="selected-file">
                  <div className="selected-file-icon">
                    {selectedClip.track === "audio" || selectedMedia?.type === "audio" ? (
                      <MusicNotesIcon size={21} />
                    ) : (
                      <FilmStripIcon size={21} />
                    )}
                  </div>
                  <span title={selectedMedia?.name}>{selectedMedia?.name}</span>
                </div>
                {inspectorTab === "basic" && selectedClip.track === "video" && <>
                  {selectedMedia?.type !== "image" && <div className="inspector-subtabs">
                    <button className={pictureTab === "transform" ? "active" : ""} onClick={() => setPictureTab("transform")}>位置大小</button>
                    <button className={pictureTab === "speed" ? "active" : ""} onClick={() => setPictureTab("speed")}><GaugeIcon size={13} />变速</button>
                  </div>}
                  {pictureTab === "transform" || selectedMedia?.type === "image" ? <>
                  <div className="section-label">变换</div>
                  <label className="field"><span>画面轨道</span><select aria-label="画面轨道" value={clipLayer(selectedClip)} onChange={e => editClip(selectedClip.id, { layer: Number(e.target.value) })}>
                    {[0, 1, 2, 3].map(layer => <option key={layer} value={layer}>{layer === 0 ? "主轨道" : `叠加轨道 ${layer}`}</option>)}
                  </select></label>
                  <KeyframeEditor clip={selectedClip} time={time} fps={project.fps} onSeek={key => { setPlaying(false); seek(selectedClip.start + key.time); }} onToggle={toggleTransformKey} onRemove={key => { setPlaying(false); apply(p => { const i = p.clips.findIndex(c => c.id === selectedClip.id); p.clips[i] = removeTransformKey(p.clips[i], key.id, selectedClip.start + key.time); }); }} onEasing={changeKeyEasing} onClear={() => editClip(selectedClip.id, { transform: selectedTransform, transformKeys: [] })}>
                  <NumberField label="缩放" value={selectedTransform.scale * 100} min={10} max={400} step={1} suffix="%" onChange={v => editTransform({ scale: v / 100 })} />
                  <NumberField label="位置 X" value={selectedTransform.x} min={-project.width * 2} max={project.width * 2} step={1} suffix="px" onChange={v => editTransform({ x: v })} />
                  <NumberField label="位置 Y" value={selectedTransform.y} min={-project.height * 2} max={project.height * 2} step={1} suffix="px" onChange={v => editTransform({ y: v })} />
                  <NumberField label="旋转" value={selectedTransform.rotation} min={-360} max={360} step={1} suffix="°" onChange={v => editTransform({ rotation: v })} />
                  <NumberField label="不透明度" value={selectedTransform.opacity * 100} min={0} max={100} step={1} suffix="%" onChange={v => editTransform({ opacity: v / 100 })} />
                  </KeyframeEditor>
                  <div className="inspector-actions compact">
                    <Button label="水平翻转" aria-pressed={clipTransform(selectedClip).flipX} className={clipTransform(selectedClip).flipX ? "is-active" : ""} onClick={() => editTransform({ flipX: !clipTransform(selectedClip).flipX })} />
                    <Button label="垂直翻转" aria-pressed={clipTransform(selectedClip).flipY} className={clipTransform(selectedClip).flipY ? "is-active" : ""} onClick={() => editTransform({ flipY: !clipTransform(selectedClip).flipY })} />
                    <Button label="重置变换" onClick={() => editClip(selectedClip.id, { transform: clipTransform({}), transformKeys: [] })} />
                  </div>
                  </> : <SpeedEditor clip={selectedClip} media={selectedMedia} timing={selectedTiming} time={time} totalCurvePoints={project.clips.reduce((n, c) => n + (clipSpeedCurve(c)?.points.length || 0), 0)} onEdit={(parts, speed) => parts ? setSpeedParts(parts) : editClip(selectedClip.id, { speed })} onAdd={addSpeedPart} onMerge={mergeSpeedPart} onCurveChange={next => editClip(selectedClip.id, { speedCurve: clipSpeedCurve(next) })} onError={message => notify(message, true)} onGestureStart={() => setPlaying(false)} onSeek={at => { setPlaying(false); seek(at); }} />}
                </>}
                {inspectorTab === "adjust" && <>
                  <div className="section-label">基础调节</div>
                  <NumberField label="亮度" value={clipAdjustments(selectedClip).brightness * 100} min={0} max={200} step={1} suffix="%" onChange={v => editAdjustments({ brightness: v / 100 })} />
                  <NumberField label="对比度" value={clipAdjustments(selectedClip).contrast * 100} min={0} max={200} step={1} suffix="%" onChange={v => editAdjustments({ contrast: v / 100 })} />
                  <NumberField label="饱和度" value={clipAdjustments(selectedClip).saturation * 100} min={0} max={200} step={1} suffix="%" onChange={v => editAdjustments({ saturation: v / 100 })} />
                  <Button label="重置调节" onClick={() => editClip(selectedClip.id, { adjustments: clipAdjustments({}) })} />
                  <p className="inspector-hint">100% 为原始画面。调节会应用到预览和导出视频。</p>
                </>}
                {inspectorTab === "animation" && <>
                  <div className="section-label">入场动画</div>
                  <label className="field"><span>入场类型</span><select aria-label="入场动画类型" value={clipAnimation(selectedClip).in > 0 ? clipAnimation(selectedClip).inType : "none"} onChange={e => editAnimation(e.target.value === "none" ? { in: 0 } : { inType: e.target.value, in: Math.min(clipAnimation(selectedClip).in || .5, Math.max(0, selectedClip.duration - clipAnimation(selectedClip).out)) })}><option value="none">无</option>{animationTypes.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label>
                  <NumberField label="入场时长" value={clipAnimation(selectedClip).in} min={0} max={Math.max(0, selectedClip.duration - clipAnimation(selectedClip).out)} step={0.1} onChange={v => editAnimation({ in: v })} />
                  <Button label="定位入场" disabled={!clipAnimation(selectedClip).in} onClick={() => { setPlaying(false); seek(selectedClip.start); }} />
                  <div className="section-label">出场动画</div>
                  <label className="field"><span>出场类型</span><select aria-label="出场动画类型" value={clipAnimation(selectedClip).out > 0 ? clipAnimation(selectedClip).outType : "none"} onChange={e => editAnimation(e.target.value === "none" ? { out: 0 } : { outType: e.target.value, out: Math.min(clipAnimation(selectedClip).out || .5, Math.max(0, selectedClip.duration - clipAnimation(selectedClip).in)) })}><option value="none">无</option>{animationTypes.map(([type, , label]) => <option key={type} value={type}>{label}</option>)}</select></label>
                  <NumberField label="出场时长" value={clipAnimation(selectedClip).out} min={0} max={Math.max(0, selectedClip.duration - clipAnimation(selectedClip).in)} step={0.1} onChange={v => editAnimation({ out: v })} />
                  <Button label="定位出场" disabled={!clipAnimation(selectedClip).out} onClick={() => { setPlaying(false); seek(selectedClip.start + selectedClip.duration - clipAnimation(selectedClip).out); }} />
                  <label className="field"><span>动画缓动</span><select aria-label="动画缓动" value={clipAnimation(selectedClip).easing} onChange={e => editAnimation({ easing: e.target.value })}><option value="linear">线性</option><option value="easeInOut">缓入缓出</option><option value="easeIn">缓入</option><option value="easeOut">缓出</option></select></label>
                  <Button label="移除动画" onClick={() => editClip(selectedClip.id, { animation: clipAnimation({}) })} />
                  <p className="inspector-hint">入场与出场作用于画面；片段声音在音频页单独设置。滑动方向以项目画布为准。</p>
                </>}
                {inspectorTab === "transition" && <>
                  <div className="section-label">下一接点</div>
                  <p className="transition-target">{transitionNext && transitionLimit >= .04
                    ? project.media.find(m => m.id === transitionNext.mediaId)?.name || "下一个画面片段"
                    : "此片段后没有紧邻的同轨画面"}</p>
                  <div className="preset-buttons transition-presets">
                    <button className={selectedTransition.type === "none" ? "active" : ""} aria-pressed={selectedTransition.type === "none"} onClick={() => editClip(selectedClip.id, { transitionOut: { type: "none", duration: 0 } })}>无</button>
                    {transitionTypes.map(([type, label]) => <button key={type} className={selectedTransition.type === type ? "active" : ""} aria-pressed={selectedTransition.type === type} disabled={transitionLimit < .04} onClick={() => applyTransition(type)}>{label}</button>)}
                  </div>
                  {selectedTransition.type !== "none" && <>
                    <NumberField label="转场时长" value={selectedTransition.duration} min={.04} max={transitionLimit} step={.1} onChange={v => editClip(selectedClip.id, { transitionOut: { ...selectedTransition, duration: v } })} />
                    <Button label="预览接点" onClick={() => { const plan = transitionForClip(project, selectedClip); if (plan) { seek(plan.start); setPlaying(true); } }} />
                  </>}
                  <p className="inspector-hint">转场以两段接点为中心，保留工程时长和原声。在片段首尾延展定格帧到转场区域。</p>
                </>}
                {inspectorTab === "mask" && <>
                  <div className="section-label">蒙版形状</div>
                  <div className="mask-presets preset-buttons">
                    {[["none", "无"], ["ellipse", "圆形"], ["rectangle", "矩形"]].map(([type, label]) => <button key={type} className={clipMask(selectedClip).type === type ? "active" : ""} aria-pressed={clipMask(selectedClip).type === type} onClick={() => editMask({ type })}>
                      <span className={`mask-shape ${type}`} aria-hidden="true" />{label}
                    </button>)}
                  </div>
                  {clipMask(selectedClip).type !== "none" && <>
                    <NumberField label="蒙版位置 X" value={clipMask(selectedClip).x * project.width} min={-project.width * 2} max={project.width * 2} step={1} suffix="px" onChange={v => editMask({ x: v / project.width })} />
                    <NumberField label="蒙版位置 Y" value={clipMask(selectedClip).y * project.height} min={-project.height * 2} max={project.height * 2} step={1} suffix="px" onChange={v => editMask({ y: v / project.height })} />
                    <NumberField label="蒙版宽度" value={clipMask(selectedClip).width * 100} min={1} max={400} step={1} suffix="%" onChange={v => editMask({ width: v / 100 })} />
                    <NumberField label="蒙版高度" value={clipMask(selectedClip).height * 100} min={1} max={400} step={1} suffix="%" onChange={v => editMask({ height: v / 100 })} />
                    <NumberField label="蒙版旋转" value={clipMask(selectedClip).rotation} min={-360} max={360} step={1} suffix="°" onChange={v => editMask({ rotation: v })} />
                    <NumberField label="蒙版羽化" value={clipMask(selectedClip).feather} min={0} max={200} step={1} suffix="px" onChange={v => editMask({ feather: v })} />
                    <div className="inspector-actions compact">
                      <Button label="反转蒙版" aria-pressed={clipMask(selectedClip).invert} className={clipMask(selectedClip).invert ? "is-active" : ""} onClick={() => editMask({ invert: !clipMask(selectedClip).invert })} />
                      <Button label="重置蒙版" onClick={() => editClip(selectedClip.id, { mask: { ...clipMask({}), type: clipMask(selectedClip).type } })} />
                    </div>
                  </>}
                  <p className="inspector-hint">宽高相对项目画布，可分别调整。蒙版先裁出画面，再随片段整体变换。</p>
                </>}
                {inspectorTab === "basic" && <>
                <div className="section-label">片段</div>
                <NumberField
                  label="开始时间"
                  value={selectedClip.start}
                  precision={6}
                  step={1 / project.fps}
                  onChange={(v) => moveClip(selectedClip.id, v)}
                />
                <div className="inspector-actions compact"><Button label="前移一帧" disabled={selectedClip.start < 1 / project.fps} onClick={() => moveClip(selectedClip.id, Math.max(0, selectedClip.start - 1 / project.fps))} /><Button label="后移一帧" onClick={() => moveClip(selectedClip.id, selectedClip.start + 1 / project.fps)} /><Button label="移到播放头" onClick={() => moveClip(selectedClip.id, time)} /></div>
                <NumberField
                  label="素材入点"
                  value={selectedClip.sourceStart}
                  max={Math.max(
                    0,
                    (selectedMedia?.duration || 3600) -
                      selectedTiming.sourceDuration,
                  )}
                  onChange={(v) =>
                    editClip(selectedClip.id, { sourceStart: v })
                  }
                  disabled={selectedMedia?.type === "image"}
                />
                <NumberField
                  label="片段时长"
                  value={selectedClip.duration}
                  min={0.04}
                  max={
                    selectedMedia?.type === "image"
                      ? 900
                      : selectedBounds.maxEnd - selectedClip.start
                  }
                  onChange={(v) => editClip(selectedClip.id, { duration: v })}
                />
                {selectedClip.track === "audio" && <SpeedEditor clip={selectedClip} media={selectedMedia} timing={selectedTiming} time={time} totalCurvePoints={project.clips.reduce((n, c) => n + (clipSpeedCurve(c)?.points.length || 0), 0)} onEdit={(parts, speed) => parts ? setSpeedParts(parts) : editClip(selectedClip.id, { speed })} onAdd={addSpeedPart} onMerge={mergeSpeedPart} onCurveChange={next => editClip(selectedClip.id, { speedCurve: clipSpeedCurve(next) })} onError={message => notify(message, true)} onGestureStart={() => setPlaying(false)} onSeek={at => { setPlaying(false); seek(at); }} />}
                </>}
                {inspectorTab === "audio" && <AudioInspector clip={selectedClip} media={selectedMedia} project={project} time={time} playing={playing} section={audioSection} onSectionChange={setAudioSection} keyActions={{
                  onSeek: key => { setPlaying(false); seek(selectedClip.start + key.time); },
                  onToggle: toggleAudioGainKey,
                  onRemove: key => mutateAudioGain(clip => removeAudioGainKey(clip, key.id)),
                  onEasing: (easing, chosen) => mutateAudioGain(clip => { const current = chosen || audioGainKeyNavigation(clip, time).current; return current ? setAudioGainKeyEasing(clip, current.id, easing) : clip; }),
                  onGain: (gain, chosen) => mutateAudioGain(clip => upsertAudioGainKey(clip, chosen ? clip.start + chosen.time : time, gain, chosen?.easing || "linear")),
                  onClear: () => editClip(selectedClip.id, { audioGainKeys: [] }),
                }} onEdit={patch => editClip(selectedClip.id, patch)} onDetach={detachSelectedAudio} onPreview={() => { setPlaying(false); if (audioPreview) setDialog("audio-preview"); else startAudioPreview(); }} previewBusy={audioPreviewBusy} previewExists={!!audioPreview} />}
                <div className="inspector-actions">
                  <Button
                    Icon={ScissorsIcon}
                    label="分割"
                    onClick={splitSelected}
                  />
                  <Button
                    Icon={TrashIcon}
                    label="删除"
                    onClick={removeSelected}
                  />
                </div>
                <p className="inspector-hint">
                  拖动片段两端裁剪，拖动中间调整顺序。
                </p>
              </>
            ) : (
              <>
                <dl className="project-details">
                  <dt>草稿名称</dt>
                  <dd>{project.name || "未命名项目"}</dd>
                  <dt>保存位置</dt>
                  <dd className="location-value">
                    <FolderOpenIcon size={13} />
                    本机 · 项目资料库
                  </dd>
                  <dt>色彩空间</dt>
                  <dd>Rec.709 SDR</dd>
                  <dt>导入方式</dt>
                  <dd>保留原始素材</dd>
                  <dt>自动保存</dt>
                  <dd>
                    <span className="enabled-dot" />
                    已开启
                  </dd>
                  <dt>素材数量</dt>
                  <dd>{project.media.length} 个</dd>
                </dl>
                <div className="inspector-separator" />
                <dl className="project-details">
                  <dt>时间线名称</dt>
                  <dd>时间线 01</dd>
                  <dt>画面比例</dt>
                  <dd>
                    {project.width === project.height
                      ? "1:1"
                      : project.width > project.height
                        ? "16:9"
                        : "9:16"}
                  </dd>
                  <dt>分辨率</dt>
                  <dd>
                    {project.width} × {project.height}
                  </dd>
                  <dt>草稿帧率</dt>
                  <dd>{project.fps.toFixed(2)} 帧/秒</dd>
                  <dt>时长</dt>
                  <dd>{timelineLabel(duration, project.fps)}</dd>
                </dl>
                <Button
                  className="modify-canvas"
                  label="修改"
                  onClick={() => setDialog("canvas")}
                />
              </>
            )}
          </div>
        </section>
      </div>
      <Timeline
        ref={timelineRef}
        project={project}
        time={time}
        onSeek={seek}
        selected={selected}
        onSelect={setSelected}
        activeAudioLane={activeAudioLane}
        onSelectAudioLane={setActiveAudioLane}
        onEditAudioLane={editAudioLane}
        onSelectAudioKey={(id, keyId) => {
          setPlaying(false); setSelected({ kind: "clip", id, audioKey: keyId }); setInspectorTab("audio"); setAudioSection("keys");
        }}
        onTrimClip={trimTimelineClip}
        onMoveClip={moveClip}
        onGestureStart={() => setPlaying(false)}
        onEditSubtitle={editSubtitle}
        onDropMedia={addMedia}
        onSplit={splitSelected}
        onDelete={removeSelected}
        onDuplicate={() => duplicateClip()}
        onSelectTransition={id => { setSelected({ kind: "clip", id }); setTab("transition"); setInspectorTab("transition"); }}
        onSelectTransformKey={(id, keyId) => {
          setPlaying(false); setSelected({ kind: "clip", id }); setTab("media"); setInspectorTab("basic"); setPictureTab("transform");
        }}
        onUndo={undo}
        onRedo={redo}
        canUndo={!!history.past.length}
        canRedo={!!history.future.length}
        zoom={zoom}
        onZoom={setZoom}
      />
      <footer className="status-bar">
        <span>
          <CircleIcon size={6} weight="fill" />
          {health?.ok ? "本地引擎已连接" : "正在连接本地引擎"}
        </span>
        <span>
          {project.clips.filter((c) => c.track === "video").length} 个画面片段
          <span className="status-divider">|</span>
          {project.subtitles.length} 条字幕
          <span className="status-divider">|</span>
          {project.fps} fps
        </span>
        <button onClick={() => setHelpOpen(true)}>
          空格 播放 / 暂停<span>⌘ S 保存</span>
        </button>
      </footer>
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? (
            <WarningCircleIcon size={18} />
          ) : (
            <CheckCircleIcon size={18} />
          )}
          {toast.text}
        </div>
      )}
      {dialog === "projects" && (
        <Modal
          title="我的工程"
          onClose={() => setDialog(null)}
          className="projects-modal"
        >
          <div className="projects-toolbar">
            <span>保存在此设备上的创作</span>
            <Button Icon={PlusIcon} label="新建工程" onClick={createProject} />
          </div>
          <div className="projects-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className="saved-project"
                onClick={() => openProject(p.id)}
              >
                {p.thumbnailUrl ? (
                  <img src={p.thumbnailUrl} alt="工程封面" />
                ) : (
                  <div>
                    <FilmStripIcon size={24} />
                  </div>
                )}
                <span>
                  <strong>{p.name || "未命名项目"}</strong>
                  <small>
                    {new Date(p.updatedAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                  </small>
                </span>
                <span className="project-length">
                  {(p.duration || 0).toFixed(1)} 秒
                </span>
                <CaretRightIcon size={15} />
              </button>
            ))}
            {!projects.length && <p className="subtle">还没有保存的工程。</p>}
          </div>
          <div className="modal-footer">
            {window.weijianDesktop?.chooseJianyingDraft && <Button
              data-jianying-entry="true"
              Icon={FolderOpenIcon}
              label="导入剪映草稿…"
              onClick={openJianyingDraftImport}
            />}
            {project.importReportId && <Button
              label="草稿导入报告"
              onClick={() => setDialog("jianying-report")}
            />}
            <Button
              Icon={UploadSimpleIcon}
              label="打开工程文件"
              onClick={() => projectImportRef.current.click()}
            />
            <Button
              Icon={DownloadSimpleIcon}
              label="下载当前工程"
              onClick={downloadProject}
            />
          </div>
        </Modal>
      )}
      {(dialog === "jianying-import" || dialog === "jianying-report") && <JianyingDraftImport
        key={dialog}
        reportId={dialog === "jianying-report" ? project.importReportId : undefined}
        onClose={() => setDialog(null)}
        onBeforeCommit={saveBeforeDraftImport}
        onImported={openImportedDraft}
      />}
      {dialog === "canvas" && (
        <Modal
          title="草稿设置"
          onClose={() => setDialog(null)}
          className="settings-modal"
        >
          <div className="modal-content">
            <label className="field">
              <span>画面比例</span>
              <select
                aria-label="画面比例"
                value={`${project.width}x${project.height}`}
                onChange={(e) => {
                  const [width, height] = e.target.value.split("x").map(Number);
                  apply((p) => Object.assign(p, { width, height }));
                }}
              >
                <option value="1920x1080">16:9 横屏 · 1920 × 1080</option>
                <option value="1080x1920">9:16 竖屏 · 1080 × 1920</option>
                <option value="1080x1080">1:1 方形 · 1080 × 1080</option>
                <option value="1280x720">16:9 横屏 · 1280 × 720</option>
              </select>
            </label>
            <label className="field">
              <span>帧率</span>
              <select
                aria-label="草稿帧率"
                value={project.fps}
                onChange={(e) =>
                  apply((p) => {
                    p.fps = Number(e.target.value);
                  })
                }
              >
                {[24, 25, 30, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} fps
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="modal-footer">
            <Button
              className="primary"
              label="完成"
              onClick={() => setDialog(null)}
            />
          </div>
        </Modal>
      )}
      {dialog === "audio-preview" && <Modal title="工程混音 · 保调预听" onClose={() => setDialog(null)} className="export-modal">
        <div className="modal-content">
          <p>生成整个工程的 WAV，包含各音轨的变速、静音、音量与淡化；与视频导出共用队列。</p>
          {audioPreviewStale && <p className="export-error" role="status">工程已修改。这是旧版预听，请重新生成以听取当前工程。</p>}
          {audioPreviewStarting ? <p role="status">正在提交保调预听…</p> : audioPreviewBusy ? <div className="export-progress">
            <SpinnerGapIcon size={30} className="spin" />
            <strong>{audioPreview.job.status === "queued" ? "等待音频处理" : "正在生成保调预听"}</strong>
            <div className="progress-bar"><div style={{ width: `${Math.max(1, audioPreview.job.progress || 0)}%` }} /></div>
            <span>{Math.round(audioPreview.job.progress || 0)}%</span>
            <Button label="取消保调预听" onClick={async () => {
              try {
                const job = await api(`/api/exports/${audioPreview.job.id}`, { method: "DELETE" });
                setAudioPreview(current => ({ ...current, job }));
              } catch (error) { notify(error.message, true); }
            }} />
          </div> : audioPreview?.job.status === "completed" ? <>
            <p>{audioPreview.name} · WAV</p>
            <audio key={audioPreview.job.id} controls preload="metadata" src={audioPreview.job.url} aria-label="工程混音保调预听" onPlay={() => setPlaying(false)} style={{ width: "100%" }} />
            <a className="button" href={audioPreview.job.url} download={audioPreview.job.filename}><DownloadSimpleIcon size={16} />保存预听 WAV</a>
          </> : <p role="status">{audioPreview?.job.error || (audioPreview?.job.status === "cancelled" ? "保调预听已取消。" : "尚未生成预听。")}</p>}
        </div>
        <div className="modal-footer"><Button label="返回编辑" onClick={() => setDialog(null)} /><Button className="primary" label="重新生成保调预听" disabled={audioPreviewStarting || audioPreviewBusy || !duration || !health?.ok} onClick={startAudioPreview} /></div>
      </Modal>}
      {dialog === "export" && (
        <Modal
          title="导出视频"
          onClose={() => setDialog(null)}
          className="export-modal"
        >
          <div className="export-summary">
            <div className="export-cover">
              {project.media.find((m) => m.type !== "audio")?.thumbnailUrl ? (
                <img
                  src={
                    project.media.find((m) => m.type !== "audio").thumbnailUrl
                  }
                  alt="导出封面"
                />
              ) : (
                <FilmStripIcon size={30} />
              )}
            </div>
            <div>
              <strong>{project.name || "未命名项目"}</strong>
              <span>时长 {duration.toFixed(2)} 秒 · MP4 / H.264</span>
              <small>视频、字幕和配乐将合成为一个文件</small>
            </div>
          </div>
          {!exportJob || ["failed", "cancelled"].includes(exportJob.status) ? (
            <>
              <div className="export-settings">
                <label className="field">
                  <span>分辨率</span>
                  <select
                    aria-label="导出分辨率"
                    value={exportSettings.height}
                    onChange={(e) => {
                      const height = Number(e.target.value);
                      setExportSettings((s) => ({
                        ...s,
                        height,
                        width:
                          Math.round(
                            (height * project.width) / project.height / 2,
                          ) * 2,
                      }));
                    }}
                  >
                    <option value="720">720P 高清</option>
                    <option value="1080">1080P 全高清</option>
                    {project.height === 1920 && (
                      <option value="1920">1920P 竖屏</option>
                    )}
                  </select>
                </label>
                <label className="field">
                  <span>帧率</span>
                  <select
                    aria-label="导出帧率"
                    value={exportSettings.fps}
                    onChange={(e) =>
                      setExportSettings((s) => ({
                        ...s,
                        fps: Number(e.target.value),
                      }))
                    }
                  >
                    {[24, 25, 30, 60].map((n) => (
                      <option key={n} value={n}>
                        {n} fps
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>画质</span>
                  <select
                    aria-label="导出画质"
                    value={exportSettings.quality}
                    onChange={(e) =>
                      setExportSettings((s) => ({
                        ...s,
                        quality: e.target.value,
                      }))
                    }
                  >
                    <option value="high">高画质</option>
                    <option value="standard">标准</option>
                  </select>
                </label>
                <label className="field">
                  <span>格式</span>
                  <span className="field-static">MP4 · H.264 + AAC</span>
                </label>
                <label className="field">
                  <span>保存到</span>
                  <span className="field-static">本机导出文件夹</span>
                </label>
              </div>
              {exportJob?.error && (
                <p className="export-error">{exportJob.error}</p>
              )}
              {exportJob?.status === "cancelled" && (
                <p className="subtle">已取消导出，可重新开始。</p>
              )}
              <div className="modal-footer">
                <Button label="取消" onClick={() => setDialog(null)} />
                <Button
                  className="primary"
                  Icon={ExportIcon}
                  label="开始导出"
                  disabled={
                    !project.clips.length ||
                    !duration ||
                    !health?.ok ||
                    exportStarting
                  }
                  onClick={startExport}
                />
              </div>
            </>
          ) : busy ? (
            <div className="export-progress">
              <SpinnerGapIcon size={34} className="spin" />
              <strong>正在导出，请稍候</strong>
              <div className="progress-bar">
                <div
                  style={{ width: `${Math.max(1, exportJob.progress || 0)}%` }}
                />
              </div>
              <span>{Math.round(exportJob.progress || 0)}%</span>
              <small>正在合成画面、字幕与声音</small>
              <Button
                label="取消导出"
                onClick={async () => {
                  try {
                    setExportJob(
                      await api(`/api/exports/${exportJob.id}`, {
                        method: "DELETE",
                      }),
                    );
                  } catch (e) {
                    notify(e.message, true);
                  }
                }}
              />
            </div>
          ) : (
            <div className="export-complete">
              <CheckCircleIcon size={48} weight="light" />
              <strong>视频已导出</strong>
              <p>你的故事，已经准备好被看见。</p>
              <a
                className="button primary"
                href={exportJob.url}
                download={exportJob.filename}
              >
                <DownloadSimpleIcon size={17} />
                下载视频
              </a>
              <a
                className="text-link"
                href={exportJob.url}
                target="_blank"
                rel="noreferrer"
              >
                预览成片
                <ArrowRightIcon size={13} />
              </a>
              <Button label="返回编辑" onClick={() => setDialog(null)} />
            </div>
          )}
        </Modal>
      )}
      {helpOpen && (
        <Modal
          title="创作，从这里开始"
          onClose={() => setHelpOpen(false)}
          className="help-modal"
        >
          <div className="modal-content">
            <ol className="help-steps">
              <li>
                <strong>导入素材</strong>
                <span>拖入视频、图片或音乐，也可以体验示例工程。</span>
              </li>
              <li>
                <strong>编排你的故事</strong>
                <span>
                  点击素材添加到轨道，拖动片段调整顺序，拖动两端裁剪。复制画面到上层轨道，组合画中画。
                </span>
              </li>
              <li>
                <strong>添加文字和声音</strong>
                <span>
                  在文本页添加或导入 SRT 字幕；选中片段后在右侧调整画面、调色、速度和声音。
                </span>
              </li>
              <li>
                <strong>保存与导出</strong>
                <span>工程自动保存在本机；点击导出，将剪辑合成为 MP4。</span>
              </li>
            </ol>
            <div className="shortcut-list">
              <span>
                播放 / 暂停<kbd>空格</kbd>
              </span>
              <span>
                分割片段<kbd>B</kbd>
              </span>
              <span>
                复制画面到上层<kbd>⌘ / Ctrl D</kbd>
              </span>
              <span>
                复制 / 粘贴画面<kbd>⌘ / Ctrl C / V</kbd>
              </span>
              <span>
                删除选中内容<kbd>Delete</kbd>
              </span>
              <span>
                保存工程<kbd>⌘ / Ctrl S</kbd>
              </span>
              <span>
                撤销<kbd>⌘ / Ctrl Z</kbd>
              </span>
              <span>
                逐帧移动<kbd>← →</kbd>
              </span>
            </div>
            <p className="subtle">
              示例画面由 AI
              生成，配乐为合成示例音频。工程文件引用此设备上的素材；跨设备迁移时需一并保留素材。
            </p>
          </div>
          <div className="modal-footer">
            <Button
              label="体验示例"
              onClick={() => {
                setHelpOpen(false);
                useDemo();
              }}
            />
            <Button
              className="primary"
              label="开始创作"
              onClick={() => setHelpOpen(false)}
            />
          </div>
        </Modal>
      )}
    </main>
  );
}
