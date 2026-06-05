const bpmInput = document.getElementById('bpmInput');
const bpmValue = document.getElementById('bpmValue');
const tapBpmButton = document.getElementById('tapBpmButton');
const startStopButton = document.getElementById('startStopButton');
const timeSignatureSelect = document.getElementById('timeSignature');
const subdivisionSelect = document.getElementById('subdivision');
const volumeControl = document.getElementById('volumeControl');
const accentBlocks = document.getElementById('accentBlocks');
const strongFirstBeat = document.getElementById('strongFirstBeat');
const beatStatus = document.getElementById('beatStatus');
const barStatus = document.getElementById('barStatus');
const practiceTabButton = document.querySelector('[data-tab="practice"]');
const metronomeTabButton = document.querySelector('[data-tab="metronome"]');
const metronomeSection = document.getElementById('metronome');
const practiceSection = document.getElementById('practice');
const practiceStartStop = document.getElementById('practiceStartStop');
const practiceX = document.getElementById('practiceX');
const practiceY = document.getElementById('practiceY');
const practiceZ = document.getElementById('practiceZ');
const practiceStatus = document.getElementById('practiceStatus');
const practiceCycle = document.getElementById('practiceCycle');
const meterRing = document.getElementById('meterRing');

const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let isRunning = false;
let practiceActive = false;
let nextNoteTime = 0.0;
let current16thNote = 0;
let currentBar = 0;
let scheduleTimer = null;
let tapTimes = [];
let accentedBeats = [];
let cyclePhase = 'ready';
let cycleBarIndex = 0;
let cycleStep = 0;
const lookahead = 25.0;
const scheduleAheadTime = 0.1;

const state = {
  bpm: 120,
  beatsPerBar: 4,
  subdivision: 'eighth',
  volume: 0.85,
  accentedBeats: [true, false, false, false],
  strongFirst: true,
  practice: {
    x: 4,
    y: 4,
    z: 1,
  }
};

function updateStateFromUI() {
  state.bpm = clamp(Number(bpmInput.value) || 120, 30, 250);
  state.beatsPerBar = Number(timeSignatureSelect.value) || 4;
  state.subdivision = subdivisionSelect.value;
  state.volume = Number(volumeControl.value) / 100;
  state.strongFirst = strongFirstBeat.checked;
  state.practice.x = clamp(Number(practiceX.value) || 4, 1, 16);
  state.practice.y = clamp(Number(practiceY.value) || 4, 1, 16);
  state.practice.z = clamp(Number(practiceZ.value) || 1, 1, 8);
  accentBlocks.innerHTML = '';
  state.accentedBeats = [];
  for (let i = 0; i < state.beatsPerBar; i += 1) {
    const block = document.createElement('div');
    block.className = 'accent-block' + (i === 0 ? ' active' : '');
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => {
      state.accentedBeats[i] = !state.accentedBeats[i];
      block.classList.toggle('active', state.accentedBeats[i]);
    });
    block.appendChild(button);
    accentBlocks.appendChild(block);
    state.accentedBeats.push(i === 0);
  }
  bpmValue.textContent = state.bpm;
  bpmInput.value = state.bpm;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSubdivisionFactor() {
  switch (state.subdivision) {
    case 'quarter': return 1;
    case 'eighth': return 2;
    case 'triplet': return 3;
    case 'sixteenth': return 4;
    default: return 2;
  }
}

function getSecondsPerSubdivision() {
  const quarterNoteTime = 60.0 / state.bpm;
  switch (state.subdivision) {
    case 'quarter': return quarterNoteTime;
    case 'eighth': return quarterNoteTime / 2;
    case 'triplet': return quarterNoteTime / 3;
    case 'sixteenth': return quarterNoteTime / 4;
    default: return quarterNoteTime / 2;
  }
}

function playClick(time, isAccent, isStrongFirst) {
  const gain = audioContext.createGain();
  const oscillator = audioContext.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = isAccent ? 920 : 520;
  gain.gain.value = state.volume * (isAccent ? 1.0 : 0.42) * (isStrongFirst ? 1.2 : 1);
  gain.connect(audioContext.destination);
  oscillator.connect(gain);
  oscillator.start(time);
  oscillator.stop(time + 0.035);
}

function scheduleNote(beatNumber, time) {
  const subdivisionFactor = getSubdivisionFactor();
  const beatIndex = Math.floor(beatNumber / subdivisionFactor);
  const isBeat = beatNumber % subdivisionFactor === 0;
  const isAccent = isBeat && state.accentedBeats[beatIndex];
  const isStrongFirst = isAccent && state.strongFirst && beatIndex === 0;
  const shouldMute = practiceActive && cyclePhase === 'muted';
  const effectiveVolume = shouldMute ? 0 : state.volume;

  const gain = audioContext.createGain();
  const oscillator = audioContext.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = isBeat ? 920 : 560;
  gain.gain.value = shouldMute ? 0 : effectiveVolume * (isAccent ? 1.0 : 0.42) * (isStrongFirst ? 1.2 : 1);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(time);
  oscillator.stop(time + 0.04);

  if (isBeat) {
    if (!shouldMute) {
      meterRing.classList.add('pulse-active');
      window.setTimeout(() => meterRing.classList.remove('pulse-active'), 120);
    }
    const displayBeat = beatIndex + 1;
    beatStatus.textContent = `Beat ${displayBeat} / ${state.beatsPerBar}`;
    barStatus.textContent = `Bar ${currentBar + 1}`;
    updatePracticeDisplay();
  }
}

function nextNote() {
  const subdivisionFactor = getSubdivisionFactor();
  const notesPerBar = state.beatsPerBar * subdivisionFactor;
  const secondsPerSubdivision = getSecondsPerSubdivision();

  nextNoteTime += secondsPerSubdivision;
  current16thNote += 1;

  if (current16thNote >= notesPerBar) {
    current16thNote = 0;
    currentBar += 1;
    if (practiceActive) {
      cycleBarIndex += 1;
      if (cyclePhase === 'playing' && cycleBarIndex >= state.practice.x) {
        cyclePhase = 'muted';
        cycleBarIndex = 0;
      } else if (cyclePhase === 'muted' && cycleBarIndex >= state.practice.y) {
        cyclePhase = 're-entry';
        cycleBarIndex = 0;
      } else if (cyclePhase === 're-entry' && cycleBarIndex >= state.practice.z) {
        cyclePhase = 'playing';
        cycleBarIndex = 0;
      }
    }
  }
}

function scheduler() {
  while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
    const noteNumber = current16thNote;
    scheduleNote(noteNumber, nextNoteTime);
    nextNote();
  }
}

function startMetronome() {
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  if (isRunning) return;
  updateStateFromUI();
  isRunning = true;
  current16thNote = 0;
  currentBar = 0;
  nextNoteTime = audioContext.currentTime + 0.05;
  cycleBarIndex = 0;
  cyclePhase = practiceActive ? 'playing' : 'playing';
  scheduleTimer = setInterval(scheduler, lookahead);
  startStopButton.textContent = 'Stop';
  practiceStartStop.textContent = practiceActive ? 'Stop Practice' : 'Start Practice';
  beatStatus.textContent = 'Running';
  updatePracticeDisplay();
}

function stopMetronome() {
  if (!isRunning) return;
  clearInterval(scheduleTimer);
  scheduleTimer = null;
  isRunning = false;
  startStopButton.textContent = 'Start';
  beatStatus.textContent = 'Ready';
  barStatus.textContent = '';
}

function toggleMetronome() {
  if (isRunning) {
    stopMetronome();
  } else {
    startMetronome();
  }
}

function updatePracticeDisplay() {
  if (!practiceActive) {
    practiceStatus.textContent = 'Ready';
    practiceCycle.textContent = '0 / 0';
    return;
  }
  practiceStatus.textContent = cyclePhase === 'playing' ? 'Playing' : cyclePhase === 'muted' ? 'Muted' : 'Re-entry';
  practiceCycle.textContent = `${cycleBarIndex + 1} / ${cyclePhase === 'playing' ? state.practice.x : cyclePhase === 'muted' ? state.practice.y : state.practice.z}`;
}

function togglePractice() {
  practiceActive = !practiceActive;
  practiceStartStop.textContent = practiceActive ? 'Stop Practice' : 'Start Practice';
  if (practiceActive) {
    if (!isRunning) {
      startMetronome();
    }
    cyclePhase = 'playing';
    cycleBarIndex = 0;
  } else {
    cyclePhase = 'ready';
    practiceStatus.textContent = 'Ready';
    practiceCycle.textContent = '0 / 0';
  }
}

function handleTapBPM() {
  const now = performance.now();
  tapTimes.push(now);
  if (tapTimes.length > 6) tapTimes.shift();
  if (tapTimes.length >= 2) {
    const intervals = [];
    for (let i = 1; i < tapTimes.length; i += 1) {
      intervals.push(tapTimes[i] - tapTimes[i - 1]);
    }
    const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    const newBpm = Math.round(60000 / average);
    state.bpm = clamp(newBpm, 30, 250);
    bpmInput.value = state.bpm;
    bpmValue.textContent = state.bpm;
  }
}

function switchTab(tabName) {
  metronomeSection.hidden = tabName !== 'metronome';
  practiceSection.hidden = tabName !== 'practice';
  metronomeSection.classList.toggle('active', tabName === 'metronome');
  practiceSection.classList.toggle('active', tabName === 'practice');
  metronomeTabButton.classList.toggle('active', tabName === 'metronome');
  practiceTabButton.classList.toggle('active', tabName === 'practice');
  metronomeTabButton.setAttribute('aria-selected', tabName === 'metronome');
  practiceTabButton.setAttribute('aria-selected', tabName === 'practice');
}

bpmInput.addEventListener('change', () => {
  state.bpm = clamp(Number(bpmInput.value) || 120, 30, 250);
  bpmInput.value = state.bpm;
  bpmValue.textContent = state.bpm;
});

bpmInput.addEventListener('input', () => {
  const value = Number(bpmInput.value);
  if (!Number.isNaN(value)) {
    state.bpm = clamp(value, 30, 250);
    bpmValue.textContent = state.bpm;
  }
});

timeSignatureSelect.addEventListener('change', () => updateStateFromUI());
subdivisionSelect.addEventListener('change', () => updateStateFromUI());
volumeControl.addEventListener('input', () => { state.volume = Number(volumeControl.value) / 100; });
strongFirstBeat.addEventListener('change', () => { state.strongFirst = strongFirstBeat.checked; });

startStopButton.addEventListener('click', toggleMetronome);
tapBpmButton.addEventListener('click', handleTapBPM);
practiceStartStop.addEventListener('click', togglePractice);
practiceX.addEventListener('change', () => { state.practice.x = clamp(Number(practiceX.value) || 4, 1, 16); });
practiceY.addEventListener('change', () => { state.practice.y = clamp(Number(practiceY.value) || 4, 1, 16); });
practiceZ.addEventListener('change', () => { state.practice.z = clamp(Number(practiceZ.value) || 1, 1, 8); });

metronomeTabButton.addEventListener('click', () => switchTab('metronome'));
practiceTabButton.addEventListener('click', () => switchTab('practice'));

let pointerStartY = null;
let pointerStartBpm = null;

meterRing.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  meterRing.setPointerCapture(event.pointerId);
  pointerStartY = event.clientY;
  pointerStartBpm = state.bpm;
});

meterRing.addEventListener('pointermove', (event) => {
  if (pointerStartY === null) return;
  const delta = pointerStartY - event.clientY;
  const step = Math.round(delta / 10);
  const newBpm = clamp(pointerStartBpm + step, 30, 250);
  state.bpm = newBpm;
  bpmInput.value = newBpm;
  bpmValue.textContent = newBpm;
});

meterRing.addEventListener('pointerup', () => {
  pointerStartY = null;
  pointerStartBpm = null;
});

meterRing.addEventListener('pointercancel', () => {
  pointerStartY = null;
  pointerStartBpm = null;
});

window.addEventListener('DOMContentLoaded', () => {
  updateStateFromUI();
  switchTab('metronome');
});
