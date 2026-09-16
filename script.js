/* ============================================================
   Minesweeper - Windows 3.1 (WINMINE.EXE) browser recreation.
   Historical behaviors reproduced:
   - Minefield is laid out the moment a new game starts (no
     first-click safety - that is the 3.1/95/98 behavior).
   - Timer starts on the first left click, caps at 999.
   - Counter shows mines minus flags, can go negative (-NN).
   - Right-click cycles covered -> flag -> (?) -> covered when
     Marks is on; covered -> flag -> covered when off.
   - Chording with both buttons (plus middle button convenience).
   - After a loss: clicked mine on red background, other mines
     shown, wrong flags crossed out, correct flags stay.
   - On a win: remaining mines get flagged automatically.
   - XYZYY easter egg: type "xyzzy", then the 1px probe at the
     top-left of the screen turns white over a safe cell and
     black over a mine while the mouse is over the field.
   ============================================================ */
(function () {
'use strict';

/* ------------------------------ constants ------------------------------ */
var LEVELS = {
  beginner:     { cols: 9,  rows: 9,  mines: 10 },
  intermediate: { cols: 16, rows: 16, mines: 40 },
  expert:       { cols: 30, rows: 16, mines: 99 }
};
var ST_COVERED = 0, ST_REVEALED = 1, ST_FLAG = 2, ST_Q = 3;
var T_FLAT = 0, T_COVERED = 1, T_N1 = 2, T_FLAG = 10, T_Q = 11, T_QPRESSED = 12,
    T_MINE = 13, T_MINERED = 14, T_MINEX = 15;
var F_SMILE = 0, F_WINK = 1, F_OOH = 2, F_COOL = 3, F_DEAD = 4;
var DIGIT_IDX = { '0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'-':10,' ':11 };

/* ------------------------------ state ---------------------------------- */
var level = 'beginner', cols = 9, rows = 9, mines = 10;
var board = [], cells = [];
var started = false, over = false, flags = 0, revealedCount = 0, time = 0, timerId = null;
var marks = true, sound = true;
var cheat = false, cheatBuf = '';
var best = {
  beginner:     { time: 999, name: 'Anonymous' },
  intermediate: { time: 999, name: 'Anonymous' },
  expert:       { time: 999, name: 'Anonymous' }
};
var press = { left: false, cell: -1, chordCell: -1, chordTargets: [] };
var openMenuId = null, openDialogId = null;

/* ------------------------------ persistence ---------------------------- */
function saveSettings() {
  try {
    localStorage.setItem('winmine31', JSON.stringify({
      level: level, marks: marks, sound: sound, best: best
    }));
  } catch (e) { /* storage unavailable - play without persistence */ }
}
function loadSettings() {
  try {
    var raw = localStorage.getItem('winmine31');
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s.level && LEVELS[s.level]) level = s.level;
    if (typeof s.marks === 'boolean') marks = s.marks;
    if (typeof s.sound === 'boolean') sound = s.sound;
    if (s.best) for (var k in best) {
      if (s.best[k] && typeof s.best[k].time === 'number') best[k] = s.best[k];
    }
  } catch (e) { /* ignore corrupt settings */ }
}

/* ------------------------------ DOM refs ------------------------------- */
function $(id) { return document.getElementById(id); }
var win = $('win'), field = $('field'), face = $('face'), facegfx = $('facegfx');
var minecounter = $('minecounter'), timerEl = $('timer');
var ledCounter = minecounter.getElementsByTagName('i');
var ledTimer = timerEl.getElementsByTagName('i');
var xyzzyPixel = $('xyzzy');
var desktop = $('desktop');

/* ------------------------------ rendering ------------------------------ */
function bgIndex(c, pressed) {
  if (c.shown !== undefined) return c.shown;
  switch (c.st) {
    case ST_REVEALED: return c.n === 0 ? T_FLAT : T_N1 + c.n - 1;
    case ST_FLAG:     return T_FLAG;
    case ST_Q:        return pressed ? T_QPRESSED : T_Q;
    default:          return pressed ? T_FLAT : T_COVERED;
  }
}
function renderCell(i, pressed) {
  cells[i].style.backgroundPosition = '-' + (bgIndex(board[i], pressed) * 16) + 'px 0';
}
function renderAll() {
  for (var i = 0; i < board.length; i++) renderCell(i, false);
}
function renderLED(leds, str) {
  for (var i = 0; i < 3; i++) {
    var ch = str.charAt(i);
    leds[i].style.backgroundPosition = '-' + (DIGIT_IDX[ch] * 13) + 'px 0';
  }
}
function pad3(v) { return String(v).padStart(3, '0'); }
function renderCounter() {
  var v = mines - flags;
  renderLED(ledCounter, v < 0 ? '-' + String(Math.min(-v, 99)).padStart(2, '0') : pad3(Math.min(v, 999)));
}
function renderTimer() { renderLED(ledTimer, pad3(Math.min(time, 999))); }
function setFace(f) { facegfx.style.backgroundPosition = '-' + (f * 24) + 'px 0'; }

/* ------------------------------ game core ------------------------------ */
function idx(x, y) { return y * cols + x; }
function xy(i) { return [i % cols, (i / cols) | 0]; }
function neighbors(i) {
  var x = i % cols, y = (i / cols) | 0, out = [];
  for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    var nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) out.push(idx(nx, ny));
  }
  return out;
}

function newGame(lvl) {
  if (lvl && LEVELS[lvl]) level = lvl;
  cols = LEVELS[level].cols; rows = LEVELS[level].rows; mines = LEVELS[level].mines;
  stopTimer();
  started = false; over = false; flags = 0; revealedCount = 0; time = 0;
  var N = cols * rows;
  board = new Array(N);
  for (var i = 0; i < N; i++) board[i] = { mine: false, st: ST_COVERED, n: 0 };
  /* Historical: the field is generated immediately, before any click. */
  var order = new Array(N);
  for (i = 0; i < N; i++) order[i] = i;
  for (i = N - 1; i > 0; i--) {
    var j = (Math.random() * (i + 1)) | 0, t = order[i]; order[i] = order[j]; order[j] = t;
  }
  for (i = 0; i < mines; i++) board[order[i]].mine = true;
  for (i = 0; i < N; i++) {
    var c = 0, nb = neighbors(i);
    for (var k = 0; k < nb.length; k++) if (board[nb[k]].mine) c++;
    board[i].n = c;
  }
  buildField();
  renderAll();
  renderCounter(); renderTimer(); setFace(F_SMILE);
  updateChecks(); saveSettings();
}

function buildField() {
  field.innerHTML = '';
  cells = new Array(cols * rows);
  var frag = document.createDocumentFragment();
  for (var i = 0; i < cols * rows; i++) {
    var d = document.createElement('div');
    d.className = 'cell';
    d.setAttribute('data-i', i);
    frag.appendChild(d);
    cells[i] = d;
  }
  field.appendChild(frag);
  field.style.gridTemplateColumns = 'repeat(' + cols + ', 16px)';
}

function startTimer() {
  if (started || over) return;
  started = true;
  timerId = setInterval(function () {
    time = Math.min(999, time + 1);
    renderTimer();
  }, 1000);
}
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

function reveal(i) {
  if (over) return;
  var c = board[i];
  if (c.st !== ST_COVERED && c.st !== ST_Q) return;
  if (c.mine) { lose(i); return; }
  var stack = [i];
  while (stack.length) {
    var j = stack.pop(), cj = board[j];
    if (cj.st === ST_REVEALED || cj.st === ST_FLAG) continue;
    cj.st = ST_REVEALED; revealedCount++;
    renderCell(j);
    if (cj.n === 0) {
      var nb = neighbors(j);
      for (var k = 0; k < nb.length; k++) {
        var ck = board[nb[k]];
        if (!ck.mine && ck.st !== ST_REVEALED && ck.st !== ST_FLAG) stack.push(nb[k]);
      }
    }
  }
  checkWin();
}

function toggleFlag(i) {
  if (over) return;
  var c = board[i];
  if (c.st === ST_REVEALED) return;
  if (c.st === ST_COVERED)      { c.st = ST_FLAG; flags++; playBlip(true); }
  else if (c.st === ST_FLAG)    { c.st = marks ? ST_Q : ST_COVERED; flags--; playBlip(false); }
  else                          { c.st = ST_COVERED; }
  renderCell(i);
  renderCounter();
}

function chord(cell) {
  if (over) return;
  var c = board[cell];
  if (c.st !== ST_REVEALED || c.n === 0) return;
  var nb = neighbors(cell), f = 0, targets = [];
  for (var k = 0; k < nb.length; k++) {
    if (board[nb[k]].st === ST_FLAG) f++;
    else if (board[nb[k]].st !== ST_REVEALED) targets.push(nb[k]);
  }
  if (f !== c.n) return;
  for (k = 0; k < targets.length; k++) {
    if (board[targets[k]].mine) { lose(targets[k]); return; }
  }
  for (k = 0; k < targets.length; k++) { reveal(targets[k]); if (over) return; }
}

function lose(hit) {
  over = true;
  stopTimer();
  setFace(F_DEAD);
  for (var j = 0; j < board.length; j++) {
    var c = board[j];
    if (c.mine) {
      if (j === hit) c.shown = T_MINERED;
      else if (c.st !== ST_FLAG) c.shown = T_MINE;
    } else if (c.st === ST_FLAG) {
      c.shown = T_MINEX;
    }
  }
  renderAll();
  playBoom();
}

function checkWin() {
  if (over || revealedCount !== cols * rows - mines) return;
  over = true;
  stopTimer();
  setFace(F_COOL);
  for (var j = 0; j < board.length; j++) {
    var c = board[j];
    if (c.mine && c.st !== ST_FLAG) { c.st = ST_FLAG; }
  }
  flags = mines;
  renderAll();
  renderCounter();
  playTada();
  if (time < best[level].time) { pendingBestTime = time; openNameDialog(); }
}
var pendingBestTime = null;

/* ------------------------------ previews ------------------------------- */
function clearPress() {
  if (press.cell >= 0) { renderCell(press.cell, false); press.cell = -1; }
  if (press.chordTargets.length) {
    for (var k = 0; k < press.chordTargets.length; k++) renderCell(press.chordTargets[k], false);
    press.chordTargets = [];
  }
  press.chordCell = -1;
  if (!over) setFace(F_SMILE);
}
function pressCell(i) {
  var c = board[i];
  if (over || (c.st !== ST_COVERED && c.st !== ST_Q)) return;
  if (press.cell >= 0 && press.cell !== i) renderCell(press.cell, false);
  press.cell = i;
  renderCell(i, true);
  setFace(F_OOH);
}
function chordPress(i) {
  var c = board[i];
  if (over || c.st !== ST_REVEALED || c.n === 0) return;
  if (press.chordCell !== i) {
    for (var k = 0; k < press.chordTargets.length; k++) renderCell(press.chordTargets[k], false);
    press.chordTargets = [];
    press.chordCell = i;
    var nb = neighbors(i);
    for (k = 0; k < nb.length; k++) {
      if (board[nb[k]].st === ST_COVERED || board[nb[k]].st === ST_Q) {
        press.chordTargets.push(nb[k]);
        renderCell(nb[k], true);
      }
    }
  }
  setFace(F_OOH);
}

/* ------------------------------ input ---------------------------------- */
function cellFromEvent(e) {
  var t = e.target;
  if (!t || !t.classList || !t.classList.contains('cell')) return -1;
  return parseInt(t.getAttribute('data-i'), 10);
}

function pressCellOrChord(i) {
  var before = press.chordTargets.length;
  chordPress(i);
  if (press.chordTargets.length === 0 && before === 0) pressCell(i);
}
field.addEventListener('mousedown', function (e) {
  if (openDialogId) return;
  var i = cellFromEvent(e);
  if (i < 0) return;
  e.preventDefault();
  if (e.button === 0) {
    press.left = true;
    press.cell = -1;
    startTimer();                        /* historical: clock starts on the first left click */
    pressCellOrChord(i);
  } else if (e.button === 2) {
    if (e.buttons === 3) { clearPress(); pressCellOrChord(i); }  /* 2nd button while held: chord */
    else toggleFlag(i);
  } else if (e.button === 1) {
    clearPress();
    chordPress(i);
  }
});

field.addEventListener('mousemove', function (e) {
  if (cheat) {
    var i = cellFromEvent(e);
    if (i >= 0 && board[i].st !== ST_REVEALED) {
      xyzzyPixel.style.background = board[i].mine ? '#000' : '#FFF';
    }
  }
  if (openDialogId) return;
  if (!press.left && !press.chordTargets.length) return;
  var i = cellFromEvent(e);
  if ((e.buttons & 3) === 3 || (e.buttons & 4)) {
    if (i >= 0) { var t0 = press.chordTargets.length; chordPress(i); if (t0 === 0 && press.chordTargets.length === 0 && press.left) pressCell(i); }
  } else if (press.left) {
    if (i === press.cell) pressCell(i);
    else if (press.cell >= 0) { renderCell(press.cell, false); press.cell = -1; if (!over) setFace(F_SMILE); }
  }
});

function finishPress(e) {
  var i = cellFromEvent(e);
  if (press.chordTargets.length) {
    var cc = press.chordCell;
    var targets = press.chordTargets.slice();
    press.chordTargets = [];
    press.left = false; press.cell = -1;
    for (var k = 0; k < targets.length; k++) renderCell(targets[k], false);
    press.chordCell = -1;
    if (!over) setFace(F_SMILE);
    if (i === cc) chord(cc);
    return;
  }
  if (press.left) {
    var pc = press.cell;
    press.left = false; press.cell = -1;
    if (i >= 0 && i === pc) reveal(i);
    else if (pc >= 0) renderCell(pc, false);
    if (!over) setFace(F_SMILE);
  }
}
window.addEventListener('mouseup', function (e) {
  if (e.button === 0 || e.button === 1 || e.button === 2) finishPress(e);
});
field.addEventListener('mouseleave', function () {
  if (press.cell >= 0) { renderCell(press.cell, false); press.cell = -1; }
});

document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

/* face button */
face.addEventListener('mousedown', function (e) {
  e.preventDefault();
  face.classList.add('pressed');
  setFace(F_WINK);
});
face.addEventListener('mouseup', function (e) {
  face.classList.remove('pressed');
  setFace(F_SMILE);
  if (openDialogId) return;
  newGame();
});
face.addEventListener('mouseleave', function () {
  face.classList.remove('pressed');
  if (!over) setFace(F_SMILE);
});

/* keyboard */
document.addEventListener('keydown', function (e) {
  if (e.key === 'F2') { e.preventDefault(); newGame(); return; }
  if (e.key === 'Escape') { closeMenus(); if (openDialogId) closeDialog(openDialogId); return; }
  if (/^[a-z]$/i.test(e.key) && !openDialogId) {
    cheatBuf = (cheatBuf + e.key.toLowerCase()).slice(-8);
    if (cheatBuf.slice(-5) === 'xyzzy') { cheat = !cheat; cheatBuf = ''; }
  }
});
document.addEventListener('mousemove', function (e) {
  if (cheat && e.target !== field && !field.contains(e.target)) {
    /* probe keeps its last color outside the field, like the original */
  }
});

/* ------------------------------ menus ---------------------------------- */
var menus = { gamemenu: $('gamemenu'), helpmenu: $('helpmenu'), ctrlmenu: $('ctrlmenu') };

function winPos(el) {
  var r = el.getBoundingClientRect(), w = win.getBoundingClientRect();
  return { left: Math.round(r.left - w.left), top: Math.round(r.top - w.top) };
}
function openMenu(id, anchor) {
  closeMenus();
  var m = menus[id];
  if (!m) return;
  var p = winPos(anchor);
  m.style.left = p.left + 'px';
  m.style.top = (p.top + anchor.offsetHeight) + 'px';
  m.classList.add('open');
  openMenuId = id;
  if (anchor.classList.contains('menuitem')) anchor.classList.add('open');
}
function closeMenus() {
  for (var k in menus) menus[k].classList.remove('open');
  var items = document.querySelectorAll('.menuitem.open');
  for (var i = 0; i < items.length; i++) items[i].classList.remove('open');
  openMenuId = null;
}

var menuItems = document.querySelectorAll('.menuitem');
for (var mi = 0; mi < menuItems.length; mi++) {
  (function (el) {
    el.addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var id = el.getAttribute('data-menu');
      if (openMenuId === id) closeMenus(); else openMenu(id, el);
    });
    el.addEventListener('mouseenter', function () {
      if (openMenuId && openMenuId !== el.getAttribute('data-menu')) openMenu(el.getAttribute('data-menu'), el);
    });
  })(menuItems[mi]);
}

function updateChecks() {
  var checks = document.querySelectorAll('.check');
  for (var i = 0; i < checks.length; i++) {
    var spec = checks[i].getAttribute('data-check').split(':');
    var on = false;
    if (spec[0] === 'level') on = (spec[1] === level);
    else if (spec[0] === 'flag') on = (spec[1] === 'marks' ? marks : sound);
    checks[i].classList.toggle('on', on);
  }
}

/* dropdown item hover highlight */
var dropItems = document.querySelectorAll('.mitem');
for (var di = 0; di < dropItems.length; di++) {
  (function (el) {
    el.addEventListener('mouseenter', function () {
      if (!el.classList.contains('disabled')) {
        var sibs = el.parentNode.querySelectorAll('.mitem.sel');
        for (var i = 0; i < sibs.length; i++) sibs[i].classList.remove('sel');
        el.classList.add('sel');
      }
    });
  })(dropItems[di]);
}

/* dropdown commands */
document.addEventListener('click', function (e) {
  var t = e.target.closest ? e.target.closest('.mitem') : null;
  if (!t || t.classList.contains('disabled') || !t.closest('.dropdown')) return;
  var cmd = t.getAttribute('data-cmd');
  if (!cmd) return;
  closeMenus();
  execCmd(cmd);
});

function execCmd(cmd) {
  switch (cmd) {
    case 'new': newGame(); break;
    case 'beginner': case 'intermediate': case 'expert':
      newGame(cmd); break;
    case 'marks': marks = !marks; updateChecks(); saveSettings(); break;
    case 'sound': sound = !sound; updateChecks(); saveSettings(); break;
    case 'best': openDialog('dlg-best'); break;
    case 'how': openDialog('dlg-how'); break;
    case 'about': openDialog('dlg-about'); break;
    case 'exit': case 'minimize': case 'close': hideWindow(); break;
  }
}

/* close menus when clicking elsewhere */
document.addEventListener('mousedown', function (e) {
  if (openMenuId && !e.target.closest('.dropdown') && !e.target.closest('.menuitem') && !e.target.closest('.capbtn')) {
    closeMenus();
  }
}, true);

/* ------------------------------ dialogs -------------------------------- */
function openDialog(id) {
  if (openDialogId) closeDialog(openDialogId);
  var d = $(id);
  d.classList.add('open');
  openDialogId = id;
  var dw = d.offsetWidth, dh = d.offsetHeight;
  d.style.left = Math.max(8, Math.round((window.innerWidth - dw) / 2)) + 'px';
  d.style.top = Math.max(8, Math.round((window.innerHeight - dh) / 2)) + 'px';
  if (id === 'dlg-best') refreshBest();
}
function closeDialog(id) {
  $(id).classList.remove('open');
  if (openDialogId === id) openDialogId = null;
}
var closers = document.querySelectorAll('[data-close]');
for (var ci = 0; ci < closers.length; ci++) {
  closers[ci].addEventListener('click', function () { closeDialog(this.getAttribute('data-close')); });
}

function refreshBest() {
  for (var k in best) {
    $('best-' + k + '-t').textContent = best[k].time + ' Seconds';
    $('best-' + k + '-n').textContent = best[k].name;
  }
}
$('btn-reset-scores').addEventListener('click', function () {
  for (var k in best) best[k] = { time: 999, name: 'Anonymous' };
  saveSettings(); refreshBest();
});

function openNameDialog() {
  $('name-level').textContent = level;
  var ed = $('nameedit');
  ed.value = '';
  openDialog('dlg-name');
  setTimeout(function () { ed.focus(); }, 0);
}
function commitName() {
  var nm = $('nameedit').value.trim();
  if (pendingBestTime !== null && pendingBestTime <= best[level].time) {
    best[level].time = pendingBestTime;
    best[level].name = nm || 'Anonymous';
  }
  pendingBestTime = null;
  saveSettings();
  closeDialog('dlg-name');
}
$('btn-name-ok').addEventListener('click', commitName);
$('nameedit').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') commitName();
});

/* ------------------------------ window chrome -------------------------- */
function hideWindow() {
  win.style.display = 'none';
  closeMenus();
}
desktop.addEventListener('dblclick', function (e) {
  if (win.style.display === 'none') win.style.display = '';
});

/* drag by the title bar */
(function () {
  var dragging = false, ox = 0, oy = 0;
  var caption = $('caption');
  caption.addEventListener('mousedown', function (e) {
    if (e.target.closest('.capbtn')) return;
    dragging = true;
    var wr = win.getBoundingClientRect();
    ox = e.clientX - wr.left; oy = e.clientY - wr.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    win.style.left = Math.round(e.clientX - ox) + 'px';
    win.style.top = Math.max(0, Math.round(e.clientY - oy)) + 'px';
  });
  window.addEventListener('mouseup', function () { dragging = false; });
})();

$('ctrlbox').addEventListener('mousedown', function (e) {
  e.preventDefault(); e.stopPropagation();
  if (openMenuId === 'ctrlmenu') { closeMenus(); return; }
  openMenu('ctrlmenu', this);
});
$('minbox').addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
$('minbox').addEventListener('click', function () { hideWindow(); });

/* ------------------------------ sound ---------------------------------- */
var actx = null;
function audio() {
  if (!sound) return null;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  } catch (e) { return null; }
}
function tone(freq, dur, when, vol, type) {
  var a = audio(); if (!a) return;
  var o = a.createOscillator(), g = a.createGain();
  o.type = type || 'square';
  o.frequency.value = freq;
  g.gain.value = vol || 0.08;
  o.connect(g); g.connect(a.destination);
  var t = a.currentTime + (when || 0);
  o.start(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.stop(t + dur + 0.02);
}
function playBlip(on)  { if (sound) tone(on ? 1400 : 900, 0.04, 0, 0.05); }
function playTada()    { if (!sound) return; tone(523, 0.12, 0); tone(659, 0.12, 0.12); tone(784, 0.12, 0.24); tone(1047, 0.25, 0.36); }
function playBoom()    {
  if (!sound) return;
  var a = audio(); if (!a) return;
  var o = a.createOscillator(), g = a.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(300, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(40, a.currentTime + 0.5);
  g.gain.setValueAtTime(0.15, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.55);
  o.connect(g); g.connect(a.destination);
  o.start(); o.stop(a.currentTime + 0.6);
}

/* ------------------------------ boot ----------------------------------- */
loadSettings();
newGame(level);
(function center() {
  var w = win.offsetWidth, h = win.offsetHeight;
  win.style.left = Math.max(0, Math.round((window.innerWidth - w) / 2)) + 'px';
  win.style.top = Math.max(0, Math.round((window.innerHeight - h) / 2)) + 'px';
})();

/* test/debug hooks (not part of the game UI) */
window.WM = {
  newGame: newGame,
  reveal: function (x, y) { reveal(idx(x, y)); },
  flag: function (x, y) { toggleFlag(idx(x, y)); },
  chord: function (x, y) { chord(idx(x, y)); },
  setLevel: function (l) { newGame(l); },
  setMarks: function (v) { marks = !!v; updateChecks(); },
  cell: function (x, y) {
    var c = board[idx(x, y)];
    return { mine: c.mine, st: c.st, n: c.n, shown: c.shown };
  },
  neighborsMines: function (x, y) {
    var nb = neighbors(idx(x, y)), m = 0;
    for (var k = 0; k < nb.length; k++) if (board[nb[k]].mine) m++;
    return m;
  },
  state: function () {
    return { level: level, cols: cols, rows: rows, mines: mines, flags: flags,
             revealed: revealedCount, time: time, over: over, started: started,
             marks: marks, sound: sound,
             counterText: mines - flags, cellCount: board.length };
  },
  minesList: function () {
    var out = [];
    for (var i = 0; i < board.length; i++) if (board[i].mine) out.push(i);
    return out;
  }
};

})();
