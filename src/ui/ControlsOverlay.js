import { DEFAULT_SETTINGS } from '../core/Storage.js';
import { EntryScreen } from './EntryScreen.js';

const FORMS = [['spirit', 'Spirit'], ['fox', 'Fox'], ['bird', 'Bird']];
const QUALITY = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];

/**
 * All the UI: the entry screen (EntryScreen.js), the pause menu, the settings, controls and credits
 * panels (shared by the title and the pause menu), and the in-game HUD: form indicators, a fading control hint, a short toast line and
 * the in-world "E" prompt. Menus are plain DOM over the canvas; the game reacts through callbacks.
 */
export class ControlsOverlay {
  constructor(root, { settings = DEFAULT_SETTINGS, sound = null } = {}) {
    root.innerHTML = `
      <div class="ls-pause hidden" id="ls-pause">
        <div class="ls-panel-title">Resting</div>
        <nav class="ls-menu">
          <button data-act="resume">Resume</button>
          <button data-act="settings">Settings</button>
          <button data-act="credits">Credits</button>
          <button data-act="title">Return to title</button>
        </nav>
      </div>
      <div class="ls-panel hidden" id="ls-settings" role="dialog" aria-label="Settings">
        <div class="ls-panel-title">Settings</div>
        <label>Master volume <input type="range" min="0" max="1" step="0.05" data-key="master"></label>
        <label>Music volume <input type="range" min="0" max="1" step="0.05" data-key="music"></label>
        <label>Sound effects volume <input type="range" min="0" max="1" step="0.05" data-key="sfx"></label>
        <label>Camera sensitivity <input type="range" min="0.3" max="2.5" step="0.05" data-key="sensitivity"></label>
        <label>Graphics quality
          <select data-key="quality">${QUALITY.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </label>
        <div class="ls-row">
          <button class="ls-chip" data-act="fullscreen" id="ls-fullscreen" aria-pressed="false">Fullscreen</button>
          <button class="ls-chip" data-act="controls">Controls</button>
        </div>
        <nav class="ls-menu"><button data-act="back">Back</button></nav>
      </div>
      <div class="ls-panel hidden" id="ls-controls" role="dialog" aria-label="Controls">
        <div class="ls-panel-title">Controls</div>
        <dl class="ls-keys">
          <dt><span class="ls-key">W</span><span class="ls-key">A</span><span class="ls-key">S</span><span class="ls-key">D</span> / arrows</dt><dd>Move</dd>
          <dt><span class="ls-key">Mouse</span></dt><dd>Camera (click to capture)</dd>
          <dt><span class="ls-key">Space</span></dt><dd>Jump · as the bird: take off and climb</dd>
          <dt><span class="ls-key">Shift</span></dt><dd>Run · fly faster</dd>
          <dt><span class="ls-key">C</span></dt><dd>Dive (bird)</dd>
          <dt><span class="ls-key">1</span><span class="ls-key">2</span><span class="ls-key">3</span></dt><dd>Spirit · Fox · Bird</dd>
          <dt><span class="ls-key">E</span></dt><dd>Interact, sit, greet, wake a shrine</dd>
          <dt><span class="ls-key">F</span></dt><dd>Sniff out a wisp (fox)</dd>
          <dt><span class="ls-key">Esc</span></dt><dd>Pause</dd>
          <dt><span class="ls-key">M</span></dt><dd>Sound on / off</dd>
        </dl>
        <nav class="ls-menu"><button data-act="back-settings">Back</button></nav>
      </div>
      <div class="ls-panel hidden" id="ls-credits">
        <div class="ls-panel-title">Credits</div>
        <div class="ls-credits">
          <p><b>Little Spirit: Whispers of the Grove</b><br>made with three.js, Rapier, Vite and Blender</p>
          <p>Forest trees, plants and rocks: <i>Stylized Nature MegaKit</i> by Quaternius (CC0)</p>
          <p>Skeletons and animation clips: Mesh2Motion by Scott Petrovic (CC0)</p>
          <p>Deer and stag: <i>Ultimate Animated Animal Pack</i> by Quaternius (CC0)</p>
          <p>Music: <i>Forest Ambience</i> by TinyWorlds · Birds and wind: Spring Spring ·
            Stream: RandomMind (all CC0, OpenGameArt)</p>
          <p>Mori, the grove and its props were modelled for this game.</p>
        </div>
        <nav class="ls-menu"><button data-act="back">Back</button></nav>
      </div>
      <div class="ls-forms hidden" id="ls-forms">
        ${FORMS.map(([k, l], i) => `<div class="ls-form" data-form="${k}"><span class="ls-key">${i + 1}</span>${l}</div>`).join('')}
      </div>
      <div class="ls-toast" id="ls-toast"></div>
      <div class="ls-progress hidden" id="ls-progress"></div>
      <div class="ls-area" id="ls-area"></div>
      <div class="ls-hints hidden" id="ls-hints">
        <span class="ls-hint"><span class="ls-key">W</span><span class="ls-key">A</span><span class="ls-key">S</span><span class="ls-key">D</span> move</span>
        <span class="ls-hint"><span class="ls-key">Mouse</span> look</span>
        <span class="ls-hint"><span class="ls-key">Space</span> jump · fly</span>
        <span class="ls-hint"><span class="ls-key">Shift</span> run</span>
        <span class="ls-hint"><span class="ls-key">1</span><span class="ls-key">2</span><span class="ls-key">3</span> transform</span>
        <span class="ls-hint"><span class="ls-key">E</span> interact</span>
        <span class="ls-hint"><span class="ls-key">F</span> sniff (fox)</span>
        <span class="ls-hint"><span class="ls-key">Esc</span> pause</span>
        <span class="ls-hint"><span class="ls-key">M</span> sound</span>
      </div>
      <div class="ls-prompt" id="ls-prompt"><span class="ls-key">E</span><span id="ls-prompt-label"></span></div>`;
    this.root = root;
    const $ = (id) => root.querySelector(`#${id}`);
    this.pauseEl = $('ls-pause');
    this.settingsEl = $('ls-settings');
    this.creditsEl = $('ls-credits');
    this.controlsEl = $('ls-controls');
    this.fullscreenBtn = $('ls-fullscreen');
    this.formsEl = $('ls-forms');
    this.toastEl = $('ls-toast');
    this.progressEl = $('ls-progress');
    this.areaEl = $('ls-area');
    this.areaTimer = 0;
    this.hints = $('ls-hints');
    this.prompt = $('ls-prompt');
    this.promptLabel = $('ls-prompt-label');
    this.hintTimer = 0;
    this.toastTimer = 0;
    this.started = false;
    this.paused = false;
    this.panel = null; // the open panel, if any
    this.settings = { ...settings };
    this.onSettings = null;
    this.onResume = null;
    this.onTitle = null;
    this.sound = sound;
    this.entry = new EntryScreen(root, { sound, onPanel: (name) => this.openPanel(name === 'settings' ? this.settingsEl : this.creditsEl) });

    for (const input of this.settingsEl.querySelectorAll('[data-key]')) {
      input.value = this.settings[input.dataset.key];
      input.addEventListener('input', () => {
        const k = input.dataset.key;
        this.settings[k] = input.type === 'range' ? Number(input.value) : input.value;
        this.onSettings?.({ ...this.settings });
      });
    }
    root.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      if ((act === 'settings' || act === 'credits') && this.started) this.openPanel(act === 'settings' ? this.settingsEl : this.creditsEl);
      else if (act === 'back') this.closePanel();
      else if (act === 'controls') this.openPanel(this.controlsEl);
      else if (act === 'back-settings') this.openPanel(this.settingsEl);
      else if (act === 'fullscreen') this.toggleFullscreen();
      else if (act === 'resume') this.onResume?.();
      else if (act === 'title') this.onTitle?.();
      if (['back', 'controls', 'back-settings', 'fullscreen', 'resume', 'title'].includes(act)) this.sound?.select();
    });
    root.addEventListener('pointerover', (e) => {
      const b = e.target.closest('.ls-panel button, .ls-pause button');
      if (b && b !== this._hovered) { this._hovered = b; this.sound?.hover(); }
    });
    document.addEventListener('fullscreenchange', () => this.fullscreenBtn.setAttribute('aria-pressed', String(!!document.fullscreenElement)));
    // Esc inside a panel goes back (and must not reach the game, where it would toggle the pause)
    addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.panel) return;
      e.stopImmediatePropagation();
      if (this.panel === this.controlsEl) this.openPanel(this.settingsEl);
      else this.closePanel();
    }, true);
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  progress(p) {
    this.entry.progress(p);
  }

  /** Loading done: the title comes in. onNew / onContinue start the game; saveInfo shows under Continue. */
  ready({ hasSave, saveInfo = '', onNew, onContinue }) {
    const enter = (fn) => () => {
      this.started = true;
      setTimeout(() => {
        this.entry.hide();
        this.hints.classList.remove('hidden');
        this.formsEl.classList.remove('hidden');
        this.progressEl.classList.remove('hidden');
      }, 1100);
      fn();
    };
    this.entry.ready({ hasSave, saveInfo, onNew: enter(onNew), onContinue: enter(onContinue) });
  }

  error(msg) {
    this.entry.error(msg);
  }

  get inMenu() {
    return !this.started || this.paused || !!this.panel;
  }

  setPaused(on) {
    this.paused = on;
    this.pauseEl.classList.toggle('hidden', !on);
    if (!on) this.closePanel();
    else this.pauseEl.querySelector('button')?.focus({ preventScroll: true });
  }

  openPanel(panel) {
    for (const p of [this.settingsEl, this.creditsEl, this.controlsEl]) p.classList.toggle('hidden', p !== panel);
    if (this.started) this.pauseEl.classList.add('dimmed');
    else this.entry.dim(true);
    this.panel = panel;
    panel.querySelector('input, select, button')?.focus({ preventScroll: true });
  }

  closePanel() {
    for (const p of [this.settingsEl, this.creditsEl, this.controlsEl]) p.classList.add('hidden');
    if (!this.panel) return;
    this.panel = null;
    if (this.started) {
      this.pauseEl.classList.remove('dimmed');
      this.pauseEl.querySelector('button')?.focus({ preventScroll: true });
    } else {
      this.entry.dim(false);
    }
  }

  setForm(name) {
    for (const el of this.formsEl.children) el.classList.toggle('active', el.dataset.form === name);
  }

  /** Wisps gathered and shrines woken, top left. */
  setProgress({ wisps, total, shrines, shrineTotal }) {
    this.progressEl.innerHTML = `<span title="Wisps">✦ ${wisps} / ${total}</span><span title="Shrines awake">◈ ${shrines} / ${shrineTotal}</span>`;
  }

  /** A place's name (or a moment) drifting in across the middle of the screen. */
  areaTitle(text, seconds = 3.6) {
    this.areaEl.textContent = text;
    this.areaEl.classList.add('visible');
    this.areaTimer = seconds;
  }

  /** A short line under the form indicators (e.g. flight controls when becoming the bird). */
  toast(text, seconds = 4) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    this.toastTimer = seconds;
  }

  /** Hide the hints once the player has been exploring for a while. */
  update(dt, moving) {
    if (!this.started) return;
    if (moving) this.hintTimer += dt;
    if (this.hintTimer > 12) this.hints.classList.add('hidden');
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.classList.remove('visible');
    if (this.areaTimer > 0 && (this.areaTimer -= dt) <= 0) this.areaEl.classList.remove('visible');
  }

  toggleHints() {
    this.hintTimer = 0;
    this.hints.classList.toggle('hidden');
  }

  showPrompt(screen, label) {
    if (!screen) {
      this.prompt.classList.remove('visible');
      return;
    }
    this.promptLabel.textContent = label;
    this.prompt.style.left = `${screen.x}px`;
    this.prompt.style.top = `${screen.y}px`;
    this.prompt.classList.add('visible');
  }
}
