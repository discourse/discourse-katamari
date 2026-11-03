import { circleHitsRect, pageWords } from "./katamari-content.js";

const BASE_RADIUS = 24;
const MAX_RADIUS = 66;
const SPEED = 420;
const MAX_FRAME_SECONDS = 0.1;
const BASE_ATTACHMENTS = 16;
const MAX_ATTACHMENTS = 120;
const ATTACHMENT_ORBITS = [32, 42, 52];
const MAX_EFFECTS = 24;
const MILESTONE = 25;
const TILT_SPEED = 18;
const TILT_DEAD_ZONE = 2;
const EFFECT_LIFETIME = 650;
const SOUND_INTERVAL = 65;
const SOUND_VOLUME = 0.08;
const COLLECTED_HIGHLIGHT = "katamari-collected";
const DIRECTIONS = {
  ArrowLeft: [-1, 0],
  a: [-1, 0],
  ArrowRight: [1, 0],
  d: [1, 0],
  ArrowUp: [0, -1],
  w: [0, -1],
  ArrowDown: [0, 1],
  s: [0, 1],
};

export function requestTiltPermission() {
  const orientation = window.DeviceOrientationEvent;

  if (!window.isSecureContext || !orientation) {
    return Promise.resolve("unavailable");
  }

  try {
    return Promise.resolve(
      orientation.requestPermission?.() || "granted"
    ).catch(() => "denied");
  } catch {
    return Promise.resolve("denied");
  }
}

export default class KatamariRoller {
  #arena;
  #attachments = [];
  #audio;
  #ball;
  #controller = new AbortController();
  #collected = new Highlight();
  #collectedTriggers = new Set();
  #indexed = new Map();
  #count = 0;
  #contentDirty = true;
  #dirty = true;
  #effects = new Set();
  #frame;
  #keys = new Set();
  #lastBump = 0;
  #lastNote = -Infinity;
  #lastTime;
  #obstacles = [];
  #mutations;
  #onScore;
  #paintedRadius;
  #paintedTransform;
  #paused = false;
  #position;
  #radius = BASE_RADIUS;
  #reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  #resize;
  #rotation = 0;
  #target;
  #tiltOrigin;
  #tiltVector = { x: 0, y: 0 };
  #trigger;
  #visibleWords = [];
  #words = [];

  #pointerMove = (event) => {
    if (
      event.pointerType !== "mouse" &&
      !this.#ball.hasPointerCapture(event.pointerId)
    ) {
      return;
    }

    this.#target = { x: event.clientX, y: event.clientY };
  };

  #keyDown = (event) => {
    if (event.target.closest("input, textarea, select, [contenteditable]")) {
      return;
    }

    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !DIRECTIONS[event.key]
    ) {
      return;
    }

    event.preventDefault();
    this.#target = null;
    this.#keys.add(event.key);
  };

  #keyUp = (event) => {
    this.#keys.delete(event.key);
  };

  #orientation = (event) => {
    if (event.beta === null || event.gamma === null || this.#paused) {
      return;
    }

    this.#tiltOrigin ||= { beta: event.beta, gamma: event.gamma };
    const x = event.gamma - this.#tiltOrigin.gamma;
    const y = event.beta - this.#tiltOrigin.beta;
    const angle = ((window.screen.orientation?.angle || 0) * Math.PI) / 180;
    this.#tiltVector = {
      x: x * Math.cos(angle) + y * Math.sin(angle),
      y: y * Math.cos(angle) - x * Math.sin(angle),
    };
  };

  #tick = (time) => {
    const seconds = Math.min(
      (time - (this.#lastTime ?? time)) / 1000,
      MAX_FRAME_SECONDS
    );
    this.#lastTime = time;

    if (!this.#paused) {
      if (this.#dirty) {
        this.#measure();
      }

      this.#move(seconds, time);
      this.#collect(time);
      this.#paint();
    }

    this.#frame = requestAnimationFrame(this.#tick);
  };

  constructor(arena, { trigger, tiltPermission, onScore }) {
    this.#arena = arena;
    this.#ball = arena.querySelector(".katamari__ball");
    this.#trigger = new WeakRef(trigger);
    this.#ball.style.left = "0px";
    this.#ball.style.top = "0px";
    this.#onScore = onScore;

    const rect = trigger.getBoundingClientRect();
    this.#position = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    trigger.classList.add("is-rolling");
    this.#resize = new ResizeObserver(() => (this.#dirty = true));
    CSS.highlights.set(COLLECTED_HIGHLIGHT, this.#collected);
    this.#resize.observe(document.body);
    this.#listen();
    this.#paint();
    this.#ball.focus({ preventScroll: true });
    this.#frame = requestAnimationFrame(this.#tick);
    this.#startAudio();
    this.#startTilt(tiltPermission);
  }

  destroy() {
    if (this.#controller.signal.aborted) {
      return;
    }

    cancelAnimationFrame(this.#frame);
    this.#controller.abort();
    this.#resize.disconnect();
    this.#mutations.disconnect();
    this.#audio?.close().catch(() => {});
    this.#trigger.deref()?.classList.remove("is-rolling");

    for (const trigger of this.#collectedTriggers) {
      trigger.classList.remove("is-collected");
    }

    this.#collectedTriggers.clear();

    CSS.highlights.delete(COLLECTED_HIGHLIGHT);
    this.#indexed.clear();
    this.#collected.clear();
    this.#visibleWords = [];
    this.#words = [];

    for (const effect of this.#effects) {
      effect.remove();
    }

    this.#effects.clear();

    for (const attachment of this.#attachments) {
      attachment?.remove();
    }

    this.#attachments = [];
  }

  #pause(state) {
    this.#paused = state === "paused";
    this.#keys.clear();
    this.#target = null;
    this.#tiltOrigin = null;
    this.#tiltVector = { x: 0, y: 0 };
  }

  async #startAudio() {
    if (!window.AudioContext) {
      return;
    }

    try {
      this.#audio = new window.AudioContext();
      await this.#audio.resume();

      if (!this.#controller.signal.aborted) {
        this.#note(performance.now(), "collect");
      }
    } catch {}
  }

  async #startTilt(permission) {
    const result = await (permission || requestTiltPermission());

    if (result !== "granted" || this.#controller.signal.aborted) {
      return;
    }

    window.addEventListener("deviceorientation", this.#orientation, {
      signal: this.#controller.signal,
    });
  }

  #listen() {
    const signal = this.#controller.signal;
    this.#mutations = new MutationObserver((records) => {
      if (
        records.some(
          ({ target }) => target.isConnected && !this.#arena.contains(target)
        )
      ) {
        this.#contentDirty = true;
        this.#dirty = true;
      }
    });
    this.#mutations.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "aria-hidden",
        "contenteditable",
        "aria-expanded",
        "open",
      ],
    });
    const onLayoutChange = (event) => {
      if (!this.#arena.contains(event.target)) {
        this.#contentDirty = true;
        this.#dirty = true;
      }
    };
    document.addEventListener("animationend", onLayoutChange, {
      signal,
      capture: true,
    });
    document.addEventListener("transitionend", onLayoutChange, {
      signal,
      capture: true,
    });
    document.fonts.addEventListener("loadingdone", () => (this.#dirty = true), {
      signal,
    });
    document.addEventListener("load", () => (this.#dirty = true), {
      signal,
      capture: true,
    });
    window.addEventListener("pointermove", this.#pointerMove, { signal });
    window.addEventListener("keydown", this.#keyDown, { signal });
    window.addEventListener("keyup", this.#keyUp, { signal });
    window.addEventListener("scroll", () => (this.#dirty = true), {
      signal,
      capture: true,
    });
    window.addEventListener(
      "resize",
      () => {
        this.#contentDirty = true;
        this.#dirty = true;
      },
      { signal }
    );
    window.addEventListener("blur", () => this.#pause("paused"), { signal });
    window.addEventListener("focus", () => this.#pause("playing"), { signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        this.#pause(document.hidden ? "paused" : "playing");
      },
      { signal }
    );
    this.#ball.addEventListener(
      "pointerdown",
      (event) => {
        this.#ball.setPointerCapture(event.pointerId);
        this.#ball.focus({ preventScroll: true });
        this.#target = { x: event.clientX, y: event.clientY };
        event.preventDefault();
      },
      { signal }
    );
    this.#ball.addEventListener("pointerup", () => (this.#target = null), {
      signal,
    });
    this.#ball.addEventListener("pointercancel", () => (this.#target = null), {
      signal,
    });
  }

  #measure() {
    if (this.#contentDirty) {
      this.#words = pageWords(document.body, this.#indexed, (word) => {
        this.#collected.delete(word.range);
      });
      this.#contentDirty = false;
    }

    for (const trigger of this.#collectedTriggers) {
      if (!trigger.isConnected) {
        trigger.classList.remove("is-collected");
        this.#collectedTriggers.delete(trigger);
      }
    }

    this.#visibleWords = this.#words
      .filter((word) => !word.collected)
      .map((word) => ({ word, rect: word.range.getBoundingClientRect() }))
      .filter(
        ({ rect }) =>
          rect.width && rect.bottom > 0 && rect.top < window.innerHeight
      );
    this.#obstacles = [
      ...document.querySelectorAll("img:not(.emoji), video, iframe"),
    ]
      .filter(
        (element) =>
          !element.closest(
            ".katamari, .spoiler:not(.spoiled), [hidden], [aria-hidden='true']"
          ) &&
          element.checkVisibility({
            checkVisibilityCSS: true,
            checkOpacity: true,
          })
      )
      .map((element) => element.getBoundingClientRect())
      .filter(
        (rect) =>
          rect.width > BASE_RADIUS &&
          rect.height > BASE_RADIUS &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight
      );
    this.#dirty = false;
  }

  #move(seconds, time) {
    let x = 0;
    let y = 0;

    for (const key of this.#keys) {
      x += DIRECTIONS[key][0];
      y += DIRECTIONS[key][1];
    }

    let speed = SPEED;

    if (!x && !y) {
      x =
        Math.abs(this.#tiltVector.x) > TILT_DEAD_ZONE ? this.#tiltVector.x : 0;
      y =
        Math.abs(this.#tiltVector.y) > TILT_DEAD_ZONE ? this.#tiltVector.y : 0;
      speed = Math.min(SPEED, Math.hypot(x, y) * TILT_SPEED);
    }

    if (!x && !y && this.#target) {
      x = this.#target.x - this.#position.x;
      y = this.#target.y - this.#position.y;
      speed = Math.min(SPEED, Math.hypot(x, y) / Math.max(seconds, 0.001));
    }

    const length = Math.hypot(x, y) || 1;
    const previous = { ...this.#position };
    const radius = this.#radius;
    const next = {
      x: Math.max(
        radius,
        Math.min(
          window.innerWidth - radius,
          previous.x + (x / length) * speed * seconds
        )
      ),
      y: Math.max(
        radius,
        Math.min(
          window.innerHeight - radius,
          previous.y + (y / length) * speed * seconds
        )
      ),
    };

    for (const rect of this.#obstacles) {
      if (
        !circleHitsRect({ ...next, radius }, rect) ||
        circleHitsRect({ ...previous, radius }, rect)
      ) {
        continue;
      }

      next.x = previous.x;
      next.y = previous.y;
      this.#target = null;

      if (time - this.#lastBump > EFFECT_LIFETIME) {
        this.#effect("✦", "bump");
        this.#note(time, "bump");
        this.#lastBump = time;
      }

      break;
    }

    this.#position = next;
    this.#rotation +=
      ((Math.hypot(next.x - previous.x, next.y - previous.y) / radius) * 180) /
      Math.PI;
  }

  #collect(time) {
    const attachments = [];

    for (const { word, rect } of this.#visibleWords) {
      if (!circleHitsRect({ ...this.#position, radius: this.#radius }, rect)) {
        continue;
      }

      word.collected = true;
      this.#collected.add(word.range);
      const trigger =
        word.range.startContainer.parentElement.closest(".katamari__trigger");

      if (trigger) {
        trigger.classList.add("is-collected");
        this.#collectedTriggers.add(trigger);
      }

      this.#count++;
      this.#radius = Math.min(
        MAX_RADIUS,
        BASE_RADIUS + Math.sqrt(this.#count) * 2
      );
      attachments.push({ text: word.text, number: this.#count });
      const kind = this.#count % MILESTONE === 0 ? "milestone" : "collect";
      this.#effect(kind === "milestone" ? `+${MILESTONE} ✦` : "+1", kind);
      this.#note(time, kind);
    }

    if (!attachments.length) {
      return;
    }

    this.#visibleWords = this.#visibleWords.filter(
      ({ word }) => !word.collected
    );
    this.#attach(attachments);
    this.#onScore(this.#count);
  }

  #attach(words) {
    const capacity = Math.min(
      MAX_ATTACHMENTS,
      Math.ceil(BASE_ATTACHMENTS * (this.#radius / BASE_RADIUS) ** 2)
    );

    for (const { text, number } of words.slice(-capacity)) {
      const slot = number % capacity;
      let attachment = this.#attachments[slot];

      if (!attachment) {
        attachment = document.createElement("span");
        attachment.className = "katamari__attachment";
        this.#attachments[slot] = attachment;
        this.#ball.append(attachment);
      }

      if (attachment.textContent !== text) {
        attachment.textContent = text;
      }

      const angle = number * 2.4;
      const orbit = ATTACHMENT_ORBITS[slot % ATTACHMENT_ORBITS.length];
      attachment.style.left = `${50 + Math.cos(angle) * orbit}%`;
      attachment.style.top = `${50 + Math.sin(angle) * orbit}%`;
      attachment.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    }
  }

  #effect(text, kind) {
    if (this.#reducedMotion || this.#effects.size >= MAX_EFFECTS) {
      return;
    }

    const effect = document.createElement("span");
    effect.className = `katamari__effect --${kind}`;
    effect.setAttribute("aria-hidden", "true");
    effect.textContent = text;
    effect.style.left = `${this.#position.x}px`;
    effect.style.top = `${this.#position.y - this.#radius}px`;
    this.#arena.append(effect);
    this.#effects.add(effect);
    effect.addEventListener(
      "animationend",
      () => {
        this.#effects.delete(effect);
        effect.remove();
      },
      { once: true }
    );
  }

  #note(time, kind) {
    if (
      this.#audio?.state !== "running" ||
      time - this.#lastNote < SOUND_INTERVAL
    ) {
      return;
    }

    this.#lastNote = time;
    const now = this.#audio.currentTime;
    const oscillator = this.#audio.createOscillator();
    const gain = this.#audio.createGain();
    oscillator.type = kind === "bump" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(
      kind === "bump" ? 100 : 440 * 2 ** ((this.#count % 12) / 12),
      now
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === "bump" ? 45 : 880,
      now + 0.1
    );
    gain.gain.setValueAtTime(SOUND_VOLUME, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    oscillator.connect(gain).connect(this.#audio.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + 0.16);
  }

  #paint() {
    if (this.#paintedRadius !== this.#radius) {
      this.#ball.style.width = `${this.#radius * 2}px`;
      this.#ball.style.height = `${this.#radius * 2}px`;
      this.#paintedRadius = this.#radius;
    }

    const rotation = this.#reducedMotion ? 0 : this.#rotation;
    const transform = `translate3d(${this.#position.x}px, ${this.#position.y}px, 0) translate(-50%, -50%) rotate(${rotation}deg)`;

    if (transform !== this.#paintedTransform) {
      this.#ball.style.transform = transform;
      this.#paintedTransform = transform;
    }
  }
}
