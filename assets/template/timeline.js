// timeline.js — the single clock. Picture (cinereel-runtime.js) and sound (build_audio/mix_audio)
// both read this. Times: seconds (2.5) | beats ("b12") | bars ("bar3") | scene-relative ("dash+0.4").
// Prefer beats: when the real music comes back at a slightly different tempo, fix meta.bpm /
// meta.beatOffset once and every beat-addressed event re-times itself.
window.CINEREEL = {
  meta: {
    title: 'Northstar — launch',
    width: 1920, height: 1080, fps: 30,
    duration: 16,          // seconds
    bpm: 120,              // 1 beat = 0.5s
    beatOffset: 0,         // seconds before beat 0 (set from build_audio's analysis)
    accent: '#7c5cff',
    grain: 0.06,
  },

  scenes: [
    { id: 'intro', start: 0, end: 'b7', out: { type: 'blur', dur: 0.45 } },
    { id: 'dash', start: 'b6.5', end: 'b19', in: { type: 'zoom', dur: 0.6 }, sfx: 'whoosh',
      camera: [
        { at: 0,   scale: 1.42, focus: '#kpis' },
        { at: 1.4, scale: 1.42, focus: '#kpis' },
        { at: 2.3, scale: 1.0, ease: 'expoInOut' },
        { at: 4.1, scale: 1.0 },
        { at: 6.25, scale: 1.14, focus: '#toast', ease: 'smooth' },
      ] },
    { id: 'ask', start: 'b18.5', end: 'b27', in: { type: 'slideUp', dur: 0.55 }, sfx: 'whoosh',
      camera: [{ at: 0, scale: 1.08 }, { at: 4.2, scale: 1.0, ease: 'smooth' }] },
    { id: 'outro', start: 'b26.5', end: 16, in: { type: 'blur', dur: 0.5 } },
  ],

  tracks: [
    // intro
    { target: '#mark', anim: 'popIn', at: 'b1', dur: 0.7, sfx: 'pop' },
    { target: '#headline .cr-w', anim: 'blurIn', at: 'b2', dur: 0.7, stagger: 0.12, sfx: 'whoosh-soft' },

    // dashboard
    { target: '.kpi', anim: 'fadeUp', at: 'dash+0.15', dur: 0.6, stagger: 0.07, sfx: 'tick', sfxEach: true },
    { target: '#k-mrr', anim: 'countUp', at: 'dash+0.25', dur: 1.4, to: 48210, prefix: '$' },
    { target: '#k-acc', anim: 'countUp', at: '@0.05', dur: 1.4, to: 1284 },
    { target: '#k-nrr', anim: 'countUp', at: '@0.05', dur: 1.4, to: 118, suffix: '%' },
    { target: '#k-churn', anim: 'countUp', at: '@0.05', dur: 1.4, to: 2.1, decimals: 1, suffix: '%' },
    { target: '.bar', anim: 'barGrow', at: 'b11', dur: 0.9, stagger: 0.05, sfx: 'whoosh-soft' },
    { target: '#line', anim: 'draw', at: 'b11.5', dur: 1.4 },
    { target: '#toast', anim: 'popIn', at: 'b15.2', dur: 0.6, sfx: 'chime' },

    // ask
    { target: '#q', anim: 'type', at: 'ask+0.45', dur: 1.3, text: 'Why did churn spike in March?', sfx: 'type' },
    { target: '#answer', anim: 'fadeUp', at: 'b23', dur: 0.6, sfx: 'whoosh-soft' },
    { target: '#answer .row', anim: 'fadeUp', at: '@0.15', dur: 0.5, stagger: 0.15, distance: 14 },
    { target: '#insight', anim: 'fadeUp', at: 'b24.3', dur: 0.5 },
    { target: '#insight', anim: 'glow', at: 'b25', dur: 0.9, sfx: 'shimmer' },

    // end card
    { target: '#mark2', anim: 'popIn', at: 'b27', dur: 0.7, sfx: 'impact' },
    { target: '#name', anim: 'maskReveal', at: 'b27.5', dur: 0.8 },
    { target: '#url', anim: 'fadeUp', at: 'b28.5', dur: 0.6, sfx: 'tick' },
  ],

  cursor: {
    events: [
      { at: 'b13', to: '#export', dur: 0.8 },
      { at: 'b15', click: true, press: '#export', sfx: 'click' },
    ],
  },

  audio: {
    music: { prompt: 'Confident modern tech launch track, crisp drums, warm analog synth chords, optimistic, minimal', mood: 'bright', gain: -15 },
    tone: 'soft',                      // soft | neutral | bright — soft rolls off harsh highs
    cues: [{ at: 'b23.4', sfx: 'riser' }],
    sfx: {},                           // overrides: { click: { prompt, dur, gain, file } }
    vo: [],                            // [{ at: 'b2', text: '...' }] + audio.voice = '<voice_id>'
    mix: { music: 0, sfx: 0, vo: 0, duck: 8, lufs: -14 },
  },
};
