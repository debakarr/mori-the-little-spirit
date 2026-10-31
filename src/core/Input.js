/** Keyboard + mouse state. Pointer lock for mouse-look, with click-drag as a fallback. */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.jumpQueued = false;
    this.interactQueued = false;
    this.dragging = false;
    this.listeners = {};
    this.enabled = true; // off on the title and in menus: keys then steer the menu, not Mori

    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code === 'KeyE') this.interactQueued = true;
      this.listeners[e.code]?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', () => {
      this.dragging = true;
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
    });
    addEventListener('mouseup', () => (this.dragging = false));
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || this.dragging) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
  }

  on(code, fn) {
    this.listeners[code] = fn;
  }

  has(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  get move() {
    if (!this.enabled) return { x: 0, y: 0 };
    return {
      x: (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0),
      y: (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0),
    };
  }

  get run() {
    return this.enabled && this.has('ShiftLeft', 'ShiftRight');
  }

  get jumpHeld() {
    return this.enabled && this.keys.has('Space');
  }

  consumeJump() {
    const j = this.jumpQueued && this.enabled;
    this.jumpQueued = false;
    return j;
  }

  consumeInteract() {
    const j = this.interactQueued && this.enabled;
    this.interactQueued = false;
    return j;
  }

  consumeLook() {
    const l = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return l;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
