(() => {
  'use strict';

  const MIN_BPM = 20;
  const MAX_BPM = 320;

  const state = {
    bpm: 120,
    meter: { numerator: 4, denominator: 4, label: '4/4' },
    subdivision: 'quarter',
    volume: 1.2,
    accentFirst: true,
    accentLevels: [2, 1, 1, 1],
    isRunning: false,
    isPractice: false,
    nextNoteTime: 0,
    currentStep: 0,
    currentBar: 0,
    scheduleTimer: null,
    lookAheadMs: 25,
    scheduleAheadSec: 0.13,
    audio: null,
    masterGain: null,
    limiter: null,
    tapTimes: [],
    wheelDrag: null,
    practice: { playBars: 4, muteBars: 4, reentryBars: 1 }
  };

  const els = {
    bpmWheel: document.querySelector('#bpmWheel'),
    bpmDisplay: document.querySelector('#bpmDisplay'),
    bpmInput: document.querySelector('#bpmInput'),
    beatPulse: document.querySelector('#beatPulse'),
    startStop: document.querySelector('#startStop'),
    tapButton: document.querySelector('#tapButton'),
    meterButtons: document.querySelector('#meterButtons'),
    subdivisionButtons: document.querySelector('#subdivisionButtons'),
    accentFirst: document.querySelector('#accentFirst'),
    accentControls: document.querySelector('#accentControls'),
    accentMeterLabel: document.querySelector('#accentMeterLabel'),
    volume: document.querySelector('#volume'),
    tabs: document.querySelectorAll('.tab'),
    metroPage: document.querySelector('#metroPage'),
    practicePage: document.querySelector('#practicePage'),
    playBars: document.querySelector('#playBars'),
    muteBars: document.querySelector('#muteBars'),
    reentryBars: document.querySelector('#reentryBars'),
    practiceStartStop: document.querySelector('#practiceStartStop'),
    practiceStatus: document.querySelector('#practiceStatus'),
    cycleBar: document.querySelector('#cycleBar')
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function subdivisionFactor() {
    return ({ quarter: 1, eighth: 2, sixteenth: 4, triplet: 3 })[state.subdivision] ?? 1;
  }

  function secondsPerStep() {
    // BPM ist als Viertelnoten-Puls definiert. Subdivision teilt diesen Puls fein auf.
    return 60 / state.bpm / subdivisionFactor();
  }

  function stepsPerBar() {
    // Takte wie 6/8 werden korrekt als sechs Achtel gezählt; relativ zur Viertel-BPM
    // entsteht dadurch ein Bar-Raster von numerator * 4 / denominator Viertelnoten.
    return Math.round(state.meter.numerator * (4 / state.meter.denominator) * subdivisionFactor());
  }

  function baseBeatForStep(step) {
    const factor = subdivisionFactor();
    return Math.floor(step / factor) % state.meter.numerator;
  }

  async function ensureAudio() {
    if (!state.audio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      state.audio = new AudioContext({ latencyHint: 'interactive' });
      state.masterGain = state.audio.createGain();
      state.limiter = state.audio.createDynamicsCompressor();
      state.limiter.threshold.setValueAtTime(-2, state.audio.currentTime);
      state.limiter.knee.setValueAtTime(0, state.audio.currentTime);
      state.limiter.ratio.setValueAtTime(18, state.audio.currentTime);
      state.limiter.attack.setValueAtTime(0.001, state.audio.currentTime);
      state.limiter.release.setValueAtTime(0.045, state.audio.currentTime);
      state.masterGain.gain.value = state.volume;
      state.masterGain.connect(state.limiter).connect(state.audio.destination);
    }
    if (state.audio.state !== 'running') await state.audio.resume();
  }

  function scheduleClick(time, level, audible) {
    if (!audible || level === 0 || !state.audio) return;

    // Jeder Klick wird als eigener kurzer Oszillator präzise auf der AudioContext-Zeitachse geplant.
    // Das UI/JS darf kurz jitter haben; der bereits geplante Audiograph bleibt sample-genau.
    const osc = state.audio.createOscillator();
    const gain = state.audio.createGain();
    const isStrong = level === 2;
    const duration = isStrong ? 0.048 : 0.034;
    const peak = isStrong ? 1.0 : 0.72;

    osc.type = 'square';
    osc.frequency.setValueAtTime(isStrong ? 1750 : 1180, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(gain).connect(state.masterGain);
    osc.start(time);
    osc.stop(time + duration + 0.01);
  }

  function practicePhaseForBar(barIndex) {
    const { playBars, muteBars, reentryBars } = state.practice;
    const cycle = Math.max(1, playBars + muteBars + reentryBars);
    const pos = barIndex % cycle;
    if (pos < playBars) return { phase: 'Playing', audible: true, position: pos + 1, cycle };
    if (pos < playBars + muteBars) return { phase: 'Muted', audible: false, position: pos + 1, cycle };
    return { phase: 'Re-entry', audible: true, position: pos + 1, cycle };
  }

  function scheduler() {
    if (!state.audio) return;
    while (state.nextNoteTime < state.audio.currentTime + state.scheduleAheadSec) {
      const barSteps = stepsPerBar();
      const isBarStart = state.currentStep % barSteps === 0;
      if (isBarStart && state.currentStep !== 0) state.currentBar += 1;

      const stepInBeat = state.currentStep % subdivisionFactor();
      const beat = baseBeatForStep(state.currentStep);
      const isPrimaryBeat = stepInBeat === 0;
      let level = isPrimaryBeat ? state.accentLevels[beat] ?? 1 : 1;
      if (isPrimaryBeat && beat === 0 && state.accentFirst) level = Math.max(level, 2);

      const phase = state.isPractice ? practicePhaseForBar(state.currentBar) : { phase: state.isRunning ? 'Playing' : 'Stopped', audible: true, position: state.currentBar + 1, cycle: null };
      scheduleClick(state.nextNoteTime, level, phase.audible);
      scheduleVisual(state.nextNoteTime, beat, phase);

      state.nextNoteTime += secondsPerStep();
      state.currentStep += 1;
    }
  }

  function scheduleVisual(audioTime, beat, phase) {
    const delay = Math.max(0, (audioTime - state.audio.currentTime) * 1000);
    window.setTimeout(() => {
      els.beatPulse.classList.remove('pulse');
      void els.beatPulse.offsetWidth;
      els.beatPulse.classList.add('pulse');
      if (state.isPractice) {
        els.practiceStatus.textContent = phase.phase;
        els.cycleBar.textContent = `${phase.position} / ${phase.cycle}`;
      }
    }, delay);
  }

  async function start({ practice = false } = {}) {
    await ensureAudio();
    state.isRunning = true;
    state.isPractice = practice;
    state.currentStep = 0;
    state.currentBar = 0;
    state.nextNoteTime = state.audio.currentTime + 0.055;
    clearInterval(state.scheduleTimer);
    // Kleiner JS-Timer schaut nur voraus und legt Events in Web Audio ab; er erzeugt nicht den Klick selbst.
    state.scheduleTimer = setInterval(scheduler, state.lookAheadMs);
    updateTransportUI();
  }

  function stop() {
    state.isRunning = false;
    state.isPractice = false;
    clearInterval(state.scheduleTimer);
    state.scheduleTimer = null;
    els.practiceStatus.textContent = 'Stopped';
    els.cycleBar.textContent = '—';
    updateTransportUI();
  }

  function setBpm(value) {
    const bpm = Math.round(clamp(Number(value) || state.bpm, MIN_BPM, MAX_BPM));
    state.bpm = bpm;
    els.bpmDisplay.textContent = bpm;
    els.bpmInput.value = bpm;
    const progress = ((bpm - MIN_BPM) / (MAX_BPM - MIN_BPM)) * 100;
    els.bpmWheel.style.setProperty('--progress', `${progress}%`);
    // Kein Reset von currentStep/nextNoteTime: BPM-Änderungen wirken ab dem nächsten geplanten Step,
    // ohne den aktuellen Takt künstlich neu zu starten.
  }

  function setMeter(label) {
    const [numerator, denominator] = label.split('/').map(Number);
    state.meter = { numerator, denominator, label };
    const existing = state.accentLevels.slice();
    state.accentLevels = Array.from({ length: numerator }, (_, i) => existing[i] ?? (i === 0 ? 2 : 1));
    renderAccentControls();
    updateActiveButtons(els.meterButtons, '[data-meter]', label, 'meter');
  }

  function renderAccentControls() {
    els.accentMeterLabel.textContent = `${state.meter.numerator} Beats`;
    els.accentControls.innerHTML = '';
    state.accentLevels.forEach((level, i) => {
      const btn = document.createElement('button');
      btn.className = 'accent-btn';
      btn.type = 'button';
      btn.dataset.level = String(level);
      btn.setAttribute('aria-label', `Beat ${i + 1} accent: ${['off', 'normal', 'strong'][level]}`);
      btn.title = `Beat ${i + 1}: ${['off', 'normal', 'strong'][level]}`;
      btn.innerHTML = '<span class="accent-block top"></span><span class="accent-block bottom"></span>';
      btn.addEventListener('click', () => {
        state.accentLevels[i] = (state.accentLevels[i] + 1) % 3;
        renderAccentControls();
      });
      els.accentControls.append(btn);
    });
  }

  function updateActiveButtons(container, selector, value, dataKey) {
    container.querySelectorAll(selector).forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset[dataKey] === value);
    });
  }

  function updateTransportUI() {
    els.startStop.textContent = state.isRunning && !state.isPractice ? '■' : '▶';
    els.startStop.classList.toggle('is-running', state.isRunning && !state.isPractice);
    els.practiceStartStop.textContent = state.isRunning && state.isPractice ? 'Stop Practice' : 'Start Practice';
    els.practiceStartStop.classList.toggle('is-running', state.isRunning && state.isPractice);
  }

  function readPracticeInputs() {
    state.practice.playBars = clamp(parseInt(els.playBars.value, 10) || 1, 1, 64);
    state.practice.muteBars = clamp(parseInt(els.muteBars.value, 10) || 0, 0, 64);
    state.practice.reentryBars = clamp(parseInt(els.reentryBars.value, 10) || 0, 0, 64);
    els.playBars.value = state.practice.playBars;
    els.muteBars.value = state.practice.muteBars;
    els.reentryBars.value = state.practice.reentryBars;
  }

  function setupWheel() {
    const pointerToAngle = event => {
      const rect = els.bpmWheel.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return Math.atan2(event.clientY - cy, event.clientX - cx);
    };
    els.bpmWheel.addEventListener('pointerdown', event => {
      els.bpmWheel.setPointerCapture(event.pointerId);
      state.wheelDrag = { angle: pointerToAngle(event), bpm: state.bpm };
    });
    els.bpmWheel.addEventListener('pointermove', event => {
      if (!state.wheelDrag) return;
      let delta = pointerToAngle(event) - state.wheelDrag.angle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      setBpm(state.wheelDrag.bpm + Math.round(delta * 42));
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => {
      els.bpmWheel.addEventListener(name, () => { state.wheelDrag = null; });
    });
  }

  function setupEvents() {
    els.startStop.addEventListener('click', () => state.isRunning && !state.isPractice ? stop() : start({ practice: false }));
    els.practiceStartStop.addEventListener('click', () => {
      if (state.isRunning && state.isPractice) return stop();
      readPracticeInputs();
      start({ practice: true });
    });
    els.bpmInput.addEventListener('input', e => setBpm(e.target.value));
    els.volume.addEventListener('input', e => {
      state.volume = Number(e.target.value);
      const volumeValue = document.querySelector('#volumeValue');
      if (volumeValue) volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
      if (state.masterGain) state.masterGain.gain.setTargetAtTime(state.volume, state.audio.currentTime, 0.01);
    });
    els.accentFirst.addEventListener('change', e => { state.accentFirst = e.target.checked; });
    els.meterButtons.addEventListener('click', e => { if (e.target.dataset.meter) setMeter(e.target.dataset.meter); });
    els.subdivisionButtons.addEventListener('click', e => {
      if (!e.target.dataset.subdivision) return;
      state.subdivision = e.target.dataset.subdivision;
      updateActiveButtons(els.subdivisionButtons, '[data-subdivision]', state.subdivision, 'subdivision');
    });
    els.tapButton.addEventListener('click', () => {
      const now = performance.now();
      state.tapTimes = state.tapTimes.filter(t => now - t < 2200).concat(now).slice(-6);
      if (state.tapTimes.length >= 2) {
        const intervals = state.tapTimes.slice(1).map((t, i) => t - state.tapTimes[i]);
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        setBpm(60000 / avg);
      }
    });
    els.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        els.tabs.forEach(t => t.classList.toggle('is-active', t === tab));
        els.metroPage.classList.toggle('is-active', tab.dataset.tab === 'metro');
        els.practicePage.classList.toggle('is-active', tab.dataset.tab === 'practice');
      });
    });
    [els.playBars, els.muteBars, els.reentryBars].forEach(input => input.addEventListener('change', readPracticeInputs));
    document.addEventListener('visibilitychange', () => {
      // Moderne Browser können Hintergrund-Timer drosseln. Beim Zurückkehren wird die Vorausplanung
      // sofort neu angestoßen; bereits geplante Audioevents bleiben unbeeinflusst.
      if (!document.hidden && state.isRunning) scheduler();
    });
  }

  setBpm(120);
  setMeter('4/4');
  renderAccentControls();
  setupWheel();
  setupEvents();
})();
