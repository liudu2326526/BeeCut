import { SpeakerHighIcon, SpeakerSlashIcon, ScissorsIcon, MusicNotesIcon } from "@phosphor-icons/react";
import { AUDIO_FADE_CURVES, MAX_AUDIO_GAIN, MAX_AUDIO_DB, MIN_AUDIO_DB, clipAudioSettings, gainToDb, dbToGain } from "../shared/audio.mjs";
import { AUDIO_LANE_COUNT, AUDIO_EFFECT_LIMITS, clipAudioEffects, clipAudioAudibility } from "../shared/model.mjs";
import { AudioGainKeyEditor } from "./AudioGainKeyEditor.jsx";
import { Button, NumberField } from "./EditorControls.jsx";

export function AudioInspector({ clip, media, project, time, playing, section = "basic", onSectionChange, keyActions, onEdit, onDetach, onPreview, previewBusy, previewExists }) {
  if (!media?.hasAudio) return <p className="inspector-hint">该素材没有音轨。</p>;
  const audio = clipAudioSettings(clip), effects = clipAudioEffects(clip);
  const audibility = clipAudioAudibility(clip, media, project);
  const reasonLabels = { "clip-muted": "片段已静音", "detached": "原声已分离", "lane-muted": "所在音轨已静音", "solo-excluded": "其他音轨正在独听" };
  const editEffect = (name, patch) => onEdit({ audioEffects: { ...effects, [name]: { ...effects[name], ...patch } } });
  return <>
    {clip.track === "video" && <>
      <div className="section-label">原声</div>
      <Button Icon={ScissorsIcon} label={audio.audioDetached ? "音频已分离" : "分离音频"} onClick={onDetach} disabled={audio.audioDetached} />
      <p className="inspector-hint">{audio.audioDetached ? "原声已分离，本画面不播放原声。独立音轨可单独编辑。" : "分离后保留相同素材区间和变速，画面与声音可独立编辑。"}</p>
    </>}
    {!audio.audioDetached && <>
      {clip.track === "audio" && <label className="field"><span>音频轨道</span><select aria-label="音频轨道" value={clip.layer ?? 0} onChange={event => onEdit({ layer: Number(event.target.value) })}>{Array.from({ length: AUDIO_LANE_COUNT }, (_, lane) => <option key={lane} value={lane}>音频 {lane + 1}</option>)}</select></label>}
      {reasonLabels[audibility.reason] && <p className="audio-routing-status" role="status">{reasonLabels[audibility.reason]}</p>}
      <div className="inspector-subtabs audio-inspector-tabs" aria-label="音频设置分类">
        {[["basic", "基础"], ["keys", "关键帧"], ["effects", "声像音效"]].map(([value, label]) => <button key={value} type="button" aria-pressed={section === value} className={section === value ? "active" : ""} onClick={() => onSectionChange(value)}>{label}</button>)}
      </div>
      {section === "basic" && <>
      <div className="section-label">基础音量</div>
      <Button Icon={audio.muted ? SpeakerSlashIcon : SpeakerHighIcon} label={audio.muted ? "取消片段静音" : "片段静音"} aria-pressed={audio.muted} onClick={() => onEdit({ muted: !audio.muted })} />
      <label className="volume-control">
        <SpeakerHighIcon size={17} />
        <input type="range" aria-label="片段音量" min="0" max={MAX_AUDIO_GAIN * 100} value={Math.round(audio.volume * 100)} onChange={event => onEdit({ volume: Number(event.target.value) / 100 })} />
        <span>{Math.round(audio.volume * 100)}%</span>
      </label>
      <NumberField label="音量 dB" value={gainToDb(audio.volume)} min={audio.volume > 0 ? Math.min(MIN_AUDIO_DB, gainToDb(audio.volume)) : MIN_AUDIO_DB} max={MAX_AUDIO_DB} step={.1} suffix="dB" precision={2} nonFiniteDisplay="−∞" onChange={value => onEdit({ volume: Math.min(MAX_AUDIO_GAIN, dbToGain(value)) })} />
      <p className="inspector-hint">0% 显示 −∞ dB；静音保留音量。实时音频与导出使用相同混音处理，支持超过 100% 的设置；最终混音会限幅。</p>
      <div className="section-label">淡入淡出</div>
      <NumberField label="淡入时长" value={audio.fadeIn} min={0} max={Math.max(0, clip.duration - audio.fadeOut)} step={.1} onChange={value => onEdit({ fadeIn: value })} />
      <label className="field"><span>淡入形状</span><select aria-label="淡入形状" value={audio.fadeInCurve} onChange={event => onEdit({ fadeInCurve: event.target.value })}>{AUDIO_FADE_CURVES.map(curve => <option key={curve.type} value={curve.type}>{curve.label}</option>)}</select></label>
      <NumberField label="淡出时长" value={audio.fadeOut} min={0} max={Math.max(0, clip.duration - audio.fadeIn)} step={.1} onChange={value => onEdit({ fadeOut: value })} />
      <label className="field"><span>淡出形状</span><select aria-label="淡出形状" value={audio.fadeOutCurve} onChange={event => onEdit({ fadeOutCurve: event.target.value })}>{AUDIO_FADE_CURVES.map(curve => <option key={curve.type} value={curve.type}>{curve.label}</option>)}</select></label>
      <p className="inspector-hint">淡化控制声音幅度，时长按时间线计算。源波形仅表示原素材峰值。</p>
      </>}
      {section === "keys" && <AudioGainKeyEditor clip={clip} time={time} playing={playing} fps={project.fps} {...keyActions} />}
      {section === "effects" && <>
        <div className="section-label">立体声平衡</div>
        <label className="volume-control"><span>左</span><input type="range" aria-label="立体声平衡" min={-100} max={100} value={(clip.pan ?? 0) * 100} onChange={event => onEdit({ pan: Number(event.target.value) / 100 })} /><span>右</span></label>
        <NumberField label="声像平衡" value={(clip.pan ?? 0) * 100} min={-100} max={100} step={1} suffix="%" onChange={value => onEdit({ pan: value / 100 })} />
        <Button label="声像居中" onClick={() => onEdit({ pan: 0 })} />
        <p className="inspector-hint">向一侧平衡会减小另一声道；0% 保留原声道。</p>
        <div className="section-label">音效</div>
        {[["highpass", "高通滤波"], ["lowpass", "低通滤波"], ["echo", "回声"]].map(([name, label]) => <div className="audio-effect" key={name}>
          <label className="audio-effect-toggle"><span>{label}</span><input type="checkbox" aria-label={`启用${label}`} checked={effects[name].enabled} onChange={event => editEffect(name, { enabled: event.target.checked })} /></label>
          {name !== "echo" ? <NumberField label={`${label}频率`} value={effects[name].frequency} min={AUDIO_EFFECT_LIMITS.frequency.min} max={AUDIO_EFFECT_LIMITS.frequency.max} step={10} suffix="Hz" disabled={!effects[name].enabled} onChange={value => editEffect(name, { frequency: value })} /> : <>
            <NumberField label="回声延迟" value={effects.echo.delay} min={AUDIO_EFFECT_LIMITS.delay.min} max={AUDIO_EFFECT_LIMITS.delay.max} step={.01} disabled={!effects.echo.enabled} onChange={value => editEffect("echo", { delay: value })} />
            <NumberField label="回声衰减" value={effects.echo.decay * 100} min={AUDIO_EFFECT_LIMITS.decay.min * 100} max={AUDIO_EFFECT_LIMITS.decay.max * 100} step={1} suffix="%" disabled={!effects.echo.enabled} onChange={value => editEffect("echo", { decay: value / 100 })} />
          </>}
        </div>)}
        <Button label="重置声像与音效" onClick={() => onEdit({ pan: 0, audioEffects: clipAudioEffects({}) })} />
        <p className="inspector-hint">声像、滤波与回声在实时音频、混音 WAV 和视频导出中生效。回声尾音裁在片段结束处。</p>
      </>}
    </>}
    <div className="section-label">工程混音预听</div>
    <Button Icon={MusicNotesIcon} label={previewBusy ? "查看保调预听进度" : previewExists ? "查看保调预听" : "生成保调预听"} onClick={onPreview} />
    <p className="inspector-hint">生成整个工程的 WAV，包含轨道 M/S、片段静音、音量关键帧、淡化、声像和音效。实时音频直接应用这些设置；此按钮另行生成整个工程的离线混音 WAV。</p>
  </>;
}
