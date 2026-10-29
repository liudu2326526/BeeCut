import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservedAudioClock } from '../src/audio-host/observed-clock.mjs';

test('paused observations never accrue paused wall time on a subsequent play request', () => {
  let now = 0; const clock = createObservedAudioClock(() => now);
  clock.reset(0); clock.observe({ phase: 'ready', frame: 0 });
  now = 700; assert.equal(clock.current(), 0);
  clock.observe({ phase: 'ready', frame: 0 });
  now = 900; assert.equal(clock.current(), 0, 'request acknowledgement is not evidence of rendered samples');
  clock.observe({ phase: 'playing', frame: 4096 }); now += 10;
  assert.equal(clock.current(), 4576);
  clock.observe({ phase: 'paused', frame: 4608 }); now += 700;
  assert.equal(clock.current(), 4608);
  clock.observe({ phase: 'ready', frame: 4608 }); now += 50;
  assert.equal(clock.current(), 4608);
});

test('actual processing advances the clock, hot ACK preserves it, buffering and halt stop it', () => {
  let now = 100; const clock = createObservedAudioClock(() => now);
  clock.observe({ phase: 'playing', frame: 10000 }); now += 25;
  assert.equal(clock.current(), 11200);
  clock.observe({ phase: 'ack', frame: 11264 }); now += 10;
  assert.equal(clock.current(), 11744);
  clock.observe({ phase: 'buffering', frame: 11776 }); now += 1000;
  assert.equal(clock.current(), 11776);
  clock.observe({ phase: 'playing', frame: 11904 }); now += 5;
  clock.stop(); now += 700; assert.equal(clock.current(), 12144);
  clock.reset(153137); now += 700; assert.equal(clock.current(), 153137);
});


test('processor advancing fact owns ACK/ready clocks without turning pause into elapsed audio', () => {
  let now = 0; const clock = createObservedAudioClock(() => now);
  clock.observe({ phase: 'playing', frame: 4096, advancing: true }); now = 20;
  clock.observe({ phase: 'ack', frame: 5120, advancing: true }); now = 30;
  assert.equal(clock.current(), 5600);
  clock.observe({ phase: 'ready', frame: 5632, advancing: true }); now = 40;
  assert.equal(clock.current(), 6112);
  clock.observe({ phase: 'buffering', frame: 6144, advancing: false }); now = 500;
  assert.equal(clock.current(), 6144);
  clock.observe({ phase: 'ack', frame: 6144, advancing: false }); now = 900;
  assert.equal(clock.current(), 6144);
});
