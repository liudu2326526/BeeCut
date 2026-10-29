import { useEffect, useRef, useState } from "react";
import { FolderOpenIcon, WarningCircleIcon, XIcon, SpinnerGapIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { Button, IconButton } from "./EditorControls.jsx";
import "./jianying-draft-import.css";

const jsonPost = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function request(path, options) {
  const response = await fetch(path, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`);
  return result;
}
const valueText = value => value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
const statusLabels = { scanning: "正在只读检查草稿", "needs-timeline": "请选择时间线", unsupported: "无法导入此草稿", blocked: "需要处理预检问题", ready: "预检完成", importing: "正在复制素材并创建工程", completed: "工程已导入", cancelled: "导入已取消", failed: "导入未完成" };
const pathFor = id => `/api/jianying/imports/${encodeURIComponent(id)}`;
const PAGE_SIZE = 50;
function ReportPage({ items, label, children }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const shown = Math.min(page, pages - 1);
  return <>{children(items.slice(shown * PAGE_SIZE, (shown + 1) * PAGE_SIZE), shown * PAGE_SIZE)}{pages > 1 && <nav className="jianying-report-pagination" aria-label={`${label}分页`}><span>共 {items.length} 项 · 第 {shown + 1} / {pages} 页（每页最多 {PAGE_SIZE} 项）</span><Button label="上一页" aria-label={`${label}上一页`} disabled={shown === 0} onClick={() => setPage(shown - 1)} /><Button label="下一页" aria-label={`${label}下一页`} disabled={shown >= pages - 1} onClick={() => setPage(shown + 1)} /></nav>}</>;
}

/** The renderer receives scoped native grants; it never chooses filesystem paths for the service. */
export function JianyingDraftImport({ onClose, onBeforeCommit, onImported, reportId, bridge = window.weijianDesktop, call = request }) {
  const [session, setSession] = useState(null);
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(reportId ? "report" : null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cleanupPending, setCleanupPending] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [showMissingOnly, setShowMissingOnly] = useState(true);
  const dialog = useRef(null);
  const active = useRef(true);
  const sessionRef = useRef(null);
  const cancelRequested = useRef(false);
  const operation = useRef(false);
  const completionHandled = useRef(false);
  sessionRef.current = session;
  const desktop = typeof bridge?.chooseJianyingDraft === "function";

  useEffect(() => {
    active.current = true;
    const previous = document.activeElement;
    dialog.current?.querySelector("button:not(:disabled)")?.focus();
    return () => { active.current = false; previous?.focus(); };
  }, []);

  useEffect(() => {
    if (!reportId) return;
    let stopped = false;
    call(`/api/jianying/reports/${encodeURIComponent(reportId)}`).then(report => {
      if (!stopped) { receive(report); setDirectory(report.directory || "已导入草稿"); }
    }).catch(failure => { if (!stopped) setError(`无法读取导入报告：${failure.message}`); })
      .finally(() => { if (!stopped) setBusy(null); });
    return () => { stopped = true; };
  }, [reportId]);

  function receive(next) {
    if (!active.current) return;
    sessionRef.current = next;
    setSession(next);
  }
  async function discard(id) {
    if (id) return call(pathFor(id), { method: "DELETE" });
  }
  async function cancel() {
    if (reportId || sessionRef.current?.status === "completed") { onClose(); return; }
    if (cancelRequested.current) return;
    cancelRequested.current = true;
    completionHandled.current = true;
    setCleanupPending(true);
    setBusy("cancelling");
    setError("");
    // A scan does not expose its session id until it completes. Its caller
    // performs the awaited cancellation as soon as that id arrives.
    if (operation.current && !sessionRef.current?.id) return;
    try {
      const result = await discard(sessionRef.current?.id);
      if (result?.status === "completed" && active.current) {
        receive(result);
        setNotice("取消请求到达时，独立工程已经保存。当前编辑保持原状，可从“我的工程”打开新工程。");
        cancelRequested.current = false;
        setCleanupPending(false);
        setBusy(null);
        return;
      }
      if (active.current) onClose();
    } catch (failure) {
      cancelRequested.current = false;
      setBusy(null);
      setError(`取消未完成：${failure.message}。请重试取消。`);
    }
  }
  async function choose() {
    if (operation.current) return;
    operation.current = true;
    setBusy("choosing"); setError(""); setAcknowledged(false);
    try {
      const chosen = await bridge.chooseJianyingDraft();
      if (!active.current || cancelRequested.current) { if (active.current) onClose(); return; }
      if (chosen?.canceled) {
        if (cancelRequested.current) onClose();
        return;
      }
      if (!chosen?.grantId) throw new Error("未收到草稿文件夹的读取授权，请重新选择");
      if (sessionRef.current?.id) await discard(sessionRef.current.id);
      setDirectory(chosen.directory || "所选草稿文件夹");
      receive(null);
      if (cancelRequested.current) { onClose(); return; }
      setBusy("scanning");
      const next = await call("/api/jianying/imports", jsonPost({ grantId: chosen.grantId }));
      if (cancelRequested.current || !active.current) {
        sessionRef.current = next;
        if (active.current) setSession(next);
        await discard(next.id);
        if (active.current) onClose();
        return;
      }
      receive(next);
    } catch (failure) {
      if (active.current) {
        setError(cancelRequested.current ? `取消未完成：${failure.message}。请重试取消。` : failure.message);
        cancelRequested.current = false;
      }
    } finally {
      operation.current = false;
      if (active.current && !cancelRequested.current) setBusy(null);
    }
  }
  async function update(kind, body) {
    if (operation.current || !sessionRef.current?.id) return;
    operation.current = true; setBusy(kind); setError(""); setAcknowledged(false);
    try {
      const next = await call(`${pathFor(sessionRef.current.id)}/${kind}`, jsonPost(body));
      if (cancelRequested.current) return;
      receive(next);
    } catch (failure) {
      if (!cancelRequested.current) setError(failure.message);
    } finally {
      operation.current = false;
      if (active.current && !cancelRequested.current) setBusy(null);
    }
  }
  async function relink(sourceId) {
    if (operation.current) return;
    operation.current = true; setBusy("locating"); setError("");
    try {
      const chosen = await bridge.chooseJianyingMedia({ sessionId: sessionRef.current.id, sourceId });
      if (chosen?.canceled || cancelRequested.current) return;
      if (!chosen?.grantId) throw new Error("未收到素材的读取授权，请重新选择");
      operation.current = false;
      await update("relink", { sourceId, grantId: chosen.grantId });
    } catch (failure) {
      if (!cancelRequested.current) setError(failure.message);
    } finally {
      operation.current = false;
      if (active.current && !cancelRequested.current) setBusy(null);
    }
  }
  async function completed(next) {
    if (!active.current || completionHandled.current || cancelRequested.current) return;
    if (!next.project) throw new Error("导入服务未返回已保存的工程，请保留报告后重试");
    completionHandled.current = true;
    try { await onImported(next.project, next); }
    catch (failure) { completionHandled.current = false; throw failure; }
  }
  async function commit() {
    if (operation.current || !sessionRef.current?.canCommit) return;
    operation.current = true; setBusy("saving"); setError("");
    try {
      if (onBeforeCommit && !(await onBeforeCommit())) throw new Error("当前工程尚未保存，导入未开始。请先完成保存后重试。");
      if (cancelRequested.current) return;
      setBusy("importing");
      const next = await call(`${pathFor(sessionRef.current.id)}/commit`, jsonPost({ acknowledgeWarnings: acknowledged }));
      if (cancelRequested.current) return;
      receive(next);
      if (next.status === "completed") await completed(next);
      else if (next.status === "failed") setError(next.error || "导入失败，请查看报告后重试");
    } catch (failure) {
      if (!cancelRequested.current) setError(failure.message);
    } finally {
      operation.current = false;
      if (active.current && !cancelRequested.current) setBusy(null);
    }
  }
  useEffect(() => {
    if (reportId || cleanupPending || !session?.id || !["scanning", "importing"].includes(session.status) && !(session.status === "ready" && busy === "importing")) return;
    let stopped = false, timer;
    const poll = async () => {
      try {
        const next = await call(pathFor(session.id));
        if (stopped || cancelRequested.current) return;
        setError("");
        receive(next);
        if (next.status === "completed") await completed(next);
        else if (next.status === "failed") setError(next.error || "导入失败，请查看报告后重试");
        if (["scanning", "importing"].includes(next.status) || next.status === "ready" && busy === "importing") timer = setTimeout(poll, 500);
      } catch (failure) {
        if (stopped || cancelRequested.current) return;
        setError(`无法读取导入进度：${failure.message}。正在重试；可取消导入。`);
        timer = setTimeout(poll, 1200);
      }
    };
    timer = setTimeout(poll, 300);
    return () => { stopped = true; clearTimeout(timer); };
  }, [session?.id, session?.status, reportId, cleanupPending, busy]);

  function downloadReport() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "剪映草稿导入报告.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function keyDown(event) {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
    if (event.key !== "Tab") return;
    const items = [...dialog.current.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary")];
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }

  const running = !!busy || cleanupPending || ["scanning", "importing"].includes(session?.status);
  const warnings = (session?.issues || []).filter(issue => issue.severity === "warning");
  const errors = (session?.issues || []).filter(issue => issue.severity === "error");
  const missing = (session?.materials || []).filter(material => material.status === "needs-relink");
  const displayedMaterials = showMissingOnly && missing.length ? missing : session?.materials || [];
  const canImport = session?.canCommit && (!warnings.length || acknowledged);
  const summary = session?.summary || {};
  const profile = session?.profile || {};
  const progress = session?.progress;
  const progressNumber = Number.isFinite(progress?.completed) && Number.isFinite(progress?.total) && progress.total > 0 ? Math.min(100, Math.max(0, progress.completed / progress.total * 100)) : undefined;
  const progressLabel = progress && typeof progress === "object" && Number.isFinite(progress.completed) && Number.isFinite(progress.total)
    ? `${({ scan: "检查素材", copy: "复制素材", publish: "保存工程", completed: "已完成" })[progress.phase] || progress.phase || "处理"} ${progress.completed} / ${progress.total}` : null;
  return <div className="modal-scrim jianying-import-scrim">
    <section ref={dialog} className="modal jianying-import-modal" role="dialog" aria-modal="true" aria-label={reportId ? "剪映草稿导入报告" : "导入剪映草稿"} aria-busy={running} onKeyDown={keyDown}>
      <header><strong>{reportId ? "剪映草稿导入报告" : "导入剪映草稿"}</strong><IconButton Icon={XIcon} label={reportId ? "关闭草稿导入报告" : "取消并关闭草稿导入"} disabled={busy === "cancelling"} onClick={cancel} /></header>
      <div className="jianying-import-body">
        <p className="jianying-import-intro">先检查草稿和编辑信息，再创建独立的微剪工程。原草稿与素材保持原状。</p>
        <p className="jianying-import-intro">当前支持已验证的明文 360000 结构；新版私有格式可能无法导入，以预检报告为准。</p>
        <div className="jianying-draft-source"><FolderOpenIcon size={22} /><span>{directory || "选择包含草稿内容文件的本地文件夹"}</span>{!reportId && <Button label={session ? "重新选择" : "选择草稿文件夹"} disabled={!desktop || running} onClick={choose} />}</div>
        {!desktop && !reportId && <p className="jianying-import-notice" role="status">请在微剪 Mac 桌面应用中导入剪映草稿。浏览器不能读取本地草稿文件夹。</p>}
        {running && <div className="jianying-import-progress" role="status" aria-live="polite"><SpinnerGapIcon size={18} className="spin" /><span>{busy === "report" ? "正在读取已保存的导入报告…" : busy === "cancelling" ? "正在取消并清理导入内容…" : cleanupPending ? "导入内容尚未清理完成，请重试取消。" : busy === "saving" ? "正在保存当前工程…" : busy === "choosing" || busy === "locating" ? "等待选择本地文件…" : busy === "scanning" || busy === "timeline" || busy === "relink" ? "正在只读检查草稿与素材…" : busy === "importing" ? "正在复制素材并创建工程…" : statusLabels[session?.status] || "正在导入…"}</span>{Number.isFinite(progressNumber) && <progress max="100" value={progressNumber} aria-label="草稿导入进度" />}{progressLabel && <small>{progressLabel}</small>}</div>}
        {error && <p className="jianying-import-error" role="alert"><WarningCircleIcon size={17} />{error}</p>}
        {notice && <p className="jianying-import-notice" role="status">{notice}</p>}
        {session && <>
          <div className={`jianying-import-heading ${session.status === "unsupported" || errors.length ? "has-errors" : ""}`}><strong>{statusLabels[session.status] || "草稿预检报告"}</strong><span>剪映 · {profile.applicationVersion ? `应用版本 ${profile.applicationVersion}` : "应用版本未确认"}{profile.version != null && ` · 草稿结构 ${profile.version}`}{profile.format && ` · ${valueText(profile.format)}`}</span></div>
          {!!session.timelines?.length && <label className="jianying-timeline-choice"><span>导入时间线</span><select aria-label="选择剪映时间线" value={session.selectedTimelineId || ""} disabled={!!reportId || running} onChange={event => update("timeline", { timelineId: event.target.value })}><option value="" disabled>请选择一条时间线</option>{session.timelines.map(timeline => <option value={timeline.id} key={timeline.id}>{timeline.name || timeline.id}</option>)}</select></label>}
          <dl className="jianying-import-counts"><div><dt>素材</dt><dd>{summary.materials ?? "—"}</dd></div><div><dt>片段</dt><dd>{summary.clips ?? "—"}</dd></div><div><dt>字幕</dt><dd>{summary.subtitles ?? "—"}</dd></div><div><dt>待定位</dt><dd>{missing.length}</dd></div></dl>
          {!!session.issues?.length && <section className="jianying-import-issues" aria-label="草稿兼容问题"><h3>兼容与损失说明（{errors.length} 项错误 · {warnings.length} 项需确认）</h3><ReportPage key={`issues-${session.id}`} items={session.issues} label="兼容问题">{(rows, offset) => <ul>{rows.map((issue, index) => <li className={issue.severity === "error" ? "error" : "warning"} key={`${issue.code}-${offset + index}`}><strong>{issue.severity === "error" ? "无法导入" : "需确认"}</strong><span>{issue.message}{issue.code && <small>{issue.code}</small>}</span></li>)}</ul>}</ReportPage></section>}
          {!!session.materials?.length && <details className="jianying-import-details" open={missing.length > 0}><summary>素材读取与重新定位（{session.materials.length}）</summary><p>仅读取所选草稿范围；外部或缺失素材须逐项选择，名称相同不能证明是同一文件。</p>{missing.length > 0 && <div className="jianying-material-filter"><span>{showMissingOnly ? `当前仅显示 ${missing.length} 项待定位素材` : `当前显示全部 ${session.materials.length} 项素材`}</span><Button label={showMissingOnly ? "显示全部素材" : "只看待定位"} onClick={() => setShowMissingOnly(value => !value)} /></div>}<ReportPage key={`materials-${session.id}-${showMissingOnly}`} items={displayedMaterials} label="素材">{rows => <div className="jianying-material-list">{rows.map(material => <div className="jianying-material" key={material.sourceId}><span><strong>{material.name || material.sourceId}</strong><small>{material.sourcePath || "未记录本地路径"}</small>{material.selectedPath && <small>已选择：{material.selectedPath}</small>}{material.reason && <small>{material.reason}</small>}{material.sha256 && <small>SHA-256：{material.sha256}</small>}</span><span className={`jianying-material-status ${material.status}`}>{material.status === "ready" ? "可读取" : material.status === "needs-relink" ? "待定位" : "不支持"}</span>{!reportId && material.status === "needs-relink" && <Button label={`定位 ${material.name || material.sourceId}`} disabled={running || typeof bridge?.chooseJianyingMedia !== "function"} onClick={() => relink(material.sourceId)} />}</div>)}</div>}</ReportPage></details>}
          {!!session.mappings?.length && <details className="jianying-import-details"><summary>字段映射与精度记录（{session.mappings.length}）</summary><ReportPage key={`mappings-${session.id}`} items={session.mappings} label="字段映射">{(rows, offset) => <div className="jianying-mapping-scroll"><table><thead><tr><th>来源字段 / 值</th><th>转换规则</th><th>微剪字段 / 值</th><th>精度与损失</th></tr></thead><tbody>{rows.map((mapping, index) => <tr key={offset + index}><td><code>{mapping.sourcePath || "来源元数据"}</code>{valueText(mapping.sourceValue)}</td><td>{valueText(mapping.rule)}</td><td><code>{mapping.targetPath || "仅记录来源"}</code>{valueText(mapping.targetValue)}</td><td>{valueText(mapping.loss)}</td></tr>)}</tbody></table></div>}</ReportPage></details>}
          {!reportId && warnings.length > 0 && session.status !== "unsupported" && <label className="jianying-import-ack"><input type="checkbox" aria-label="确认兼容与损失说明" checked={acknowledged} disabled={running || !session.canCommit} onChange={event => setAcknowledged(event.target.checked)} /><span>我已阅读上述兼容与损失说明，接受按报告导入可支持的内容。</span></label>}
          {session.status === "unsupported" && <p className="jianying-import-notice">此草稿未通过结构识别。可以保存报告或重新选择；微剪不会尝试解密、读取密钥或修改原草稿。</p>}
          {session.status === "completed" && <p className="jianying-import-notice">独立工程已保存。原草稿保持原状，导入记录随工程保留。</p>}
        </>}
      </div>
      <div className="modal-footer"><span className="jianying-import-footer-note">本地处理 · 独立工程</span>{session && <Button Icon={DownloadSimpleIcon} label={reportId ? "保存导入报告" : "保存预检报告"} onClick={downloadReport} disabled={busy === "cancelling"} />}<Button label={reportId || session?.status === "completed" ? "关闭" : busy === "cancelling" ? "正在取消…" : "取消"} disabled={busy === "cancelling"} onClick={cancel} />{!reportId && session && session.status !== "unsupported" && session.status !== "completed" && <Button className="primary" label="导入为新工程" disabled={!canImport || running} onClick={commit} />}</div>
    </section>
  </div>;
}
