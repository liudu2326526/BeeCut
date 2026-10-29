const mediaErrors = {
  1: ["MEDIA_ABORTED", "素材加载已中断"],
  2: ["MEDIA_NETWORK_ERROR", "无法读取预览素材，请检查素材是否仍可访问"],
  3: ["MEDIA_DECODE_ERROR", "当前素材无法解码预览"],
  4: ["MEDIA_NOT_SUPPORTED", "当前素材格式无法预览，或素材读取失败"],
};
export const PREVIEW_CONTROLLER_REVISION = "0.5.0-preview-diagnostics-5";

function timeRanges(value) {
  if (!value) return null;
  try {
    const count = value.length, indices = [...new Set([0, 1, 2, count - 1])].filter(index => index >= 0 && index < count);
    return { count, ranges: indices.map(index => [value.start(index), value.end(index)]) };
  } catch { return { unavailable: true }; }
}

// One controller owns a single element, including its source, event listeners and
// pending play request. React supplies the latest desired position; asynchronous
// events never retain a position or play intent from an earlier render.
export function createPreviewController(element, {
  onStatus = () => {}, timeoutMs = 8000,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let desired = null, source = null, epoch = 0, intent = 0;
  let destroyed = false, pendingPlay = null, failure = null, lastFailure = null, deadline = null;
  let initialSeekPending = false;
  let lastStatus = "", phase = "idle";
  const listeners = [];
  const bornAt = performance.now(), eventTail = [];
  let lastTimeUpdate = -Infinity;
  const finite = value => Number.isFinite(value) ? value : null;
  function observe(event) {
    const atMs = Math.round((performance.now() - bornAt) * 10) / 10;
    if (event === "timeupdate" && atMs - lastTimeUpdate < 1000) return;
    if (event === "timeupdate") lastTimeUpdate = atMs;
    eventTail.push({ event, atMs, epoch, ready: element.readyState, network: element.networkState,
      time: finite(element.currentTime), paused: !!element.paused, seeking: !!element.seeking });
    if (eventTail.length > 32) eventTail.shift();
  }

  function snapshot() {
    let quality = null;
    try {
      const result = element.getVideoPlaybackQuality?.();
      if (result) quality = { total: result.totalVideoFrames, dropped: result.droppedVideoFrames, corrupted: result.corruptedVideoFrames };
    } catch { /* An unavailable browser metric is not a media failure. */ }
    const doc = typeof document === "undefined" ? null : document;
    let sourceMatches = null;
    try { sourceMatches = source && doc ? new URL(source, doc.baseURI).href === element.currentSrc : null; } catch { /* Unknown source identity. */ }
    return {
      revision: PREVIEW_CONTROLLER_REVISION,
      startedAtNavigationMs: Math.round(bornAt * 10) / 10,
      phase, code: failure?.code || null, message: failure?.message || null,
      readyState: element.readyState, networkState: element.networkState,
      mediaTime: Number.isFinite(element.currentTime) ? element.currentTime : null,
      targetTime: desired?.target ?? null, seeking: !!element.seeking,
      playingRequested: !!desired?.playing, sourceEpoch: epoch,
      initialPositionRequested: !initialSeekPending, failedPhase: failure?.fromPhase || null,
      paused: !!element.paused, ended: !!element.ended, duration: finite(element.duration),
      videoWidth: finite(element.videoWidth), videoHeight: finite(element.videoHeight),
      muted: !!element.muted, volume: finite(element.volume), playbackRate: finite(element.playbackRate),
      requestedVolume: finite(desired?.volume),
      buffered: timeRanges(element.buffered), seekable: timeRanges(element.seekable),
      decodedFrames: finite(element.webkitDecodedFrameCount), droppedFrames: finite(element.webkitDroppedFrameCount), quality,
      visibility: doc?.visibilityState ?? null, hidden: doc?.hidden ?? null, focused: doc?.hasFocus?.() ?? null,
      mediaErrorCode: element.error?.code ?? null, sourceMatches,
      lastFailure: lastFailure ? { ...lastFailure } : null, eventTail: eventTail.map(item => ({ ...item })),
    };
  }
  function publish(next) {
    phase = next;
    const signature = `${phase}:${failure?.code || ""}:${epoch}`;
    if (signature !== lastStatus) {
      lastStatus = signature;
      onStatus(snapshot());
    }
  }
  function stopDeadline() {
    if (deadline !== null) clearTimer(deadline);
    deadline = null;
  }
  function fail(code, message) {
    if (destroyed) return;
    stopDeadline();
    failure = { code, message, fromPhase: phase };
    lastFailure = { ...failure, atMs: Math.round(performance.now() - bornAt) };
    observe(`failure:${code}`);
    intent++;
    pendingPlay = null;
    element.pause();
    publish("error");
  }
  function wait(next) {
    publish(next);
    if (deadline !== null) return;
    const waitingEpoch = epoch;
    deadline = setTimer(() => {
      deadline = null;
      if (!destroyed && epoch === waitingEpoch)
        fail("PREVIEW_TIMEOUT", "预览等待超过 8 秒。可重新加载当前素材；工程和导出不受此操作影响");
    }, timeoutMs);
  }
  function pause() {
    intent++;
    pendingPlay = null;
    if (!element.paused) element.pause();
  }
  function reconcile() {
    if (destroyed || !desired) return;
    if (failure) {
      // A readiness deadline is an observation, not a permanently failed
      // decoder. The same source can finish loading after that deadline.
      // Accept actual late readiness without retrying or resuming playback.
      if (failure.code === "PREVIEW_TIMEOUT" && element.readyState >= 2 && !element.seeking && !element.error) {
        observe("late-readiness-after-timeout");
        failure = null;
        desired = { ...desired, playing: false };
      } else return;
    }
    if (element.error) {
      const [code, message] = mediaErrors[element.error.code] || ["MEDIA_ERROR", "素材预览失败"];
      fail(code, message);
      return;
    }
    if (element.readyState < 1 || !Number.isFinite(element.duration)) {
      wait("loading");
      return;
    }
    const target = Math.min(desired.target, Math.max(0, element.duration - .001));
    const tolerance = desired.playing ? .24 : .015;
    if (element.seeking) {
      wait("seeking");
      return;
    }
    if (initialSeekPending || Math.abs(element.currentTime - target) > tolerance) {
      // Avoid an old pending play resolving at the new seek position. Playback
      // resumes only when seeked has confirmed the latest desired frame.
      pause();
      // Metadata can be available while the paused first frame has not been
      // requested. Setting currentTime even at 0 issues one explicit position
      // request for each source epoch; waiting for loadeddata alone can stall.
      initialSeekPending = false;
      observe("seek-request");
      try { element.currentTime = target; }
      catch { fail("SEEK_FAILED", "无法定位到当前画面，请重新加载预览"); return; }
      wait("seeking");
      return;
    }
    if (element.readyState < 2) {
      wait("buffering");
      return;
    }
    stopDeadline();
    if (!desired.playing) {
      if (pendingPlay || !element.paused) pause();
      publish("ready");
      return;
    }
    if (element.ended) {
      // play() on an ended element implicitly jumps to its first frame. If the
      // timeline is still within the small playing tolerance of the source end,
      // hold the decoded final frame until the timeline advances to the cut.
      pause();
      publish("ready");
      return;
    }
    if (!element.paused) { publish("playing"); return; }
    if (pendingPlay) return;
    const playEpoch = epoch, playIntent = ++intent;
    pendingPlay = { epoch: playEpoch, intent: playIntent };
    observe("play-request");
    publish("starting");
    let promise;
    try { promise = element.play(); }
    catch (error) { promise = Promise.reject(error); }
    Promise.resolve(promise).then(() => {
      if (destroyed || playEpoch !== epoch || playIntent !== intent) return;
      pendingPlay = null;
      observe("play-resolved");
      if (!desired?.playing) { pause(); publish("ready"); }
      else if (element.readyState < 2 || element.paused) wait("buffering");
      else { stopDeadline(); publish("playing"); }
    }, error => {
      if (destroyed || playEpoch !== epoch || playIntent !== intent) return;
      pendingPlay = null;
      observe(`play-rejected:${error?.name || "unknown"}`);
      fail(error?.name === "NotAllowedError" ? "PLAY_NOT_ALLOWED" : "PLAY_FAILED",
        error?.name === "NotAllowedError" ? "播放被系统阻止，请点击重新加载预览后再播放" : "预览播放未能开始，请重新加载当前素材");
    });
    // A pending play promise is not proof that decoding or playback began.
    wait("starting");
  }
  function update(next) {
    if (destroyed) return;
    desired = { ...next, target: Math.max(0, Number(next.target) || 0) };
    if (source !== next.source) {
      source = next.source;
      epoch++;
      initialSeekPending = true;
      pause();
      stopDeadline();
      failure = null;
      lastFailure = null;
      if (!source) { fail("SOURCE_MISSING", "当前素材没有可读取的预览地址"); return; }
      element.src = source;
      observe("source-load");
      element.load();
      publish("loading");
    }
    element.playbackRate = Math.max(.25, Math.min(4, Number(next.rate) || 1));
    element.preservesPitch = true;
    if ("webkitPreservesPitch" in element) element.webkitPreservesPitch = true;
    element.volume = Math.max(0, Math.min(1, Number(next.volume) || 0));
    element.muted = !!next.muted;
    if (!next.playing && pendingPlay) pause();
    reconcile();
  }
  function on(name, action) {
    const listener = () => { observe(name); action(); };
    element.addEventListener(name, listener);
    listeners.push([name, listener]);
  }
  for (const name of ["loadedmetadata", "loadeddata", "canplay", "seeked", "playing", "timeupdate", "ended"])
    on(name, reconcile);
  for (const name of ["waiting", "stalled"])
    on(name, () => {
      if (!desired?.playing || failure) return;
      // stalled describes network fetching, not necessarily missing playback
      // data. Do not freeze a fully buffered picture on that warning alone.
      if (element.readyState < 3 || element.paused) wait("buffering");
      else reconcile();
    });
  on("error", reconcile);
  for (const name of ["loadstart", "progress", "suspend", "abort", "emptied", "pause", "seeking"])
    on(name, () => {});
  const onVisible = () => { observe("visibilitychange"); if (typeof document === "undefined" || document.visibilityState === "visible") reconcile(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  return {
    update,
    retry() {
      if (destroyed || !desired) return;
      source = null;
      observe("manual-reload");
      update(desired);
    },
    fail,
    snapshot,
    destroy() {
      destroyed = true;
      epoch++;
      pause();
      stopDeadline();
      for (const [name, listener] of listeners) element.removeEventListener(name, listener);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      // Release this decoder and its network request after unmount/source reuse.
      element.removeAttribute("src");
      element.load();
    },
  };
}
