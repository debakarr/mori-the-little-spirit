/** Minimal UI: title/start screen, a fading control hint and an in-world "E" prompt. */
export class ControlsOverlay {
  constructor(root) {
    root.innerHTML = `
      <div class="ls-start" id="ls-start">
        <div class="ls-title">Little Spirit</div>
        <div class="ls-sub">Whispers of the Grove</div>
        <div class="ls-cta loading" id="ls-cta">Gathering the forest…</div>
      </div>
      <div class="ls-hints hidden" id="ls-hints">
        <span class="ls-hint"><span class="ls-key">W</span><span class="ls-key">A</span><span class="ls-key">S</span><span class="ls-key">D</span> move</span>
        <span class="ls-hint"><span class="ls-key">Mouse</span> look</span>
        <span class="ls-hint"><span class="ls-key">Space</span> jump</span>
        <span class="ls-hint"><span class="ls-key">Shift</span> run</span>
        <span class="ls-hint"><span class="ls-key">E</span> interact</span>
        <span class="ls-hint"><span class="ls-key">Q</span> transform</span>
        <span class="ls-hint"><span class="ls-key">M</span> sound</span>
      </div>
      <div class="ls-prompt" id="ls-prompt"><span class="ls-key">E</span><span id="ls-prompt-label"></span></div>`;
    this.start = root.querySelector('#ls-start');
    this.cta = root.querySelector('#ls-cta');
    this.hints = root.querySelector('#ls-hints');
    this.prompt = root.querySelector('#ls-prompt');
    this.promptLabel = root.querySelector('#ls-prompt-label');
    this.hintTimer = 0;
    this.started = false;
  }

  progress(p) {
    this.cta.textContent = `Gathering the forest… ${Math.round(p * 100)}%`;
  }

  ready(onStart) {
    this.cta.classList.remove('loading');
    this.cta.textContent = 'Click to wake Mori';
    this.start.addEventListener('click', () => {
      if (this.started) return;
      this.started = true;
      this.start.classList.add('hidden');
      this.hints.classList.remove('hidden');
      onStart();
    }, { once: true });
  }

  error(msg) {
    this.cta.classList.add('loading');
    this.cta.textContent = msg;
  }

  /** Hide the hints once the player has been exploring for a while. */
  update(dt, moving) {
    if (!this.started) return;
    if (moving) this.hintTimer += dt;
    if (this.hintTimer > 12) this.hints.classList.add('hidden');
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
