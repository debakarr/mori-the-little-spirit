// the title's letters, each fading in a beat after the last (style.css .ls-title span)
const TITLE = [...'Little Spirit'].map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('');

/**
 * The way into the game: a short loading screen (a glowing spirit, "Finding the way to the Grove…", an
 * indeterminate shimmer, no fake percentages), then the title over the live grove with a small menu on
 * the left: New Journey, Continue (only with a valid save, plus a line about it), Settings, Credits.
 * Mouse and keyboard both work (arrows / W S move the focus, Enter or Space chooses); every item has a
 * visible focus state; hover and choice make a soft sound once audio is allowed (after the first gesture).
 * A small sound toggle sits in the corner. The game supplies the actions through ready() and the hooks.
 */
export class EntryScreen {
  constructor(root, { onPanel, sound = null }) {
    this.sound = sound; // { start(), hover(), select(), toggleMute() -> muted }
    root.insertAdjacentHTML('afterbegin', `
      <div class="ls-loading" id="ls-loading" role="status" aria-live="polite">
        <div class="ls-loading-spirit" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="ls-loading-text" id="ls-loading-text">Finding the way to the Grove…</div>
        <div class="ls-shimmer" aria-hidden="true"></div>
      </div>
      <div class="ls-start" id="ls-start">
        <div class="ls-hero">
          <div class="ls-emblem" aria-hidden="true"><i></i><i></i><i></i></div>
          <h1 class="ls-title" aria-label="Little Spirit">${TITLE}</h1>
          <div class="ls-divider" aria-hidden="true"></div>
          <div class="ls-sub">Whispers of the Grove</div>
          <p class="ls-tagline">A tiny spirit. A magical world. Endless possibilities.</p>
          <nav class="ls-menu ls-title-menu" id="ls-title-menu" aria-label="Main menu">
            <button data-act="new">New Journey</button>
            <button data-act="continue" id="ls-continue">Continue<small id="ls-continue-info"></small></button>
            <button data-act="settings">Settings</button>
            <button data-act="credits">Credits</button>
          </nav>
        </div>
        <div class="ls-footer">Arrow keys and Enter, or the mouse · headphones recommended</div>
        <button class="ls-sound" id="ls-sound" aria-label="Sound on" title="Sound (M)"><span></span></button>
      </div>`);
    const $ = (id) => root.querySelector(`#${id}`);
    this.loading = $('ls-loading');
    this.el = $('ls-start');
    this.menu = $('ls-title-menu');
    this.continueBtn = $('ls-continue');
    this.soundBtn = $('ls-sound');
    this.started = false;
    this.onPanel = onPanel;

    // the first gesture anywhere on the title may start audio (browsers block it before that)
    const wake = () => this.sound?.start();
    this.el.addEventListener('pointerdown', wake, { once: true });
    addEventListener('keydown', wake, { once: true });

    this.menu.addEventListener('pointerover', (e) => {
      const b = e.target.closest('button');
      if (b && b !== this._hovered) { this._hovered = b; this.sound?.hover(); b.focus({ preventScroll: true }); }
    });
    this.menu.addEventListener('pointerleave', () => { this._hovered = null; });
    this.menu.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'settings' || act === 'credits') { this.sound?.select(); this.onPanel(act); }
    });
    // keyboard: move the focus through the visible items, wrapping around
    this.el.addEventListener('keydown', (e) => {
      if (this.el.classList.contains('dimmed')) return;
      const items = [...this.menu.querySelectorAll('button')].filter((b) => b.offsetParent);
      const i = items.indexOf(document.activeElement);
      const step = ['ArrowDown', 'KeyS'].includes(e.code) ? 1 : ['ArrowUp', 'KeyW'].includes(e.code) ? -1 : 0;
      if (step) {
        e.preventDefault();
        items[(i + step + items.length) % items.length]?.focus();
        this.sound?.hover();
      }
    });
    this.soundBtn.addEventListener('click', () => {
      this.sound?.start();
      this.setMuted(this.sound?.toggleMute());
    });
  }

  setMuted(muted) {
    this.soundBtn.classList.toggle('muted', !!muted);
    this.soundBtn.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
  }

  /** Loading is under way: the shimmer runs on its own; no numbers are shown. */
  progress() {}

  /** Loading failed: say so plainly instead of hanging on the spinner. */
  error(msg) {
    this.loading.classList.add('failed');
    this.loading.querySelector('#ls-loading-text').textContent = msg;
  }

  /** Assets are in: fade the loading screen out over the grove and bring the title in. */
  ready({ hasSave, saveInfo = '', onNew, onContinue }) {
    this.continueBtn.style.display = hasSave ? '' : 'none';
    this.el.querySelector('#ls-continue-info').textContent = saveInfo;
    this.loading.classList.add('done');
    this.el.classList.add('shown');
    setTimeout(() => this.loading.remove(), 1400);
    setTimeout(() => { if (!this.started) this.menu.querySelector('button')?.focus({ preventScroll: true }); }, 1900);
    const begin = (fn) => {
      if (this.started) return;
      this.started = true;
      this.sound?.start();
      this.sound?.select();
      this.el.classList.add('leaving');
      fn();
    };
    this.menu.querySelector('[data-act="new"]').addEventListener('click', () => begin(onNew));
    this.continueBtn.addEventListener('click', () => begin(onContinue));
  }

  /** The journey has begun: the title is gone for good. */
  hide() {
    this.el.classList.add('hidden');
  }

  dim(on) {
    this.el.classList.toggle('dimmed', on);
    if (!on) this.menu.querySelector('button')?.focus({ preventScroll: true });
  }
}
