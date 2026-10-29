import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  projectDuration,
  splitClip,
  timelineLabel,
} from "../shared/model.mjs";

test("splitting a sped clip preserves the source interval and total timeline duration", () => {
  const clip = {
    id: "before",
    mediaId: "media",
    track: "video",
    start: 3,
    sourceStart: 2,
    duration: 4,
    speed: 1.5,
    volume: 0.4,
  };
  const [first, second] = splitClip(clip, 4.25);
  assert.equal(first.duration + second.duration, clip.duration);
  assert.equal(second.sourceStart, 3.875);
  assert.equal(second.start, 4.25);
  assert.equal(first.id, clip.id);
  assert.notEqual(second.id, clip.id);
  assert.equal(
    second.sourceStart + second.duration * second.speed,
    clip.sourceStart + clip.duration * clip.speed,
  );
  assert.equal(second.volume, clip.volume);
  assert.equal(splitClip(clip, 3), null);
  assert.equal(splitClip(clip, 7), null);
  assert.equal(clip.duration, 4);
});

test("project duration includes gaps, music, and a subtitle that extends past picture", () => {
  const project = newProject();
  assert.equal(projectDuration(project), 0);
  project.clips.push({ start: 4, duration: 3 }, { start: 0, duration: 9 });
  project.subtitles.push({ start: 8, duration: 3 });
  assert.equal(projectDuration(project), 11);
});

test("splitting a still image preserves zero source offset on both retained clips", () => {
  const clip = {
    id: "still",
    mediaId: "image",
    track: "video",
    start: 2,
    sourceStart: 0,
    duration: 5,
    speed: 1,
    volume: 1,
  };
  const parts = splitClip(clip, 4, { type: "image" });
  assert.deepEqual(
    parts.map((part) => part.sourceStart),
    [0, 0],
  );
  assert.equal(parts[0].duration + parts[1].duration, 5);
  assert.equal(parts[1].start, 4);
});

test("timecode rounds frames and carries through seconds, minutes, and hours", () => {
  assert.equal(timelineLabel(0), "00:00:00:00");
  assert.equal(timelineLabel(-1), "00:00:00:00");
  assert.equal(timelineLabel(59 + 29.7 / 30), "00:01:00:00");
  assert.equal(timelineLabel(3600 + 1 / 30), "01:00:00:01");
});
