/* ═══════════════════════════════════════════════════
   RPS CLASH — app.js
   Handles: game modes, logic, scoring, history,
            sound effects (Web Audio), animations
════════════════════════════════════════════════════ */

"use strict";

/* ── 1. CONSTANTS ── */

// The three possible weapons with their emojis and what they beat
const WEAPONS = {
  rock:     { emoji: "✊", beats: "scissors", label: "Rock" },
  paper:    { emoji: "🖐️", beats: "rock",     label: "Paper" },
  scissors: { emoji: "✌️", beats: "paper",    label: "Scissors" }
};

const CHOICES = ["rock", "paper", "scissors"];

/* ── 2. GAME STATE ── */

let mode       = "pvc";  // "pvc" = Player vs Computer  |  "pvp" = Player vs Player
let scores     = { p1: 0, p2: 0, draw: 0 };
let roundNum   = 0;
let p1Choice   = null;   // stores P1's pick while waiting for P2 (PvP only)
let roundInProgress = false; // lock buttons during animation

/* ── 3. DOM REFERENCES ── */

const btnPvC        = document.getElementById("btnPvC");
const btnPvP        = document.getElementById("btnPvP");
const nameRow       = document.getElementById("nameRow");
const p1NameInput   = document.getElementById("p1Name");
const p2NameInput   = document.getElementById("p2Name");
const labelP1       = document.getElementById("labelP1");
const labelP2       = document.getElementById("labelP2");
const scoreP1El     = document.getElementById("scoreP1");
const scoreP2El     = document.getElementById("scoreP2");
const scoreDrawEl   = document.getElementById("scoreDraw");
const scoreBlockP1  = document.getElementById("scoreBlockP1");
const scoreBlockP2  = document.getElementById("scoreBlockP2");
const handP1        = document.getElementById("handP1");
const handP2        = document.getElementById("handP2");
const arenaLabelP1  = document.getElementById("arenaLabelP1");
const arenaLabelP2  = document.getElementById("arenaLabelP2");
const resultRibbon  = document.getElementById("resultRibbon");
const p1Section     = document.getElementById("p1Section");
const p2Section     = document.getElementById("p2Section");
const p1Prompt      = document.getElementById("p1Prompt");
const p2Prompt      = document.getElementById("p2Prompt");
const historySection = document.getElementById("historySection");
const historyList   = document.getElementById("historyList");
const resultOverlay = document.getElementById("resultOverlay");

/* ── 4. SOUND ENGINE (Web Audio API) ── */

// We generate simple beep/burst sounds using the browser's audio API.
// No external files needed — pure JavaScript synthesis.

const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

/** Lazily initialise AudioContext (browsers require a user gesture first) */
function getAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/**
 * Play a simple synthesised tone.
 * @param {number} freq  - Frequency in Hz
 * @param {number} dur   - Duration in seconds
 * @param {string} type  - Oscillator type: "sine"|"square"|"sawtooth"|"triangle"
 * @param {number} vol   - Volume 0–1
 * @param {number} delay - Delay before playing (seconds)
 */
function playTone(freq, dur, type = "sine", vol = 0.18, delay = 0) {
  try {
    const ctx  = getAudio();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type      = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    gain.gain.setValueAtTime(0, ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + dur + 0.05);
  } catch (e) { /* silently fail if audio not available */ }
}

/** Click / select sound */
function sfxClick()  { playTone(520, 0.08, "square", 0.12); }

/** Countdown ticks (rock–paper–scissors!) */
function sfxCountdown() {
  playTone(440, 0.07, "square", 0.15, 0.0);
  playTone(550, 0.07, "square", 0.15, 0.13);
  playTone(660, 0.12, "square", 0.18, 0.26);
}

/** Win fanfare — two rising notes */
function sfxWin() {
  playTone(523, 0.12, "triangle", 0.2, 0.0);
  playTone(659, 0.12, "triangle", 0.2, 0.13);
  playTone(784, 0.25, "triangle", 0.22, 0.26);
}

/** Lose — descending minor chord */
function sfxLose() {
  playTone(392, 0.15, "sawtooth", 0.12, 0.0);
  playTone(330, 0.15, "sawtooth", 0.12, 0.12);
  playTone(294, 0.25, "sawtooth", 0.14, 0.24);
}

/** Draw — neutral blip */
function sfxDraw() {
  playTone(440, 0.18, "sine", 0.15);
}

/* ── 5. MODE SWITCHING ── */

/**
 * Switch between PvC and PvP modes.
 * Resets the game whenever mode changes.
 */
function setMode(newMode) {
  if (mode === newMode) return;
  mode = newMode;
  sfxClick();

  // Update button active state
  btnPvC.classList.toggle("active", mode === "pvc");
  btnPvP.classList.toggle("active", mode === "pvp");

  // Show/hide PvP name inputs and P2 choice panel
  nameRow.style.display   = mode === "pvp" ? "flex"  : "none";
  p2Section.style.display = mode === "pvp" ? "block" : "none";

  // Update arena labels
  arenaLabelP2.textContent = mode === "pvp" ? (p2NameInput.value || "P2") : "CPU";
  labelP2.textContent      = mode === "pvp" ? (p2NameInput.value || "P2").toUpperCase() : "CPU";

  resetGame(true); // reset without sfx
}

/* ── 6. NAME UPDATES (PvP) ── */

/** Called on every keystroke in the name inputs */
function updateNames() {
  const n1 = p1NameInput.value.trim() || "Player 1";
  const n2 = p2NameInput.value.trim() || "Player 2";
  labelP1.textContent      = n1.toUpperCase();
  labelP2.textContent      = n2.toUpperCase();
  arenaLabelP1.textContent = n1;
  arenaLabelP2.textContent = n2;
}

/* ── 7. COMPUTER CHOICE ── */

/**
 * Returns a random choice from the CHOICES array.
 * This is the AI logic for PvC mode.
 */
function getComputerChoice() {
  const idx = Math.floor(Math.random() * CHOICES.length);
  return CHOICES[idx];
}

/* ── 8. DETERMINE ROUND WINNER ── */

/**
 * Compare two choices and return "p1", "p2", or "draw".
 * Logic: each weapon has a 'beats' property listing what it defeats.
 */
function determineWinner(c1, c2) {
  if (c1 === c2) return "draw";
  return WEAPONS[c1].beats === c2 ? "p1" : "p2";
}

/* ── 9. HANDLE A CHOICE CLICK ── */

/**
 * Entry point for every choice button click.
 * In PvC mode: P1 clicks → computer picks → resolve immediately.
 * In PvP mode: P1 clicks → wait → P2 clicks → resolve.
 */
function handleChoice(choice, player) {
  if (roundInProgress) return; // block clicks during animation
  sfxClick();

  if (mode === "pvc") {
    // ── PvC: single click resolves the round ──
    const cpuChoice = getComputerChoice();
    resolveRound(choice, cpuChoice);

  } else {
    // ── PvP: two separate clicks ──
    if (player === "p1") {
      p1Choice = choice;
      showP1Waiting();
    } else if (player === "p2" && p1Choice) {
      const c2 = choice;
      resolveRound(p1Choice, c2);
      p1Choice = null;
    }
  }
}

/** After P1 picks in PvP: hide P1 buttons, show waiting message + P2 buttons */
function showP1Waiting() {
  // Temporarily replace P1 buttons with a waiting message
  const existingMsg = p1Section.querySelector(".waiting-msg");
  if (!existingMsg) {
    const row = p1Section.querySelector(".choice-row");
    row.style.display = "none";

    const msg = document.createElement("div");
    msg.className = "waiting-msg";
    msg.id = "waitingMsg";
    msg.textContent = `✅ ${labelP1.textContent} chose — Player 2's turn!`;
    p1Section.appendChild(msg);
  }

  // Show P2 section
  p2Section.style.display = "block";
}

/** Restore P1 buttons (called after round resolves in PvP) */
function restoreP1Buttons() {
  const msg = document.getElementById("waitingMsg");
  if (msg) msg.remove();
  const row = p1Section.querySelector(".choice-row");
  if (row) row.style.display = "flex";

  if (mode === "pvp") p2Section.style.display = "none";
}

/* ── 10. RESOLVE THE ROUND ── */

/**
 * The core game loop: animate → update scores → show history entry.
 */
function resolveRound(c1, c2) {
  roundInProgress = true;
  roundNum++;

  // Determine winner before animation starts
  const winner = determineWinner(c1, c2);

  // Reset ribbon
  resultRibbon.style.visibility = "hidden";
  resultRibbon.className        = "result-ribbon";

  // Show question marks while "thinking"
  handP1.textContent = "❓";
  handP2.textContent = "❓";

  // Shake animation (simulates "rock, paper, scissors, shoot!")
  sfxCountdown();
  handP1.classList.remove("shake", "reveal");
  handP2.classList.remove("shake", "reveal");
  void handP1.offsetWidth; // force reflow to restart animation
  void handP2.offsetWidth;
  handP1.classList.add("shake");
  handP2.classList.add("shake");

  // After shake: reveal the chosen hands
  setTimeout(() => {
    handP1.classList.remove("shake");
    handP2.classList.remove("shake");

    handP1.textContent = WEAPONS[c1].emoji;
    handP2.textContent = WEAPONS[c2].emoji;

    handP1.classList.add("reveal");
    handP2.classList.add("reveal");

    // Show result ribbon + update scores after hands appear
    setTimeout(() => {
      showResultRibbon(winner, c1, c2);
      updateScores(winner);
      addHistoryEntry(roundNum, c1, c2, winner);
      triggerOverlay(winner);

      // Unlock clicks
      setTimeout(() => {
        roundInProgress = false;
        restoreP1Buttons();
        if (mode === "pvp") p2Section.style.display = "none";
      }, 900);

    }, 480);
  }, 700);
}

/* ── 11. RESULT RIBBON ── */

function showResultRibbon(winner, c1, c2) {
  let text = "";
  if (winner === "draw") {
    text = "DRAW!";
    resultRibbon.classList.add("draw-ribbon");
  } else if (winner === "p1") {
    const n = mode === "pvp" ? (p1NameInput.value.trim() || "P1") : "YOU";
    text = `${n} WIN!`;
  } else {
    const n = mode === "pvp" ? (p2NameInput.value.trim() || "P2") : "CPU";
    text = `${n} WIN!`;
    resultRibbon.classList.add("p2-ribbon");
  }

  resultRibbon.textContent   = text;
  resultRibbon.style.visibility = "visible";
}

/* ── 12. SCORE UPDATE ── */

function updateScores(winner) {
  if (winner === "p1") {
    scores.p1++;
    animateScore(scoreP1El);
    scoreBlockP1.classList.add("leading");
    scoreBlockP2.classList.remove("leading");
    sfxWin();
  } else if (winner === "p2") {
    scores.p2++;
    animateScore(scoreP2El);
    scoreBlockP2.classList.add("leading");
    scoreBlockP1.classList.remove("leading");
    mode === "pvc" ? sfxLose() : sfxWin();
  } else {
    scores.draw++;
    scoreBlockP1.classList.remove("leading");
    scoreBlockP2.classList.remove("leading");
    sfxDraw();
  }

  scoreP1El.textContent   = scores.p1;
  scoreP2El.textContent   = scores.p2;
  scoreDrawEl.textContent = scores.draw;
}

/** Bounce animation on the score number */
function animateScore(el) {
  el.classList.remove("bump");
  void el.offsetWidth; // reflow
  el.classList.add("bump");
  el.addEventListener("animationend", () => el.classList.remove("bump"), { once: true });
}

/* ── 13. OVERLAY FLASH ── */

/**
 * Show a big coloured text flash in the centre of the screen for impact.
 */
function triggerOverlay(winner) {
  let msg   = "";
  let color = "";

  if (winner === "draw") {
    msg   = "DRAW! 🤝";
    color = "#ffe033";
  } else if (winner === "p1") {
    const n = mode === "pvp" ? (p1NameInput.value.trim() || "P1").toUpperCase() : "YOU WIN";
    msg   = `${n}! 🏆`;
    color = "#00ffe1";
  } else {
    const n = mode === "pvp" ? (p2NameInput.value.trim() || "P2").toUpperCase() : "CPU WINS";
    msg   = `${n}! 💀`;
    color = "#ff2d78";
  }

  resultOverlay.textContent = msg;
  resultOverlay.style.color = color;
  resultOverlay.classList.remove("show");
  void resultOverlay.offsetWidth; // reflow to restart animation
  resultOverlay.classList.add("show");
  resultOverlay.addEventListener("animationend", () => {
    resultOverlay.classList.remove("show");
  }, { once: true });
}

/* ── 14. ROUND HISTORY ── */

/**
 * Prepend a new history card to the history list.
 * Shows round number, both emojis, and the result badge.
 */
function addHistoryEntry(round, c1, c2, winner) {
  historySection.style.display = "block";

  const p1Label = mode === "pvp" ? (p1NameInput.value.trim() || "P1") : "You";
  const p2Label = mode === "pvp" ? (p2NameInput.value.trim() || "P2") : "CPU";

  // Determine result text and CSS class
  let resultText  = "";
  let resultClass = "";
  if (winner === "draw") {
    resultText  = "DRAW";
    resultClass = "res-draw";
  } else if (winner === "p1") {
    resultText  = `${p1Label.toUpperCase()} WON`;
    resultClass = "res-p1";
  } else {
    resultText  = `${p2Label.toUpperCase()} WON`;
    resultClass = "res-p2";
  }

  const item = document.createElement("div");
  item.className = "history-item";
  item.innerHTML = `
    <span class="history-round">#${round}</span>
    <span class="history-choices">
      <span class="em">${WEAPONS[c1].emoji}</span>
      <span>${p1Label} · ${WEAPONS[c1].label}</span>
      <span style="color:var(--text-dim);">vs</span>
      <span>${WEAPONS[c2].label} · ${p2Label}</span>
      <span class="em">${WEAPONS[c2].emoji}</span>
    </span>
    <span class="history-result ${resultClass}">${resultText}</span>
  `;

  // Prepend so newest is on top
  historyList.prepend(item);
}

/* ── 15. RESET GAME ── */

/**
 * Reset scores, UI, history, and state.
 * @param {boolean} silent - if true, skip the sfx (used internally when switching modes)
 */
function resetGame(silent = false) {
  if (!silent) sfxClick();

  // Reset state
  scores        = { p1: 0, p2: 0, draw: 0 };
  roundNum      = 0;
  p1Choice      = null;
  roundInProgress = false;

  // Reset score display
  scoreP1El.textContent   = "0";
  scoreP2El.textContent   = "0";
  scoreDrawEl.textContent = "0";
  scoreBlockP1.classList.remove("leading");
  scoreBlockP2.classList.remove("leading");

  // Reset arena hands
  handP1.textContent = "❓";
  handP2.textContent = "❓";
  handP1.className   = "arena-hand";
  handP2.className   = "arena-hand";

  // Hide ribbon
  resultRibbon.style.visibility = "hidden";
  resultRibbon.className        = "result-ribbon";
  resultRibbon.textContent      = "";

  // Clear history
  historyList.innerHTML    = "";
  historySection.style.display = "none";

  // Restore P1 buttons if hidden
  restoreP1Buttons();

  // PvP: hide P2 section on reset
  if (mode === "pvp") p2Section.style.display = "none";
}

/* ── 16. INIT ── */

/**
 * Runs once when the page loads.
 * Sets up initial labels and mode-appropriate UI.
 */
function init() {
  updateNames();          // populate labels from inputs
  setMode("pvc");         // start in PvC mode
}

// Kick it off!
init();
