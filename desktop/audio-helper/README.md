# Local pitch-preserving audio helper

Pinned dependency: Rubber Band **4.0.0**, official source archive in `vendor/`, with its exact byte count and SHA-256 in `rubberband.lock.json`. The archive is build input, not downloaded at runtime. `LICENSE.rubberband` contains the full GPL-2.0-or-later text; `main.cpp` is supplied under the same terms. The [official project license and integration notes](https://github.com/breakfastquay/rubberband) govern use/distribution; this does not change the app's existing local-use scope.

Build on macOS arm64 with the existing Xcode command-line tools:

```sh
node scripts/build-audio-helper.mjs
```

The build verifies the archive before extracting to `.cache/audio-helper/`, and compiles the official `single/RubberBandSingle.cpp` plus this PCM adapter. There is no Homebrew, Meson, libsndfile or external shared-library dependency. The binary links only Apple's Accelerate framework, libc++ and libSystem. Minimum macOS is 13.0. Output is `desktop/audio-helper/bin/darwin-arm64/weijian-audio-helper`; build metadata is `build-receipt.json`.

The final engine is **R3 short offline**, `ChannelsTogether`, pitch scale 1.0. The whole selected interval is studied and processed through one state. Process input calls are at most 256 frames, below the 960-source-frame map spacing, preventing key-map scheduling backlog. The source is read twice in bounded blocks; audio PCM is never loaded whole.

```text
weijian-audio-helper stretch
  --input <owned stereo float32-LE PCM file>
  --output <new owned float32-LE PCM file>
  --map <source-frame TAB output-frame text file>
  --source-frames <N> --output-frames <M>
  --channels 2 --sample-rate 48000
```

All flags are required. Map rows are strictly increasing interior source/output frame identities, excluding zero and the final endpoint; the overall ratio and exact final count are supplied separately. The adapter rejects invalid dimensions, file sizes, ordering and project-domain overflows before allocating its output. Map capacity follows the existing 3600s source/900s output domain, at most 180000 rows. It creates output exclusively and never overwrites input. `--version` prints the pinned version and selected engine.

Stdout is newline-delimited JSON with `phase: study|process|complete`, monotonic `progress: 0..1`, and `outputFrames`; final output also has `retrievedFrames` and `keyFrames`. Errors go to stderr and return nonzero. The parent supervises the actual child, cancellation, timeout and cleanup of its owned work directory. A failed child may leave its partial owned output for that cleanup owner.

`server/curve-audio.mjs` wraps PCM in WAV, checks exact output sample counts and bounded disk capacity, and supplies map batches from the shared curve owner. Its `audioHelperPath` option defaults only to the source-tree binary. Desktop configuration supplies the fixed `Resources/audio-helper/weijian-audio-helper` path; no environment search or system installation is used. Export and generated pitch-preserving audition share the same queue and processor; this helper itself applies no volume, mute or fades.
