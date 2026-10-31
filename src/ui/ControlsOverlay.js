import { DEFAULT_SETTINGS } from '../core/Storage.js';

const FORMS = [['spirit', 'Spirit'], ['fox', 'Fox'], ['bird', 'Bird']];
const QUALITY = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];

/**
 * All the UI: the title menu (New Game / Continue / Settings / Credits), the pause menu, settings and
 * credits panels, and the in-game HUD: form indicators, a fading control hint, a short toast line and
 * the in-world "E" prompt. Menus are plain DOM over the canvas; the game reacts through callbacks.
 */
export class ControlsOverlay {
  constructor(root, { settings = DEFAULT_SETTINGS } = {}) {
    root.innerHTML = `
      <div class="ls-start" id="ls-start">
        <div class="ls-title">Little Spirit</div>
        <div class="ls-sub">Whispers of the Grove</div>
        <div class="ls-cta loading" id="ls-cta">Gathering the forest…</div>
        <nav class="ls-menu hidden" id="ls-title-menu">
          <button data-act="new">New Game</button>
          <button data-act="continue" id="ls-continue">Continue</button>
          <button data-act="settings">Settings</button>
          <button data-act="credits">Credits</button>
        </nav>
      </div>
      <div class="ls-pause hidden" id="ls-pause">
        <div class="ls-panel-title">Resting</div>
        <nav class="ls-menu">
          <button data-act="resume">Resume</button>
          <button data-act="settings">Settings</button>
          <button data-act="credits">Credits</button>
          <button data-act="title">Return to title</button>
        </nav>
      </div>
      <div class="ls-panel hidden" id="ls-settings">
        <div class="ls-panel-title">Settings</div>
        <label>Master volume <input type="range" min="0" max="1" step="0.05" data-key="master"></label>
        <label>Music volume <input type="range" min="0" max="1" step="0.05" data-key="music"></label>
        <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" data-key="sensitivity"></label>
        <label>Graphics quality
          <select data-key="quality">${QUALITY.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </label>
        <nav class="ls-menu"><button data-act="back">Back</button></nav>
      </div>
      <div class="ls-panel hidden" id="ls-credits">
        <div class="ls-panel-title">Credits</div>
        <div class="ls-credits">
          <p><b>Little Spirit: Whispers of the Grove</b><br>made with three.js, Rapier, Vite and Blender</p>
          <p>Forest trees, plants and rocks: <i>Stylized Nature MegaKit</i> by Quaternius (CC0)</p>
          <p>Skeletons and animation clips: Mesh2Motion by Scott Petrovic (CC0)</p>
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
      <div class="ls-hints hidden" id="ls-hints">
        <span class="ls-hint"><span class="ls-key">W</span><span class="ls-key">A</span><span class="ls-key">S</span><span class="ls-key">D</span> move</span>
        <span class="ls-hint"><span class="ls-key">Mouse</span> look</span>
        <span class="ls-hint"><span class="ls-key">Space</span> jump · fly</span>
        <span class="ls-hint"><span class="ls-key">Shift</span> run</span>
        <span class="ls-hint"><span class="ls-key">1</span><span class="ls-key">2</span><span class="ls-key">3</span> transform</span>
        <span class="ls-hint"><span class="ls-key">E</span> interact</span>
        <span class="ls-hint"><span class="ls-key">Esc</span> pause</span>
        <span class="ls-hint"><span class="ls-key">M</span> sound</span>
      </div>
      <div class="ls-prompt" id="ls-prompt"><span class="ls-key">E</span><span id="ls-prompt-label"></span></div>`;
    const $ = (id) => root.querySelector(`#${id}`);
    this.start = $('ls-start');
    this.cta = $('ls-cta');
    this.titleMenu = $('ls-title-menu');
    this.continueBtn = $('ls-continue');
    this.pauseEl = $('ls-pause');
    this.settingsEl = $('ls-settings');
    this.creditsEl = $('ls-credits');
    this.formsEl = $('ls-forms');
    this.toastEl = $('ls-toast');
    this.hints = $('ls-hints');
    this.prompt = $('ls-prompt');
    this.promptLabel = $('ls-prompt-label');
    this.hintTimer = 0;
    this.toastTimer = 0;
    this.started = false;
    this.paused = false;
    this.back = null; // the menu a panel returns to
    this.settings = { ...settings };
    this.onSettings = null;
    this.onResume = null;
    this.onTitle = null;

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
      if (act === 'settings' || act === 'credits') this.openPanel(act === 'settings' ? this.settingsEl : this.creditsEl);
      else if (act === 'back') this.closePanel();
      else if (act === 'resume') this.onResume?.();
      else if (act === 'title') this.onTitle?.();
    });
  }

  progress(p) {
    this.cta.textContent = `Gathering the forest… ${Math.round(p * 100)}%`;
  }

  /** Loading done: show the title menu. onNew / onContinue start the game. */
  ready({ hasSave, onNew, onContinue }) {
    this.cta.classList.add('hidden');
    this.titleMenu.classList.remove('hidden');
    this.continueBtn.style.display = hasSave ? '' : 'none';
    const begin = (fn) => {
      if (this.started) return;
      this.started = true;
      this.start.classList.add('hidden');
      this.hints.classList.remove('hidden');
      this.formsEl.classList.remove('hidden');
      fn();
    };
    this.titleMenu.querySelector('[data-act="new"]').addEventListener('click', () => begin(onNew));
    this.continueBtn.addEventListener('click', () => begin(onContinue));
  }

  error(msg) {
    this.cta.classList.add('loading');
    this.cta.textContent = msg;
  }

  get inMenu() {
    return !this.started || this.paused;
  }

  setPaused(on) {
    this.paused = on;
    this.pauseEl.classList.toggle('hidden', !on);
    if (!on) {
      this.settingsEl.classList.add('hidden');
      this.creditsEl.classList.add('hidden');
    }
  }

  openPanel(panel) {
    this.back = this.started ? this.pauseEl : this.start;
    this.back.classList.add('dimmed');
    panel.classList.remove('hidden');
  }

  closePanel() {
    this.settingsEl.classList.add('hidden');
    this.creditsEl.classList.add('hidden');
    this.back?.classList.remove('dimmed');
  }

  setForm(name) {
    for (const el of this.formsEl.children) el.classList.toggle('active', el.dataset.form === name);
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
