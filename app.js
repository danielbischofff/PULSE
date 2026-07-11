(() => {
  'use strict';

  const MIN_BPM = 20;
  const MAX_BPM = 320;

  const state = {
    bpm: 120,
    meter: { numerator: 4, denominator: 4, label: '4/4' },
    subdivision: 'quarter',
    volume: 0.5625,
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
    wakeLock: null,
    setlists: [],
    activeSetlistId: null,
    editingSongId: null,
    activeSongId: null,
    draggedSongId: null,
    pointerDrag: null,
    practice: { playBars: 4, muteBars: 4, reentryBars: 1 }
  };

  const els = {
    topbar: document.querySelector('.topbar'),
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
    setlistPage: document.querySelector('#setlistPage'),
    practicePage: document.querySelector('#practicePage'),
    setlistForm: document.querySelector('#setlistForm'),
    setlistName: document.querySelector('#setlistName'),
    setlistCsvInput: document.querySelector('#setlistCsvInput'),
    addSetlistButton: document.querySelector('#addSetlistButton'),
    cancelSetlistButton: document.querySelector('#cancelSetlistButton'),
    songName: document.querySelector('#songName'),
    songBpm: document.querySelector('#songBpm'),
    songMeter: document.querySelector('#songMeter'),
    songSubdivision: document.querySelector('#songSubdivision'),
    songForm: document.querySelector('#songForm'),
    addSongButton: document.querySelector('#addSongButton'),
    cancelSongButton: document.querySelector('#cancelSongButton'),
    saveSongButton: document.querySelector('#saveSongButton'),
    setlistItems: document.querySelector('#setlistItems'),
    songItems: document.querySelector('#songItems'),
    setlistDetail: document.querySelector('#setlistDetail'),
    activeSetlistName: document.querySelector('#activeSetlistName'),
    previousSongButton: document.querySelector('#previousSongButton'),
    nextSongButton: document.querySelector('#nextSongButton'),
    exportSetlistButton: document.querySelector('#exportSetlistButton'),
    playBars: document.querySelector('#playBars'),
    muteBars: document.querySelector('#muteBars'),
    reentryBars: document.querySelector('#reentryBars'),
    practiceStartStop: document.querySelector('#practiceStartStop'),
    practiceStatus: document.querySelector('#practiceStatus'),
    cycleBar: document.querySelector('#cycleBar'),
    practicePhaseCards: document.querySelectorAll('[data-practice-phase]')
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

  async function ensureAudio() {
    try {
      if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
    } catch (_) {
      // Audio routing support differs between mobile browsers; Web Audio still uses the speaker.
    }
    if (!state.audio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      state.audio = new AudioContext({ latencyHint: 'interactive' });
      if (typeof state.audio.setSinkId === 'function') {
        try {
          // An empty sink id selects the device's normal/default audio output.
          await state.audio.setSinkId('');
        } catch (_) {
          // Browsers without output-selection permission already use the system default.
        }
      }
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

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.hidden || state.wakeLock) return;
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; }, { once: true });
    } catch (_) {
      // Some browsers only grant a wake lock after a user gesture. The next interaction retries it.
    }
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

      const meterBeatPosition = state.currentStep * state.meter.denominator / (4 * subdivisionFactor());
      const nearestMeterBeat = Math.round(meterBeatPosition);
      const isPrimaryBeat = Math.abs(meterBeatPosition - nearestMeterBeat) < 0.0001;
      const beat = nearestMeterBeat % state.meter.numerator;
      const level = isPrimaryBeat ? state.accentLevels[beat] ?? 1 : 1;

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
        els.practicePhaseCards.forEach(card => {
          card.classList.toggle('is-current', card.dataset.practicePhase === phase.phase);
        });
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
    els.practicePhaseCards.forEach(card => card.classList.remove('is-current'));
    updateTransportUI();
  }

  function setBpm(value) {
    const bpm = Math.round(clamp(Number(value) || state.bpm, MIN_BPM, MAX_BPM));
    state.bpm = bpm;
    els.bpmDisplay.value = bpm;
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
      btn.innerHTML = '<span class="accent-block top"></span><span class="accent-block middle"></span><span class="accent-block bottom"></span>';
      btn.addEventListener('click', () => {
        state.accentLevels[i] = (state.accentLevels[i] + 1) % 3;
        if (i === 0) {
          state.accentFirst = state.accentLevels[0] === 2;
          els.accentFirst.checked = state.accentFirst;
        }
        renderAccentControls();
      });
      els.accentControls.append(btn);
    });
  }

  const subdivisionSymbols = { quarter: '♩', eighth: '♪', sixteenth: '♬', triplet: '♪3' };
  const subdivisionCsvValues = { quarter: '1/4', eighth: '1/8', sixteenth: '1/16', triplet: '1/8T' };
  const newId = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  function normalizeSubdivision(value) {
    const normalized = String(value || '').trim().toLowerCase().replaceAll(' ', '');
    const values = {
      quarter: 'quarter', 'quarternote': 'quarter', '1/4': 'quarter', '♩': 'quarter',
      eighth: 'eighth', 'eighthnote': 'eighth', '1/8': 'eighth', '♪': 'eighth',
      sixteenth: 'sixteenth', 'sixteenthnote': 'sixteenth', '1/16': 'sixteenth', '♬': 'sixteenth',
      triplet: 'triplet', 'eighth-notetriplet': 'triplet', '1/8t': 'triplet', '♪3': 'triplet'
    };
    return values[normalized] || 'quarter';
  }

  function parseCsv(text) {
    const rows = [];
    const headerLine = text.split(/\r?\n/, 1)[0] || '';
    const delimiter = (headerLine.match(/;/g) || []).length > (headerLine.match(/,/g) || []).length ? ';' : ',';
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"' && quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        row.push(field.trim());
        field = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        row.push(field.trim());
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
    row.push(field.trim());
    if (row.some(value => value !== '')) rows.push(row);
    return rows;
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  const actionIcons = {
    edit: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20ZM14.5 7.5l3 3" /></svg>',
    delete: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>'
  };

  function setIconButton(button, icon, label) {
    button.classList.add('icon-button');
    button.innerHTML = actionIcons[icon];
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function activeSetlist() {
    return state.setlists.find(setlist => setlist.id === state.activeSetlistId) || null;
  }

  function saveSetlists() {
    try {
      localStorage.setItem('pulse-setlists-v2', JSON.stringify(state.setlists));
    } catch (_) {
      // Data remains available for this session if private storage is unavailable.
    }
  }

  function loadSetlists() {
    try {
      const saved = JSON.parse(localStorage.getItem('pulse-setlists-v2') || '[]');
      state.setlists = Array.isArray(saved) ? saved : [];
      // Preserve songs created with the earlier single-setlist version.
      if (!state.setlists.length) {
        const legacySongs = JSON.parse(localStorage.getItem('pulse-setlist-v1') || '[]');
        if (Array.isArray(legacySongs) && legacySongs.length) {
          state.setlists = [{ id: newId(), name: 'My Setlist', songs: legacySongs }];
          saveSetlists();
        }
      }
      state.activeSetlistId = state.setlists[0]?.id || null;
    } catch (_) {
      state.setlists = [];
    }
  }

  function applySong(song) {
    setBpm(song.bpm);
    setMeter(song.meter);
    state.subdivision = song.subdivision;
    state.accentLevels = Array.from({ length: state.meter.numerator }, (_, i) => song.accents?.[i] ?? (i === 0 ? 2 : 1));
    state.accentFirst = state.accentLevels[0] === 2;
    els.accentFirst.checked = state.accentFirst;
    renderAccentControls();
    updateActiveButtons(els.subdivisionButtons, '[data-subdivision]', state.subdivision, 'subdivision');
  }

  async function playSong(song, { toggle = false } = {}) {
    if (!song) return;
    if (toggle && state.activeSongId === song.id && state.isRunning && !state.isPractice) {
      stop();
      renderSetlists();
      return;
    }
    applySong(song);
    state.activeSongId = song.id;
    await start({ practice: false });
    renderSetlists();
  }

  function exportActiveSetlist() {
    const setlist = activeSetlist();
    if (!setlist) return;
    const rows = [['name', 'bpm', 'time_sign', 'subdivision']];
    setlist.songs.forEach(song => rows.push([
      song.name,
      song.bpm,
      song.meter,
      subdivisionCsvValues[song.subdivision] || song.subdivision
    ]));
    const csv = rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${setlist.name.replace(/[\\/:*?"<>|]/g, '_') || 'setlist'}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  async function importSetlistFile(file) {
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (rows.length < 1) return;
    const headers = rows[0].map(header => header.replace(/^\uFEFF/, '').trim().toLowerCase());
    const nameIndex = headers.indexOf('name');
    const bpmIndex = headers.indexOf('bpm');
    const meterIndex = headers.indexOf('time_sign');
    const subdivisionIndex = headers.indexOf('subdivision');
    if ([nameIndex, meterIndex, subdivisionIndex].includes(-1)) {
      window.alert('CSV must contain: name, time_sign, subdivision. BPM is optional for older files.');
      return;
    }
    const songs = rows.slice(1).filter(row => row[nameIndex]?.trim()).map(row => {
      const meter = /^\d+\/\d+$/.test(row[meterIndex] || '') ? row[meterIndex] : '4/4';
      const numerator = Number(meter.split('/')[0]);
      return {
        id: newId(),
        name: row[nameIndex].trim(),
        bpm: bpmIndex >= 0 ? Math.round(clamp(Number(row[bpmIndex]) || state.bpm, MIN_BPM, MAX_BPM)) : state.bpm,
        meter,
        subdivision: normalizeSubdivision(row[subdivisionIndex]),
        accents: Array.from({ length: numerator }, (_, i) => i === 0 ? 2 : 1)
      };
    });
    const setlist = { id: newId(), name: file.name.replace(/\.csv$/i, '') || 'Imported Setlist', songs };
    state.setlists.push(setlist);
    state.activeSetlistId = setlist.id;
    saveSetlists();
    els.setlistForm.hidden = true;
    els.setlistForm.reset();
    renderSetlists();
  }

  function openSongEditor(song = null) {
    state.editingSongId = song?.id || null;
    els.songName.value = song?.name || '';
    els.songBpm.value = song?.bpm || state.bpm;
    els.songMeter.value = song?.meter || state.meter.label;
    els.songSubdivision.value = song?.subdivision || state.subdivision;
    const saveLabel = song ? 'Save changes' : 'Add song';
    els.saveSongButton.setAttribute('aria-label', saveLabel);
    els.saveSongButton.title = saveLabel;
    els.songForm.hidden = false;
    els.songName.focus();
  }

  function closeSongEditor() {
    state.editingSongId = null;
    els.songForm.hidden = true;
    els.songForm.reset();
  }

  function renderSetlists() {
    els.setlistItems.innerHTML = '';
    if (!state.setlists.length) {
      els.setlistItems.innerHTML = '<p class="setlist-empty">No setlists yet. Add your first setlist.</p>';
    }

    state.setlists.forEach(setlist => {
      const card = document.createElement('article');
      card.className = 'setlist-collection';
      card.classList.toggle('is-active', setlist.id === state.activeSetlistId);
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = setlist.name;
      const count = document.createElement('span');
      count.className = 'setlist-meta';
      count.textContent = `${setlist.songs.length} ${setlist.songs.length === 1 ? 'song' : 'songs'}`;
      info.append(title, count);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-setlist';
      setIconButton(remove, 'delete', `Delete ${setlist.name}`);
      remove.addEventListener('click', event => {
        event.stopPropagation();
        state.setlists = state.setlists.filter(entry => entry.id !== setlist.id);
        if (state.activeSetlistId === setlist.id) state.activeSetlistId = state.setlists[0]?.id || null;
        saveSetlists();
        renderSetlists();
      });
      const select = () => {
        state.activeSetlistId = setlist.id;
        closeSongEditor();
        renderSetlists();
      };
      card.addEventListener('click', select);
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') select(); });
      card.append(info, remove);
      els.setlistItems.append(card);
    });

    const selected = activeSetlist();
    els.setlistDetail.hidden = !selected;
    if (!selected) return;
    els.activeSetlistName.textContent = selected.name;
    els.previousSongButton.disabled = selected.songs.length === 0;
    els.nextSongButton.disabled = selected.songs.length === 0;
    els.exportSetlistButton.disabled = false;
    els.songItems.innerHTML = '';
    if (!selected.songs.length) els.songItems.innerHTML = '<p class="setlist-empty">No songs in this setlist yet.</p>';

    selected.songs.forEach(song => {
      const item = document.createElement('article');
      item.className = 'setlist-item song-item';
      item.classList.toggle('is-playing', song.id === state.activeSongId && state.isRunning && !state.isPractice);
      item.tabIndex = 0;
      item.dataset.songId = song.id;
      item.setAttribute('role', 'button');
      const dragHandle = document.createElement('span');
      dragHandle.className = 'drag-handle';
      dragHandle.textContent = '⠿';
      dragHandle.title = 'Drag to reorder';
      dragHandle.setAttribute('aria-label', 'Drag to reorder');
      dragHandle.addEventListener('click', event => event.stopPropagation());
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = song.name;
      const meta = document.createElement('span');
      meta.className = 'setlist-meta';
      meta.textContent = `${song.bpm} BPM · ${song.meter} · ${subdivisionSymbols[song.subdivision] || song.subdivision}`;
      info.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'setlist-actions';
      const changeButton = document.createElement('button');
      changeButton.type = 'button';
      setIconButton(changeButton, 'edit', `Change ${song.name}`);
      changeButton.addEventListener('click', event => { event.stopPropagation(); openSongEditor(song); });
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-song';
      setIconButton(deleteButton, 'delete', `Delete ${song.name}`);
      deleteButton.addEventListener('click', event => {
        event.stopPropagation();
        selected.songs = selected.songs.filter(entry => entry.id !== song.id);
        saveSetlists();
        renderSetlists();
      });
      item.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('button')) return;
        if (event.pointerType === 'touch' && !event.target.closest('.drag-handle')) return;
        state.pointerDrag = { pointerId: event.pointerId, songId: song.id, targetId: song.id, startX: event.clientX, startY: event.clientY, clientY: event.clientY, active: false };
      });
      item.addEventListener('pointermove', event => {
        const drag = state.pointerDrag;
        if (!drag || drag.pointerId !== event.pointerId || drag.songId !== song.id) return;
        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (!drag.active && distance > 7) {
          drag.active = true;
          state.draggedSongId = song.id;
          item.classList.add('is-dragging');
          item.setPointerCapture(event.pointerId);
        }
        if (!drag.active) return;
        event.preventDefault();
        drag.clientY = event.clientY;
        document.querySelectorAll('.song-item.is-drop-target').forEach(card => card.classList.remove('is-drop-target'));
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.song-item');
        if (target && target.dataset.songId !== song.id) {
          drag.targetId = target.dataset.songId;
          target.classList.add('is-drop-target');
        }
      });
      const finishPointerDrag = event => {
        const drag = state.pointerDrag;
        if (!drag || drag.pointerId !== event.pointerId || drag.songId !== song.id) return;
        if (drag.active && drag.targetId !== drag.songId) {
          const fromIndex = selected.songs.findIndex(entry => entry.id === drag.songId);
          const targetElement = els.songItems.querySelector(`[data-song-id="${CSS.escape(drag.targetId)}"]`);
          if (fromIndex >= 0 && targetElement) {
            const [movedSong] = selected.songs.splice(fromIndex, 1);
            let targetIndex = selected.songs.findIndex(entry => entry.id === drag.targetId);
            if (drag.clientY > targetElement.getBoundingClientRect().top + targetElement.offsetHeight / 2) targetIndex += 1;
            selected.songs.splice(targetIndex, 0, movedSong);
            saveSetlists();
          }
        }
        const wasActive = drag.active;
        item.classList.remove('is-dragging');
        document.querySelectorAll('.song-item.is-drop-target').forEach(card => card.classList.remove('is-drop-target'));
        state.pointerDrag = null;
        if (wasActive) {
          renderSetlists();
          window.setTimeout(() => { state.draggedSongId = null; }, 0);
        }
      };
      item.addEventListener('pointerup', finishPointerDrag);
      item.addEventListener('pointercancel', finishPointerDrag);
      item.addEventListener('click', () => { if (!state.draggedSongId) playSong(song, { toggle: true }); });
      item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') playSong(song, { toggle: true }); });
      actions.append(changeButton, deleteButton);
      item.append(dragHandle, info, actions);
      els.songItems.append(item);
    });
  }

  function switchTab(tabName) {
    els.tabs.forEach(tab => tab.classList.toggle('is-active', tab.dataset.tab === tabName));
    els.metroPage.classList.toggle('is-active', tabName === 'metro');
    els.setlistPage.classList.toggle('is-active', tabName === 'setlist');
    els.practicePage.classList.toggle('is-active', tabName === 'practice');
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
      if (event.target === els.bpmDisplay) return;
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
    let scrollFrame = null;
    window.addEventListener('scroll', () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        const compact = els.topbar.classList.contains('is-scrolled') ? window.scrollY > 8 : window.scrollY > 36;
        els.topbar.classList.toggle('is-scrolled', compact);
        scrollFrame = null;
      });
    }, { passive: true });
    els.topbar.classList.toggle('is-scrolled', window.scrollY > 24);
    document.addEventListener('pointerdown', requestWakeLock);
    document.addEventListener('dblclick', event => event.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', event => event.preventDefault(), { passive: false });
    document.addEventListener('touchmove', event => {
      if (event.touches.length > 1) event.preventDefault();
    }, { passive: false });
    document.addEventListener('wheel', event => {
      if (event.ctrlKey) event.preventDefault();
    }, { passive: false });
    els.startStop.addEventListener('click', () => state.isRunning && !state.isPractice ? stop() : start({ practice: false }));
    els.practiceStartStop.addEventListener('click', () => {
      if (state.isRunning && state.isPractice) return stop();
      readPracticeInputs();
      start({ practice: true });
    });
    [els.bpmInput, els.bpmDisplay].forEach(input => {
      input.addEventListener('focus', e => e.target.select());
      input.addEventListener('change', e => setBpm(e.target.value));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') e.target.blur();
      });
    });
    els.volume.addEventListener('input', e => {
      const percent = Number(e.target.value);
      // A squared curve gives the low end useful resolution while still reaching full output.
      state.volume = Math.pow(percent / 100, 2);
      const volumeValue = document.querySelector('#volumeValue');
      if (volumeValue) volumeValue.textContent = `${Math.round(percent)}%`;
      if (state.masterGain) state.masterGain.gain.setTargetAtTime(state.volume, state.audio.currentTime, 0.01);
    });
    els.accentFirst.addEventListener('change', e => {
      state.accentFirst = e.target.checked;
      state.accentLevels[0] = state.accentFirst ? 2 : 1;
      renderAccentControls();
    });
    els.meterButtons.addEventListener('click', e => { if (e.target.dataset.meter) setMeter(e.target.dataset.meter); });
    els.subdivisionButtons.addEventListener('click', e => {
      const button = e.target.closest('[data-subdivision]');
      if (!button) return;
      state.subdivision = button.dataset.subdivision;
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
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    els.addSetlistButton.addEventListener('click', () => {
      els.setlistForm.hidden = false;
      els.setlistName.focus();
    });
    els.cancelSetlistButton.addEventListener('click', () => {
      els.setlistForm.hidden = true;
      els.setlistForm.reset();
    });
    els.setlistCsvInput.addEventListener('change', event => {
      importSetlistFile(event.target.files?.[0]);
    });
    els.setlistForm.addEventListener('submit', event => {
      event.preventDefault();
      const name = els.setlistName.value.trim();
      if (!name) return;
      const setlist = { id: newId(), name, songs: [] };
      state.setlists.push(setlist);
      state.activeSetlistId = setlist.id;
      saveSetlists();
      els.setlistForm.reset();
      els.setlistForm.hidden = true;
      renderSetlists();
    });
    els.addSongButton.addEventListener('click', () => openSongEditor());
    els.exportSetlistButton.addEventListener('click', exportActiveSetlist);
    const moveThroughSetlist = direction => {
      const songs = activeSetlist()?.songs || [];
      if (!songs.length) return;
      const currentIndex = songs.findIndex(song => song.id === state.activeSongId);
      const nextIndex = currentIndex < 0
        ? (direction > 0 ? 0 : songs.length - 1)
        : (currentIndex + direction + songs.length) % songs.length;
      playSong(songs[nextIndex]);
    };
    els.previousSongButton.addEventListener('click', () => moveThroughSetlist(-1));
    els.nextSongButton.addEventListener('click', () => moveThroughSetlist(1));
    els.cancelSongButton.addEventListener('click', closeSongEditor);
    els.songForm.addEventListener('submit', event => {
      event.preventDefault();
      const setlist = activeSetlist();
      const name = els.songName.value.trim();
      if (!setlist || !name) return;
      const meter = els.songMeter.value;
      const numerator = Number(meter.split('/')[0]);
      const existing = setlist.songs.find(song => song.id === state.editingSongId);
      const song = {
        id: existing?.id || newId(),
        name,
        bpm: Math.round(clamp(Number(els.songBpm.value), MIN_BPM, MAX_BPM)),
        meter,
        subdivision: els.songSubdivision.value,
        accents: Array.from({ length: numerator }, (_, i) => existing?.accents?.[i] ?? (i === 0 ? 2 : 1))
      };
      if (existing) Object.assign(existing, song);
      else setlist.songs.push(song);
      saveSetlists();
      closeSongEditor();
      renderSetlists();
    });
    [els.playBars, els.muteBars, els.reentryBars].forEach(input => input.addEventListener('change', readPracticeInputs));
    document.addEventListener('visibilitychange', () => {
      // Moderne Browser können Hintergrund-Timer drosseln. Beim Zurückkehren wird die Vorausplanung
      // sofort neu angestoßen; bereits geplante Audioevents bleiben unbeeinflusst.
      if (!document.hidden && state.isRunning) scheduler();
      if (!document.hidden) requestWakeLock();
    });
  }

  setBpm(120);
  setMeter('4/4');
  loadSetlists();
  renderAccentControls();
  renderSetlists();
  setupWheel();
  setupEvents();
  requestWakeLock();
})();
