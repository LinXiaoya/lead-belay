const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

const overlay = document.getElementById("overlay");
const overlayKicker = document.getElementById("overlay-kicker");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const overlayWarning = document.getElementById("overlay-warning");
const overlayDetails = document.getElementById("overlay-details");
const startButton = document.getElementById("start-button");
const restartButton = document.getElementById("restart-button");
const actionButton = document.getElementById("action-button");
const actionVisual = document.getElementById("action-visual");
const joystickZone = document.getElementById("joystick-zone");
const joystickHitLayer = document.getElementById("joystick-hit-layer");
const joystickKnob = document.getElementById("joystick-knob");
const appShell = document.querySelector(".app-shell");

const metricClip = document.getElementById("metric-clip");
const metricPhase = document.getElementById("metric-phase");
const metricSlack = document.getElementById("metric-slack");
const metricForce = document.getElementById("metric-force");
const meterCaption = document.getElementById("meter-caption");
const meterZone = document.getElementById("meter-zone");
const meterPointer = document.getElementById("meter-pointer");
const adviceText = document.getElementById("advice-text");
const eventLog = document.getElementById("event-log");

const labelMoveToward = document.getElementById("label-move-toward");
const labelMoveAway = document.getElementById("label-move-away");
const hintMoveToward = document.getElementById("hint-move-toward");
const hintMoveAway = document.getElementById("hint-move-away");

const CONFIG = {
  world: {
    width: 6.8,
    height: 19.2,
    wallX: 1.1,
    groundY: 0,
    topY: 18.4,
    belayerMinX: 1.0,
    belayerMaxX: 5.7,
  },
  climber: {
    mass: 72,
    radius: 0.21,
    climbSpeed: 0.66,
    clipTime: 1.25,
    clipDrawLength: 1,
    topoutBuffer: 0.5,
  },
  belayer: {
    speed: 1.45,
    ropeOutSpeed: 1.35,
    ropeInSpeed: 1.28,
    mass: 68,
    baseY: 0.16,
    ropePointOffsetY: 0.98,
    jumpTowardWallSpeed: 0.95,
    jumpUpSpeed: 2.15,
  },
  fall: {
    gravity: 9.4,
    ropeBaseK: 22000,
    ropeMinK: 900,
    dampingRatio: 0.54,
    jumpWindow: 0.34,
    spotWindow: 1,
    settleTime: 1.95,
    hardCatchLimit: 4.0,
    passiveSlideBase: 0.14,
    passiveSlideScale: 0.18,
  },
  hazard: {
    preclipChance: 0.28,
    preclipMin: 2.1,
    preclipMax: 3.8,
    leadMin: 12.3,
    leadMax: 20.4,
    waitingPenalty: 0.3,
  },
};

const QUICKDRAWS = [
  { x: 1.92, y: 1.8 },
  { x: 2.12, y: 3.5 },
  { x: 1.82, y: 5.3 },
  { x: 2.24, y: 7.2 },
  { x: 1.76, y: 9.2 },
  { x: 2.3, y: 11.2 },
  { x: 1.88, y: 13.2 },
  { x: 2.24, y: 15.1 },
  { x: 1.82, y: 16.8 },
  { x: 2.18, y: 17.9 },
];

const keyInput = {
  moveToward: false,
  moveAway: false,
  ropeOut: false,
  ropeIn: false,
};

const touchInput = {
  moveToward: false,
  moveAway: false,
  ropeOut: false,
  ropeIn: false,
};

const apiInput = {
  moveToward: false,
  moveAway: false,
  ropeOut: false,
  ropeIn: false,
};

function isInputActive(key) {
  return keyInput[key] || touchInput[key] || apiInput[key];
}

function clearInputState(target) {
  Object.keys(target).forEach((key) => {
    target[key] = false;
  });
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  if (!seed) {
    return Math.random;
  }

  let state = hashSeed(seed) || 0x6d2b79f5;

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function cubicPoint(start, control1, control2, end, t) {
  const u = 1 - t;
  return {
    x:
      u * u * u * start.x +
      3 * u * u * t * control1.x +
      3 * u * t * t * control2.x +
      t * t * t * end.x,
    y:
      u * u * u * start.y +
      3 * u * u * t * control1.y +
      3 * u * t * t * control2.y +
      t * t * t * end.y,
  };
}

function cubicLength(start, control1, control2, end, steps = 18) {
  let total = 0;
  let previous = start;

  for (let index = 1; index <= steps; index += 1) {
    const point = cubicPoint(start, control1, control2, end, index / steps);
    total += distance(previous, point);
    previous = point;
  }

  return total;
}

function sampleCubicPoints(start, control1, control2, end, steps = 14) {
  const points = [start];

  for (let index = 1; index < steps; index += 1) {
    points.push(cubicPoint(start, control1, control2, end, index / steps));
  }

  points.push(end);
  return points;
}

function polylineLength(points) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }

  return total;
}

class LeadBelayGame {
  constructor() {
    this.width = 1;
    this.height = 1;
    this.lastFrame = 0;
    this.raf = 0;
    this.searchParams = new URLSearchParams(window.location.search);
    this.rng = createRng(this.searchParams.get("seed"));
    this.ropeButtons = [];
    this.joystick = {
      active: false,
      pointerId: null,
      radius: 0,
      x: 0,
      y: 0,
    };
    this.reset();
    this.bind();
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = window.requestAnimationFrame(this.loop);

    if (this.searchParams.get("autostart") === "1") {
      window.setTimeout(() => this.start(), 0);
    }
  }

  bind() {
    window.addEventListener("resize", () => this.resize());
    let lastTouchEnd = 0;

    const clearActiveSelection = () => {
      const selection = window.getSelection?.();
      if (selection && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    };

    const shieldTouchNativeBehavior = (element) => {
      if (!element) {
        return;
      }

      ["touchstart", "touchmove", "touchend", "touchcancel"].forEach((eventName) => {
        element.addEventListener(
          eventName,
          (event) => {
            clearActiveSelection();
            event.preventDefault();
          },
          { passive: false },
        );
      });
    };

    const blockLongPressBehavior = (event) => {
      if (appShell && event.target instanceof Node && appShell.contains(event.target)) {
        clearActiveSelection();
        event.preventDefault();
      }
    };

    document.addEventListener("contextmenu", blockLongPressBehavior);
    document.addEventListener("selectstart", blockLongPressBehavior);
    document.addEventListener("dragstart", blockLongPressBehavior);
    document.addEventListener("dblclick", blockLongPressBehavior);

    ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
      document.addEventListener(eventName, blockLongPressBehavior, { passive: false });
    });

    document.addEventListener(
      "touchmove",
      (event) => {
        if (
          event.touches.length > 1 &&
          appShell &&
          event.target instanceof Node &&
          appShell.contains(event.target)
        ) {
          event.preventDefault();
        }
      },
      { passive: false },
    );

    document.addEventListener(
      "touchstart",
      (event) => {
        if (appShell && event.target instanceof Node && appShell.contains(event.target)) {
          clearActiveSelection();
        }
      },
      { passive: true },
    );

    document.addEventListener(
      "touchend",
      (event) => {
        if (
          !appShell ||
          !(event.target instanceof Node) ||
          !appShell.contains(event.target) ||
          event.changedTouches.length !== 1
        ) {
          return;
        }

        const now = performance.now();
        if (now - lastTouchEnd < 320) {
          event.preventDefault();
        }
        lastTouchEnd = now;
      },
      { passive: false },
    );

    document.addEventListener("selectionchange", () => {
      const selection = window.getSelection?.();
      if (
        selection &&
        selection.rangeCount > 0 &&
        appShell &&
        selection.anchorNode instanceof Node &&
        appShell.contains(selection.anchorNode)
      ) {
        clearActiveSelection();
      }
    });

    shieldTouchNativeBehavior(joystickHitLayer);
    shieldTouchNativeBehavior(actionButton);
    shieldTouchNativeBehavior(canvas);

    startButton.addEventListener("click", () => this.start());
    restartButton.addEventListener("click", () => this.reset());

    actionButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      actionVisual?.parentElement?.classList.add("active");
      this.handleAction();
    });

    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      actionButton.addEventListener(eventName, () => actionVisual?.parentElement?.classList.remove("active"));
    });

    if (joystickHitLayer) {
      joystickHitLayer.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const rect = joystickHitLayer.getBoundingClientRect();
        this.joystick.active = true;
        this.joystick.pointerId = event.pointerId;
        this.joystick.radius = Math.min(rect.width, rect.height) * 0.28;
        joystickHitLayer.setPointerCapture(event.pointerId);
        joystickHitLayer.parentElement?.classList.add("active");
        this.updateJoystick(event.clientX, event.clientY);
      });

      joystickHitLayer.addEventListener("pointermove", (event) => {
        if (!this.joystick.active || event.pointerId !== this.joystick.pointerId) {
          return;
        }

        this.updateJoystick(event.clientX, event.clientY);
      });

      const releaseJoystick = (event) => {
        if (!this.joystick.active || event.pointerId !== this.joystick.pointerId) {
          return;
        }

        this.resetJoystick();
      };

      ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
        joystickHitLayer.addEventListener(eventName, releaseJoystick);
      });
    }

    window.addEventListener("keydown", (event) => {
      if (event.repeat) {
        return;
      }

      if (["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code)) {
        event.preventDefault();
      }

      if (event.code === "Space") {
        this.handleAction();
        return;
      }

      switch (event.key.toLowerCase()) {
        case "a":
        case "arrowleft":
          keyInput.moveToward = true;
          break;
        case "d":
        case "arrowright":
          keyInput.moveAway = true;
          break;
        case "w":
        case "arrowup":
          keyInput.ropeOut = true;
          break;
        case "s":
        case "arrowdown":
          keyInput.ropeIn = true;
          break;
        default:
          break;
      }
    });

    window.addEventListener("keyup", (event) => {
      switch (event.key.toLowerCase()) {
        case "a":
        case "arrowleft":
          keyInput.moveToward = false;
          break;
        case "d":
        case "arrowright":
          keyInput.moveAway = false;
          break;
        case "w":
        case "arrowup":
          keyInput.ropeOut = false;
          break;
        case "s":
        case "arrowdown":
          keyInput.ropeIn = false;
          break;
        default:
          break;
      }
    });
  }

  updateJoystick(clientX, clientY) {
    if (!joystickHitLayer || !joystickKnob) {
      return;
    }

    const rect = joystickHitLayer.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    const rawX = clientX - centerX;
    const rawY = clientY - centerY;
    const radius = this.joystick.radius || Math.min(rect.width, rect.height) * 0.28;
    const length = Math.hypot(rawX, rawY);
    const scale = length > radius ? radius / length : 1;
    const x = rawX * scale;
    const y = rawY * scale;

    this.joystick.x = x;
    this.joystick.y = y;
    joystickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;

    const deadZone = radius * 0.26;
    touchInput.moveToward = x < -deadZone;
    touchInput.moveAway = x > deadZone;
    touchInput.ropeOut = y < -deadZone;
    touchInput.ropeIn = y > deadZone;
  }

  resetJoystick() {
    this.joystick.active = false;
    this.joystick.pointerId = null;
    this.joystick.x = 0;
    this.joystick.y = 0;
    clearInputState(touchInput);
    joystickHitLayer?.parentElement?.classList.remove("active");

    if (joystickKnob) {
      joystickKnob.style.transform = "translate(-50%, -50%)";
    }
  }

  start() {
    if (this.stage === "playing") {
      return;
    }

    this.reset();
    this.stage = "playing";
    this.showOverlay(false);
    this.pushEvent("开始攀登：先跟住攀爬者，完成首挂前的抱石保护。");
  }

  reset() {
    this.stage = "ready";
    this.phase = "preclip";
    this.subphase = "climbing";
    this.clippedCount = 0;
    this.elapsed = 0;
    this.clipProgress = 0;
    this.autoFirstClip = 0;
    this.manualRope = 0;
    this.climberClipSlack = 0;
    this.preclipSpotAvailable = this.random(0, 1) < CONFIG.hazard.preclipChance;
    this.preclipSpotSpent = false;
    this.hazardTimer = this.preclipSpotAvailable
      ? this.random(CONFIG.hazard.preclipMin, CONFIG.hazard.preclipMax)
      : Number.POSITIVE_INFINITY;
    this.belayer = {
      x: 3.2,
      y: CONFIG.belayer.baseY,
      vx: 0,
      vy: 0,
      visualLift: 0,
    };
    this.climber = {
      x: this.routeX(0.52),
      y: 0.52,
      vx: 0,
      vy: 0,
      radius: CONFIG.climber.radius,
    };
    this.fall = null;
    this.result = null;
    this.advice = "点击开始后，先移动到攀爬者正下方。";
    this.lastProtection = { force: 0, factor: 0, swing: 0 };
    this.performance = {
      catches: 0,
      spotSaves: 0,
      perfectJumps: 0,
      maxForce: 0,
      minForce: Number.POSITIVE_INFINITY,
    };
    this.protectionHistory = [];
    this.feedbackBursts = [];
    this.climberSpeech = null;
    this.speechCooldown = 0;
    this.slackNeedTime = 0;
    this.slackNeedMode = null;
    this.eventItems = [];

    clearInputState(keyInput);
    clearInputState(touchInput);
    clearInputState(apiInput);
    this.resetJoystick();

    this.updateControlLabels();
    this.showOverlay(true, {
      kicker: "",
      title: "保护员已就位",
      text: "首挂前做抱石保护。首挂后用前移、后移、放绳、收绳维持余绳，在冲坠时抓准时机跳起缓冲。",
      warning:
        "本游戏仅为教学向简化模拟，不能替代真实先锋保护训练或教学。真实的先锋保护风险非常高，请到专业机构培训。",
      button: "开始攀登",
    });
    this.syncHud();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    canvas.width = Math.round(this.width * dpr);
    canvas.height = Math.round(this.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  loop(timestamp) {
    const seconds = timestamp * 0.001;
    const delta = clamp(seconds - this.lastFrame || 0, 0, 0.032);
    this.lastFrame = seconds;
    this.update(delta);
    this.render();
    this.raf = window.requestAnimationFrame(this.loop);
  }

  update(delta) {
    this.elapsed += delta;
    this.belayer.visualLift = Math.max(0, this.belayer.visualLift - delta * 1.6);
    this.speechCooldown = Math.max(0, this.speechCooldown - delta);
    if (this.climberSpeech) {
      this.climberSpeech.time -= delta;
      if (this.climberSpeech.time <= 0) {
        this.climberSpeech = null;
      }
    }

    if (this.feedbackBursts.length) {
      this.feedbackBursts = this.feedbackBursts.filter((burst) => {
        burst.elapsed += delta;
        return burst.elapsed < burst.duration;
      });
    }

    if (this.stage === "playing") {
      this.applyControls(delta);

      if (this.fall) {
        this.updateFall(delta);
      } else {
        this.updateBelayerIdle(delta);
        this.updateClimber(delta);
        this.updateHazard(delta);
      }
    } else {
      this.updateBelayerIdle(delta);
    }

    if (this.phase === "lead") {
      this.climberClipSlack = Math.min(this.climberClipSlack, Math.max(0, this.getSlack()));
    }

    this.syncHud();
  }

  updateBelayerIdle(delta) {
    const baseY = CONFIG.belayer.baseY;

    if (
      this.belayer.y <= baseY + 0.001 &&
      Math.abs(this.belayer.vx) < 0.01 &&
      Math.abs(this.belayer.vy) < 0.01
    ) {
      this.belayer.y = baseY;
      this.belayer.vx = 0;
      this.belayer.vy = 0;
      return;
    }

    this.belayer.vy -= CONFIG.fall.gravity * 0.82 * delta;
    this.belayer.vx *= 0.94;
    this.belayer.x += this.belayer.vx * delta;
    this.belayer.y += this.belayer.vy * delta;
    this.belayer.x = clamp(
      this.belayer.x,
      CONFIG.world.belayerMinX,
      CONFIG.world.belayerMaxX,
    );

    if (this.belayer.y <= baseY) {
      this.belayer.y = baseY;
      this.belayer.vy = Math.max(0, this.belayer.vy);
      this.belayer.vx *= 0.82;
    }
  }

  applyControls(delta) {
    const leadFallActive = this.fall?.type === "lead";
    const canFootwork =
      (!leadFallActive || this.fall.catchTime === null) &&
      this.belayer.y <= CONFIG.belayer.baseY + 0.03;

    if (canFootwork) {
      if (isInputActive("moveToward")) {
        this.belayer.x -= CONFIG.belayer.speed * delta;
      }

      if (isInputActive("moveAway")) {
        this.belayer.x += CONFIG.belayer.speed * delta;
      }
    }

    this.belayer.x = clamp(
      this.belayer.x,
      CONFIG.world.belayerMinX,
      CONFIG.world.belayerMaxX,
    );

    if (this.phase === "lead" && !leadFallActive) {
      if (isInputActive("ropeOut")) {
        this.manualRope += CONFIG.belayer.ropeOutSpeed * delta;
      }

      if (isInputActive("ropeIn")) {
        this.manualRope -= CONFIG.belayer.ropeInSpeed * delta;
      }

      if (!this.fall) {
        const minRope = this.getTautPathLength(this.climber);
        this.manualRope = Math.max(this.manualRope, minRope);
      }
    }
  }

  updateClimber(delta) {
    if (this.phase === "preclip") {
      this.updatePreclip(delta);
      return;
    }

    const nextQuickdraw = QUICKDRAWS[this.clippedCount] || null;
    const topTarget = CONFIG.world.topY;
    const climbWindow = this.getDisplaySlackWindow(this.subphase);
    const slack = this.getSlack();
    const enoughSlack = slack >= climbWindow.min;

    if (nextQuickdraw) {
      if (this.subphase === "clipping") {
        if (slack >= climbWindow.min) {
          this.clipProgress += delta;
          this.dismissClimberSpeech();
          this.clearSlackNeed();
          this.advice = `第 ${this.clippedCount + 1} 把快挂：攀爬者正在抽绳入挂，请继续保持给绳。`;
        } else {
          this.advice = `第 ${this.clippedCount + 1} 把快挂前余绳不足，攀爬者抽不出 1m 绳环完成入挂。`;
          this.updateSlackNeed(delta, true);
        }

        if (this.clipProgress >= CONFIG.climber.clipTime) {
          this.clippedCount += 1;
          this.subphase = "climbing";
          this.clipProgress = 0;
          this.climberClipSlack = Math.min(CONFIG.climber.clipDrawLength, Math.max(0, this.getSlack()));
          this.dismissClimberSpeech();
          this.clearSlackNeed();
          this.pushEvent(`第 ${this.clippedCount} 把快挂完成。`);

          if (this.clippedCount >= QUICKDRAWS.length) {
            this.advice = "最后一把快挂完成，继续保护到达终点。";
          }
        }

        return;
      }

      if (this.climber.y < nextQuickdraw.y - 0.05) {
        if (enoughSlack) {
          this.climber.y = Math.min(
            nextQuickdraw.y,
            this.climber.y + CONFIG.climber.climbSpeed * delta,
          );
          this.dismissClimberSpeech();
          this.clearSlackNeed();
          this.advice = this.getClimbAdvice(slack, climbWindow);
        } else {
          this.advice = "余绳过短，攀爬者被 short-rope，停在原地等待。";
          this.updateSlackNeed(delta, false);
        }
      } else {
        this.subphase = "clipping";
        this.clipProgress = 0;
        this.clearSlackNeed();
        this.advice = `到达第 ${this.clippedCount + 1} 把快挂，准备给绳入挂。`;
      }
    } else {
      if (this.climber.y < topTarget) {
        if (enoughSlack) {
          this.climber.y = Math.min(
            topTarget,
            this.climber.y + CONFIG.climber.climbSpeed * delta,
          );
          this.dismissClimberSpeech();
          this.clearSlackNeed();
          this.advice = "继续维持余绳，准备完成顶端保护。";
        } else {
          this.advice = "顶端前收绳过多，攀爬者无法继续向上。";
          this.updateSlackNeed(delta, false);
        }
      } else {
        this.win();
      }
    }

    this.climber.x = this.routeX(this.climber.y);
  }

  updatePreclip(delta) {
    const first = QUICKDRAWS[0];

    if (this.climber.y < first.y) {
      this.climber.y = Math.min(first.y, this.climber.y + CONFIG.climber.climbSpeed * delta);
      this.climber.x = this.routeX(this.climber.y);
      this.advice = "首挂前：移动到攀爬者正下方，准备在掉落时立即抱石保护。";
      return;
    }

    this.autoFirstClip += delta;
    this.advice = "攀爬者正在完成首挂，成功后进入先锋保护。";

    if (this.autoFirstClip >= 0.8) {
      this.phase = "lead";
      this.subphase = "climbing";
      this.clippedCount = 1;
      this.manualRope = this.getTautPathLength(this.climber) + 2;
      this.climberClipSlack = 0;
      this.scheduleHazard();
      this.updateControlLabels();
      this.pushEvent("首挂完成：现在需要前移、后移、放绳、收绳。");
    }
  }

  updateHazard(delta) {
    if (!Number.isFinite(this.hazardTimer)) {
      return;
    }

    if (this.phase === "lead" && !this.hasSafeFallWindow()) {
      this.hazardTimer = Math.max(this.hazardTimer, 0.45);
      return;
    }

    const pressure =
      this.subphase === "clipping" || this.getSlack() < this.getDisplaySlackWindow(this.subphase).min
        ? CONFIG.hazard.waitingPenalty
        : 0;

    this.hazardTimer -= delta * (1 + pressure);

    if (this.hazardTimer <= 0) {
      this.startFall();
    }
  }

  startFall() {
    this.climberSpeech = null;
    this.clearSlackNeed();

    if (this.phase === "preclip") {
      this.preclipSpotSpent = true;
      this.preclipSpotAvailable = false;
      this.hazardTimer = Number.POSITIVE_INFINITY;
      this.fall = {
        type: "spot",
        elapsed: 0,
        saved: false,
        startY: this.climber.y,
        contextLabel: "首挂前",
      };
      this.climber.vx = 0;
      this.climber.vy = 0;
      this.advice = "首挂前掉落：移动到正下方，并在 1 秒内按空格/保护。";
      this.pushEvent("首挂前掉落。");
      return;
    }

    const anchor = QUICKDRAWS[this.clippedCount - 1];
    const totalSlack = Math.max(0, this.getSlack());
    const climberReserve = this.getClimberOperationalReserve(totalSlack);
    const floorSlack = Math.max(0, totalSlack - climberReserve);
    const fallContext = this.getProtectionContext();

    this.fall = {
      type: "lead",
      elapsed: 0,
      anchor,
      snapshotRope: this.manualRope,
      startTautPath: this.getTautPathLength(this.climber),
      startAnchorDistance: distance(this.climber, anchor),
      climberReserve,
      floorSlack,
      passiveRelease: this.getPassiveFloorRelease(floorSlack),
      startY: this.climber.y,
      minY: this.climber.y,
      maxSwing: Math.abs(this.climber.x - anchor.x),
      peakForce: 0,
      catchTime: null,
      catchBelayerX: null,
      lastActionTime: null,
      jumpScore: 0,
      jumpApplied: false,
      contextLabel: fallContext.label,
      contextHeight: fallContext.height,
      contextClip: fallContext.clipIndex,
      contextMode: fallContext.mode,
    };

    this.climber.vx = (this.climber.x - anchor.x) * 0.35;
    this.climber.vy = -0.15;
    this.advice = "冲坠发生：保持绳长，绳子将吃力时按空格/保护进行动态跳起。";
    this.pushEvent("冲坠发生。");
  }

  updateFall(delta) {
    this.fall.elapsed += delta;

    if (this.fall.type === "spot") {
      this.climber.vy -= CONFIG.fall.gravity * delta;
      this.climber.y += this.climber.vy * delta;
      this.climber.x = this.routeX(Math.max(this.climber.y, 0.52));

      if (this.climber.y <= this.climber.radius) {
        if (this.fall.saved) {
          this.performance.spotSaves += 1;
          const record = {
            kind: "spot",
            label: this.fall.contextLabel || "首挂前",
            height: this.fall.startY ?? this.climber.y,
            force: null,
            summary: "抱石保护成功",
          };
          this.recordProtection(record);
          this.spawnCatchFeedback(record);
          this.climber.y = 0.52;
          this.climber.vx = 0;
          this.climber.vy = 0;
          this.fall = null;
          this.pushEvent("抱石保护成功，攀爬者回到地面重新尝试首挂。");
          this.advice = "抱石保护成功，继续跟住攀爬者完成首挂。";
        } else {
          this.lose("首挂前掉落时未在 1 秒内完成抱石保护。");
        }
      }
      return;
    }

    const anchor = this.fall.anchor;
    const gravityForce = -CONFIG.climber.mass * CONFIG.fall.gravity;
    let forceX = 0;
    let forceY = gravityForce;
    let ropeState = this.getFallRopeState();
    let extension = ropeState.extension;
    let tension = 0;

    if (extension > 0) {
      if (this.fall.catchTime === null) {
        this.fall.catchTime = this.fall.elapsed;
        this.fall.catchBelayerX = this.belayer.x;
        this.evaluateJump();
        if (!this.fall.jumpApplied) {
          this.advice = "绳子开始吃力，立刻按空格/保护做动态跳起。";
        }
        ropeState = this.getFallRopeState();
        extension = ropeState.extension;
      }

      if (extension > 0) {
        const dx = this.climber.x - anchor.x;
        const dy = this.climber.y - anchor.y;
        const currentDistance = Math.max(0.001, Math.hypot(dx, dy));
        const activeRope = Math.max(
          3,
          this.fall.startTautPath + this.fall.climberReserve + ropeState.releaseBudget,
        );
        const dynamicSoftening = this.fall.jumpApplied
          ? 0.82 - this.fall.jumpScore * 0.14
          : 1;
        const stiffness = clamp(
          (CONFIG.fall.ropeBaseK / activeRope) * dynamicSoftening,
          CONFIG.fall.ropeMinK * dynamicSoftening,
          CONFIG.fall.ropeBaseK,
        );
        const damping =
          2 *
          Math.sqrt(stiffness * CONFIG.climber.mass) *
          CONFIG.fall.dampingRatio;
        const nx = dx / currentDistance;
        const ny = dy / currentDistance;
        const velocityAlong = this.climber.vx * nx + this.climber.vy * ny;
        tension = stiffness * extension + damping * Math.max(velocityAlong, 0);
        tension = Math.max(0, tension);

        forceX += -tension * nx;
        forceY += -tension * ny;
        this.fall.peakForce = Math.max(this.fall.peakForce, tension / 1000);
      }
    }

    this.updateBelayerDuringFall(delta, tension);

    this.climber.vx += (forceX / CONFIG.climber.mass) * delta;
    this.climber.vy += (forceY / CONFIG.climber.mass) * delta;
    this.climber.x += this.climber.vx * delta;
    this.climber.y += this.climber.vy * delta;

    const wallLimit = CONFIG.world.wallX + 0.42;
    if (this.climber.x < wallLimit) {
      this.climber.x = wallLimit;
      this.climber.vx = Math.abs(this.climber.vx) * 0.35;
    }

    this.fall.minY = Math.min(this.fall.minY, this.climber.y);
    this.fall.maxSwing = Math.max(this.fall.maxSwing, Math.abs(this.climber.x - anchor.x));

    if (this.climber.y <= this.climber.radius) {
      this.lose("余绳过长，攀爬者冲坠后坠地。");
      return;
    }

    const settled =
      this.fall.catchTime !== null &&
      this.fall.elapsed - this.fall.catchTime > CONFIG.fall.settleTime &&
      Math.hypot(this.climber.vx, this.climber.vy) < 0.42;

    if (settled || this.fall.elapsed > 4.8) {
      this.resolveLeadFall();
    }
  }

  updateBelayerDuringFall(delta, tension) {
    const baseY = CONFIG.belayer.baseY;
    const wallLimit = CONFIG.world.wallX + 0.36;

    if (!this.fall.jumpApplied) {
      const startX = this.fall.catchBelayerX ?? this.belayer.x;
      const slide = tension <= 0 ? 0 : Math.min(0.28, 0.05 + tension / 24000);
      const targetX = clamp(startX - slide, wallLimit, CONFIG.world.belayerMaxX);
      const lift = tension <= 0 ? 0 : Math.min(0.05, tension / 60000);
      this.belayer.x = lerp(this.belayer.x, targetX, clamp(delta * 7.5, 0, 1));
      this.belayer.y = lerp(this.belayer.y, baseY + lift, clamp(delta * 8.5, 0, 1));
      this.belayer.vx = 0;
      this.belayer.vy = 0;
      return;
    }

    const target = {
      x: clamp(QUICKDRAWS[0].x + 0.14, wallLimit, CONFIG.world.belayerMaxX),
      y: QUICKDRAWS[0].y - CONFIG.belayer.ropePointOffsetY + 0.08,
    };
    const springX = (target.x - this.belayer.x) * 9.5;
    const springY = (target.y - this.belayer.y) * 8.4;

    this.belayer.vx += springX * delta;
    this.belayer.vy += springY * delta;
    this.belayer.vy -= CONFIG.fall.gravity * 0.22 * delta;
    this.belayer.vx *= 0.92;
    this.belayer.vy *= 0.94;
    this.belayer.x += this.belayer.vx * delta;
    this.belayer.y += this.belayer.vy * delta;
    this.belayer.x = clamp(this.belayer.x, wallLimit, CONFIG.world.belayerMaxX);
    this.belayer.y = Math.max(baseY + 0.08, this.belayer.y);
  }

  resolveLeadFall() {
    const peakForce = this.fall.peakForce;
    const fallDistance = Math.max(0.01, this.fall.startY - this.fall.minY);
    const fallFactor = clamp(fallDistance / Math.max(this.manualRope, 3), 0, 2);
    const enforceHardCatch = this.clippedCount >= 3;

    if (enforceHardCatch && peakForce > CONFIG.fall.hardCatchLimit) {
      this.lose(
        `保护过硬：峰值冲击力 ${peakForce.toFixed(1)} kN，超过 ${CONFIG.fall.hardCatchLimit.toFixed(
          1,
        )} kN 的教学阈值。`,
      );
      return;
    }

    this.performance.catches += 1;
    this.performance.maxForce = Math.max(this.performance.maxForce, peakForce);
    this.performance.minForce = Math.min(this.performance.minForce, peakForce);
    this.lastProtection = {
      force: peakForce,
      factor: fallFactor,
      swing: this.fall.maxSwing,
    };
    const record = {
      kind: "lead",
      label: this.fall.contextLabel || this.getProtectionContext().label,
      height: this.fall.contextHeight ?? this.fall.startY,
      force: peakForce,
      factor: fallFactor,
      swing: this.fall.maxSwing,
      summary: `冲击力 ${peakForce.toFixed(1)}kN`,
    };
    this.recordProtection(record);
    this.spawnCatchFeedback(record);

    const recoverY = Math.max(
      this.fall.anchor.y + 0.72,
      this.fall.minY + 0.86,
    );

    this.climber.y = clamp(recoverY, this.fall.anchor.y + 0.3, CONFIG.world.topY);
    this.climber.x = this.routeX(this.climber.y);
    this.climber.vx = 0;
    this.climber.vy = 0;
    this.fall = null;
    this.scheduleHazard();

    const note =
      !enforceHardCatch && this.lastProtection.force >= CONFIG.fall.hardCatchLimit
        ? "低位保护成功：虽然接坠偏硬，但优先保住了不落地。"
        :
      this.lastProtection.force < 4.6
        ? "保护成功：缓冲充分。"
        : "保护成功：绳子吃力偏重，注意下一次再柔和一些。";

    this.pushEvent(
      `${note} 峰值 ${this.lastProtection.force.toFixed(1)} kN，摆荡 ${this.lastProtection.swing.toFixed(2)} m。`,
    );
    this.advice = note;
  }

  handleAction() {
    if (this.stage !== "playing") {
      this.start();
      return;
    }

    if (!this.fall) {
      return;
    }

    if (this.fall.type === "spot") {
      const aligned = Math.abs(this.belayer.x - this.climber.x) <= 0.48;
      const timely = this.fall.elapsed <= CONFIG.fall.spotWindow;

      if (aligned && timely) {
        this.fall.saved = true;
        this.belayer.visualLift = 0.18;
        this.pushEvent("抱石保护动作到位。");
      } else {
        this.pushEvent("抱石保护时机或站位不对。");
      }

      return;
    }

    this.fall.lastActionTime = this.fall.elapsed;
    this.belayer.visualLift = 0.4;
    this.evaluateJump();
  }

  evaluateJump() {
    if (!this.fall || this.fall.type !== "lead" || this.fall.jumpApplied) {
      return;
    }

    if (this.fall.catchTime === null || this.fall.lastActionTime === null) {
      return;
    }

    const delta = Math.abs(this.fall.lastActionTime - this.fall.catchTime);
    if (delta > CONFIG.fall.jumpWindow) {
      return;
    }

    this.fall.jumpScore = 1 - delta / CONFIG.fall.jumpWindow;
    this.fall.jumpApplied = true;
    this.applyBelayerJumpImpulse(this.fall.jumpScore);
    if (this.fall.jumpScore > 0.8) {
      this.performance.perfectJumps += 1;
    }

    this.pushEvent(
      this.fall.jumpScore > 0.8
        ? "动态保护时机很好：保护员端余绳被顺利送出。"
        : "起跳给出了一部分缓冲，但还可以更早一点。",
    );
  }

  applyBelayerJumpImpulse(score) {
    const towardWall = QUICKDRAWS[0].x < this.belayer.x ? -1 : 1;
    const power = 0.55 + score * 0.9;
    this.belayer.vx += towardWall * CONFIG.belayer.jumpTowardWallSpeed * power;
    this.belayer.vy += CONFIG.belayer.jumpUpSpeed * power;
    this.belayer.visualLift = Math.max(this.belayer.visualLift, 0.26 + score * 0.18);
  }

  getClimbAdvice(slack, window) {
    if (slack < window.min + 0.16) {
      return "余绳接近下限，继续前移或放绳，避免 short-rope。";
    }
    if (slack > window.max) {
      return "余绳偏长，继续攀爬没问题，但坠地风险在上升。";
    }
    return "余绳处于合适范围，继续稳定保护。";
  }

  getClimberStoredSlack(totalSlack = this.getSlack()) {
    if (totalSlack <= 0.001) {
      return 0;
    }

    return Math.min(this.climberClipSlack, totalSlack);
  }

  getClipExtraNeed(totalSlack = this.getSlack()) {
    return Math.max(0, CONFIG.climber.clipDrawLength - this.getClimberStoredSlack(totalSlack));
  }

  getDisplaySlackWindow(kind = this.subphase, totalSlack = this.getSlack()) {
    const window = this.getSlackWindow(kind);
    if (kind !== "clipping") {
      return window;
    }

    const clipExtra = this.getClipExtraNeed(totalSlack);
    return {
      min: window.min + clipExtra,
      max: window.max + clipExtra,
    };
  }

  dismissClimberSpeech() {
    if (this.climberSpeech?.kind === "slack") {
      this.climberSpeech = null;
    }
  }

  getClimberOperationalReserve(totalSlack = this.getSlack(), kind = this.subphase) {
    if (totalSlack <= 0.001) {
      return 0;
    }

    const stored = this.getClimberStoredSlack(totalSlack);

    if (kind === "clipping") {
      return Math.min(totalSlack, Math.max(stored, CONFIG.climber.clipDrawLength));
    }

    const remaining = Math.max(0, totalSlack - stored);
    return Math.min(totalSlack, stored + Math.min(remaining, 0.08));
  }

  getPassiveFloorRelease(floorSlack) {
    if (floorSlack <= 0.001) {
      return 0;
    }

    const frictionPenalty = Math.min(0.08, (this.clippedCount - 1) * 0.01);
    const release =
      CONFIG.fall.passiveSlideBase +
      floorSlack * Math.max(0.08, CONFIG.fall.passiveSlideScale - frictionPenalty);
    return clamp(release, 0, floorSlack);
  }

  getFallReleaseBudget() {
    if (!this.fall || this.fall.type !== "lead") {
      return 0;
    }

    const passive = this.fall.passiveRelease;
    if (!this.fall.jumpApplied) {
      return passive;
    }

    const jumpAssist = 0.22 + this.fall.jumpScore * 0.78;
    return passive + (this.fall.floorSlack - passive) * jumpAssist;
  }

  getFallRopeState() {
    if (!this.fall || this.fall.type !== "lead") {
      return null;
    }

    const currentTaut = this.getTautPathLength(this.climber);
    const consumed = Math.max(0, currentTaut - this.fall.startTautPath);
    const reserveUsed = Math.min(consumed, this.fall.climberReserve);
    const reserveRemaining = this.fall.climberReserve - reserveUsed;
    const floorDemand = Math.max(0, consumed - this.fall.climberReserve);
    const releaseBudget = this.getFallReleaseBudget();
    const releasedFloor = Math.min(floorDemand, releaseBudget);
    const retainedFloor = Math.max(0, this.fall.floorSlack - releasedFloor);
    const extension = Math.max(0, floorDemand - releaseBudget);

    return {
      currentTaut,
      consumed,
      reserveRemaining,
      releasedFloor,
      retainedFloor,
      extension,
      releaseBudget,
    };
  }

  getSlackWindow(kind) {
    const anchor = QUICKDRAWS[this.clippedCount - 1];
    const aboveAnchor = anchor ? Math.max(0, this.climber.y - anchor.y) : 0;
    const lowZone = this.clippedCount <= 2;
    const midZone = this.clippedCount <= 5;
    const climbMinBase = lowZone ? 1.55 : midZone ? 1.35 : 1.12;
    const climbMaxBase = lowZone ? 2.3 : midZone ? 2.1 : 1.9;
    const dynamicBias = Math.min(0.28, aboveAnchor * 0.07);
    const climbMin = climbMinBase + dynamicBias * 0.35;
    const climbMax = climbMaxBase + dynamicBias * 0.45;
    const clipMin = climbMin + (lowZone ? 0.42 : 0.34);
    const clipMax = climbMax + (lowZone ? 0.62 : 0.54);

    if (kind === "clipping") {
      return { min: clipMin, max: clipMax };
    }

    return { min: climbMin, max: climbMax };
  }

  hasSafeFallWindow() {
    if (this.phase !== "lead") {
      return true;
    }

    const window = this.getSlackWindow(this.subphase);
    const minimumWidth = this.clippedCount <= 2 ? 0.45 : 0.32;
    return window.max - window.min >= minimumWidth;
  }

  getAnchorIndex() {
    return this.clippedCount - 1;
  }

  getFixedRopeLength(anchorIndex = this.getAnchorIndex()) {
    if (anchorIndex < 0) {
      return 0;
    }

    let total = distance(this.getBelayerRopePoint(), QUICKDRAWS[0]);
    for (let index = 1; index <= anchorIndex; index += 1) {
      total += distance(QUICKDRAWS[index - 1], QUICKDRAWS[index]);
    }
    return total;
  }

  getClimberSideRopeLength(anchorIndex = this.getAnchorIndex()) {
    if (anchorIndex < 0) {
      return 0;
    }

    return Math.max(0.4, this.manualRope - this.getFixedRopeLength(anchorIndex));
  }

  getTautPathLength(position = this.climber) {
    const anchorIndex = this.getAnchorIndex();
    if (anchorIndex < 0) {
      return 0;
    }

    return this.getFixedRopeLength(anchorIndex) + distance(position, QUICKDRAWS[anchorIndex]);
  }

  getSlack() {
    if (this.phase !== "lead") {
      return 0;
    }

    return this.manualRope - this.getTautPathLength(this.climber);
  }

  getVisibleRopeLength() {
    if (this.phase !== "lead") {
      return 0;
    }

    if (this.fall?.type === "lead") {
      const ropeState = this.getFallRopeState();
      return this.manualRope + (ropeState?.extension ?? 0);
    }

    return this.manualRope;
  }

  getBelayerRopePoint() {
    return {
      x: this.belayer.x,
      y: this.belayer.y + CONFIG.belayer.ropePointOffsetY + this.belayer.visualLift * 0.18,
    };
  }

  getClimberVisibleReserve(extra) {
    if (extra <= 0.001) {
      return 0;
    }

    if (this.fall?.type === "lead") {
      return 0;
    }

    const stored = this.getClimberStoredSlack(extra);
    if (this.subphase === "clipping") {
      return Math.min(extra, Math.max(stored, CONFIG.climber.clipDrawLength));
    }

    return Math.min(extra, stored + Math.min(Math.max(0, extra - stored), 0.08));
  }

  getVisibleSegmentTargets(nodes, visibleLength) {
    if (nodes.length < 3) {
      return null;
    }

    if (this.fall?.type === "lead") {
      const ropeState = this.getFallRopeState();
      return {
        firstTarget: distance(nodes[0], nodes[1]) + ropeState.retainedFloor,
        lastTarget: distance(nodes[nodes.length - 2], nodes[nodes.length - 1]) + ropeState.reserveRemaining,
        straightLast: true,
      };
    }

    const firstStraight = distance(nodes[0], nodes[1]);
    const lastStraight = distance(nodes[nodes.length - 2], nodes[nodes.length - 1]);
    let middleLength = 0;

    for (let index = 2; index < nodes.length - 1; index += 1) {
      middleLength += distance(nodes[index - 1], nodes[index]);
    }

    const minimumLength = firstStraight + middleLength + lastStraight;
    const clampedVisibleLength = Math.max(visibleLength, minimumLength);
    const extra = clampedVisibleLength - minimumLength;
    let lastExtra = clamp(this.getClimberVisibleReserve(extra), 0, extra);
    let firstTarget = clampedVisibleLength - middleLength - (lastStraight + lastExtra);

    if (firstTarget < firstStraight) {
      const deficit = firstStraight - firstTarget;
      lastExtra = Math.max(0, lastExtra - deficit);
      firstTarget = firstStraight;
    }

    return {
      firstTarget,
      lastTarget: lastStraight + lastExtra,
      straightLast: false,
    };
  }

  getBelayerSegmentGeometry(start, end, targetLength) {
    const straight = distance(start, end);
    const extra = targetLength - straight;

    if (extra <= 0.42) {
      const controls = this.getSagControls(start, end, targetLength, true);
      return controls ? { type: "bezier", controls } : { type: "line" };
    }

    const groundY = CONFIG.world.groundY + 0.02;
    const dropPoint = { x: start.x - 0.02, y: groundY };
    const pickupPoint = {
      x: Math.max(CONFIG.world.wallX + 0.3, Math.min(start.x - 0.5, end.x + 0.24)),
      y: groundY,
    };
    const descentControls = [
      { x: start.x - 0.04, y: Math.max(groundY + 0.28, lerp(start.y, groundY, 0.28)) },
      { x: start.x - 0.12, y: groundY + 0.1 },
    ];
    const ascentControls = [
      { x: pickupPoint.x - 0.08, y: groundY + 0.08 },
      { x: end.x + 0.08, y: Math.max(groundY + 0.24, lerp(end.y, groundY, 0.52)) },
    ];
    const descent = sampleCubicPoints(
      start,
      descentControls[0],
      descentControls[1],
      dropPoint,
      12,
    );
    const ascent = sampleCubicPoints(
      pickupPoint,
      ascentControls[0],
      ascentControls[1],
      end,
      12,
    );
    const floorBase = [dropPoint, pickupPoint];
    const baseLength = polylineLength(descent) + polylineLength(floorBase) + polylineLength(ascent);

    if (targetLength <= baseLength + 0.04) {
      const controls = this.getSagControls(start, end, targetLength, true);
      return controls ? { type: "bezier", controls } : { type: "line" };
    }

    let low = 0;
    let high = Math.max(0.2, extra * 1.55 + 0.2);
    let best = [...descent, ...floorBase.slice(1), ...ascent.slice(1)];

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const depth = (low + high) * 0.5;
      const floorPoints = [dropPoint];
      const steps = 26;

      for (let index = 1; index < steps; index += 1) {
        const t = index / steps;
        floorPoints.push({
          x: lerp(dropPoint.x, pickupPoint.x, t) + Math.sin(t * Math.PI * 2) * depth * 0.03,
          y: groundY - depth * Math.pow(Math.sin(Math.PI * t), 1.08),
        });
      }

      floorPoints.push(pickupPoint);
      const candidate = [
        ...descent,
        ...floorPoints.slice(1),
        ...ascent.slice(1),
      ];
      const length = polylineLength(candidate);

      if (length < targetLength) {
        low = depth;
      } else {
        best = candidate;
        high = depth;
      }
    }

    return { type: "sampled", points: best };
  }

  getSagControls(start, end, targetLength, allowGround) {
    const straight = distance(start, end);
    if (targetLength <= straight + 0.01) {
      return null;
    }

    const groundY = CONFIG.world.groundY + 0.05;
    const sagTemplate = (sag) => {
      const control1 = {
        x: lerp(start.x, end.x, 0.32),
        y: Math.max(groundY, lerp(start.y, end.y, 0.18) - sag),
      };
      const control2 = {
        x: lerp(start.x, end.x, 0.68),
        y: Math.max(groundY, lerp(start.y, end.y, 0.82) - sag * 0.92),
      };
      return [control1, control2];
    };

    const maxSag = allowGround
      ? Math.max(0.12, Math.min(start.y, end.y) - groundY + Math.abs(start.x - end.x) * 0.32)
      : Math.max(0.12, Math.min(start.y, end.y) * 0.42);

    let low = 0;
    let high = maxSag;
    let best = sagTemplate(high);

    for (let index = 0; index < 22; index += 1) {
      const mid = (low + high) * 0.5;
      const candidate = sagTemplate(mid);
      const length = cubicLength(start, candidate[0], candidate[1], end);

      if (length < targetLength) {
        low = mid;
      } else {
        best = candidate;
        high = mid;
      }
    }

    return best;
  }

  routeX(y) {
    const points = [{ x: 1.74, y: 0.5 }, ...QUICKDRAWS, { x: 1.96, y: CONFIG.world.topY }];

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (y <= current.y) {
        const t = clamp((y - previous.y) / (current.y - previous.y || 1), 0, 1);
        return lerp(previous.x, current.x, t);
      }
    }

    return points[points.length - 1].x;
  }

  scheduleHazard() {
    if (this.phase === "preclip") {
      this.hazardTimer =
        this.preclipSpotAvailable && !this.preclipSpotSpent
          ? this.random(CONFIG.hazard.preclipMin, CONFIG.hazard.preclipMax)
          : Number.POSITIVE_INFINITY;
    } else {
      this.hazardTimer = this.random(CONFIG.hazard.leadMin, CONFIG.hazard.leadMax);
    }
  }

  getProtectionContext() {
    if (this.phase === "preclip") {
      return {
        label: "首挂前",
        height: this.climber.y,
        clipIndex: 0,
        mode: "spot",
      };
    }

    if (this.subphase === "clipping") {
      return {
        label: `第 ${this.clippedCount + 1} 把入挂时`,
        height: this.climber.y,
        clipIndex: this.clippedCount + 1,
        mode: "clipping",
      };
    }

    return {
      label: `第 ${this.clippedCount} 把上方`,
      height: this.climber.y,
      clipIndex: this.clippedCount,
      mode: "climbing",
    };
  }

  recordProtection(record) {
    this.protectionHistory.push({
      kind: record.kind,
      label: record.label,
      height: record.height,
      force: record.force,
      factor: record.factor ?? null,
      swing: record.swing ?? null,
      summary: record.summary ?? "",
    });
  }

  getProtectionPraise(record) {
    if (record.kind === "spot") {
      const lines = ["完美保护", "抱得漂亮", "这下稳了", "教科书级"];
      return {
        title: lines[Math.floor(this.random(0, lines.length))],
        subtitle: "抱石保护成功",
        tint: "#d9ffe6",
      };
    }

    if (record.force < 3) {
      const lines = ["完美接坠", "教科书级", "太丝滑了", "漂亮极了"];
      return {
        title: lines[Math.floor(this.random(0, lines.length))],
        subtitle: `冲击力：${record.force.toFixed(1)}kN`,
        tint: "#d9ffe6",
      };
    }

    if (record.force < 4) {
      const lines = ["好保护", "接住了", "稳稳的", "接得不错"];
      return {
        title: lines[Math.floor(this.random(0, lines.length))],
        subtitle: `冲击力：${record.force.toFixed(1)}kN`,
        tint: "#fff0b2",
      };
    }

    const lines = ["保住了", "接到了", "还不错", "守住了"];
    return {
      title: lines[Math.floor(this.random(0, lines.length))],
      subtitle: `冲击力：${record.force.toFixed(1)}kN`,
      tint: "#ffd8b5",
    };
  }

  spawnCatchFeedback(record) {
    const praise = this.getProtectionPraise(record);

    this.feedbackBursts.push({
      title: praise.title,
      subtitle: praise.subtitle,
      point: {
        x: this.climber.x + 0.12,
        y: this.climber.y + 0.12,
      },
      elapsed: 0,
      duration: 1.45,
      driftX: this.random(-10, 10),
      tilt: this.random(-0.05, 0.05),
      force: record.force,
      tint: praise.tint,
    });

    this.feedbackBursts = this.feedbackBursts.slice(-4);
  }

  buildOverlayDetails(records = []) {
    if (!records.length) {
      return [];
    }

    return records.map((record, index) => ({
      index: index + 1,
      title: record.label,
      meta:
        record.force === null
          ? `起坠高度 ${record.height.toFixed(1)}m · 抱石保护成功`
          : `起坠高度 ${record.height.toFixed(1)}m · 冲击力 ${record.force.toFixed(1)}kN`,
    }));
  }

  showOverlay(visible, content) {
    overlay.classList.toggle("hidden", !visible);

    if (!content) {
      return;
    }

    overlayKicker.textContent = content.kicker;
    overlayKicker.classList.toggle("hidden", !content.kicker);
    overlayTitle.textContent = content.title;
    overlayText.textContent = content.text;
    startButton.textContent = content.button;

    if (overlayWarning) {
      const warning = content.warning || "";
      overlayWarning.classList.toggle("hidden", !warning);
      if (warning) {
        const paragraph = overlayWarning.querySelector("p");
        if (paragraph) {
          paragraph.textContent = warning;
        }
      }
    }

    if (overlayDetails) {
      overlayDetails.replaceChildren();
      const details = content.details || [];
      overlayDetails.classList.toggle("hidden", details.length === 0);

      details.forEach((detail) => {
        const item = document.createElement("article");
        item.className = "overlay-detail-item";

        const badge = document.createElement("span");
        badge.className = "overlay-detail-index";
        badge.textContent = String(detail.index).padStart(2, "0");

        const copy = document.createElement("div");
        copy.className = "overlay-detail-copy";

        const title = document.createElement("strong");
        title.textContent = detail.title;

        const meta = document.createElement("span");
        meta.textContent = detail.meta;

        copy.append(title, meta);
        item.append(badge, copy);
        overlayDetails.append(item);
      });
    }
  }

  pushEvent(message) {
    this.eventItems.unshift(message);
    this.eventItems = this.eventItems.slice(0, 5);
    this.renderEvents();
  }

  renderEvents() {
    eventLog.innerHTML = this.eventItems.map((message) => `<li>${message}</li>`).join("");
  }

  win() {
    this.stage = "won";
    const totalProtections = this.protectionHistory.length;
    const detailItems = this.buildOverlayDetails(this.protectionHistory);
    const bestComfortForce = Number.isFinite(this.performance.minForce)
      ? this.performance.minForce.toFixed(1)
      : null;
    const summary =
      totalProtections > 0
        ? this.performance.catches > 0
          ? `共成功处理 ${totalProtections} 次保护，其中包含 ${this.performance.spotSaves} 次抱石保护、${this.performance.catches} 次先锋冲坠。最舒适的一次冲击力为 ${bestComfortForce}kN。`
          : `共成功处理 ${totalProtections} 次掉落，本趟没有触发需要绳索接坠的先锋冲坠。`
        : "本趟没有触发需要处理的掉落。";
    this.showOverlay(true, {
      kicker: "保护成功",
      title: "已完成 10 把快挂并到达终点",
      text: `${summary} 可以重新开始继续练手感。`,
      details: detailItems,
      warning: "",
      button: "再来一趟",
    });
    this.pushEvent("通关：成功保护攀爬者到达终点。");
  }

  lose(reason) {
    this.stage = "lost";
    this.result = reason;
    this.showOverlay(true, {
      kicker: "保护失败",
      title: "本趟先锋保护结束",
      text: reason,
      warning: "",
      button: "重新开始",
    });
    this.pushEvent(`失败：${reason}`);
  }

  updateControlLabels() {
    if (this.phase === "preclip") {
      labelMoveToward.textContent = "左移";
      labelMoveAway.textContent = "右移";
      hintMoveToward.textContent = "贴到攀爬者下方";
      hintMoveAway.textContent = "调整抱石站位";
      return;
    }

    labelMoveToward.textContent = "前移";
    labelMoveAway.textContent = "后移";
    hintMoveToward.textContent = "靠墙给绳";
    hintMoveAway.textContent = "离墙收紧";
  }

  syncHud() {
    metricClip.textContent = `${this.clippedCount} / ${QUICKDRAWS.length}`;
    metricPhase.textContent = this.getPhaseLabel();
    metricForce.textContent = `${(this.fall?.peakForce ?? this.lastProtection.force).toFixed(1)} kN`;
    adviceText.textContent = this.advice;

    if (this.phase === "lead") {
      const slack = this.getSlack();
      const window = this.getDisplaySlackWindow(this.subphase);
      const maxDisplay = window.max + 0.7;
      const pointer = clamp(slack / maxDisplay, 0, 1);
      const zoneLeft = clamp(window.min / maxDisplay, 0, 0.95);
      const zoneWidth = clamp((window.max - window.min) / maxDisplay, 0.06, 0.7);

      metricSlack.textContent = `${slack.toFixed(2)} m`;
      meterCaption.textContent =
        this.subphase === "clipping"
          ? `入挂阶段需要额外抽 ${CONFIG.climber.clipDrawLength.toFixed(1)}m 绳`
          : "绿色区域是当前推荐余绳";
      meterZone.style.left = `${zoneLeft * 100}%`;
      meterZone.style.width = `${zoneWidth * 100}%`;
      meterPointer.style.left = `calc(${pointer * 100}% - 5px)`;
    } else {
      metricSlack.textContent = "0.00 m";
      meterCaption.textContent = "首挂前仅需站位与抱石保护";
      meterZone.style.left = "40%";
      meterZone.style.width = "20%";
      meterPointer.style.left = "calc(40% - 5px)";
    }

    this.updateControlLabels();
  }

  getPhaseLabel() {
    if (this.stage === "ready") {
      return "待命";
    }
    if (this.stage === "won") {
      return "胜利";
    }
    if (this.stage === "lost") {
      return "失败";
    }
    if (this.fall?.type === "spot") {
      return "抱石保护";
    }
    if (this.fall?.type === "lead") {
      return "冲坠中";
    }
    if (this.phase === "preclip") {
      return "首挂前";
    }
    return this.subphase === "clipping" ? "入挂" : "攀爬";
  }

  worldToScreen(point) {
    const padding = { left: 24, right: 22, top: 20, bottom: 30 };
    const scaleX = (this.width - padding.left - padding.right) / CONFIG.world.width;
    const scaleY = (this.height - padding.top - padding.bottom) / CONFIG.world.height;
    return {
      x: padding.left + point.x * scaleX,
      y: this.height - padding.bottom - point.y * scaleY,
      scale: Math.min(scaleX, scaleY),
    };
  }

  render() {
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop();
    this.drawWall();
    this.drawRoute();
    this.drawRope();
    this.drawBelayer();
    this.drawClimber();
    this.drawClimberSpeech();
    this.drawFeedbackBursts();
    this.drawHudOverlay();
  }

  strokeSmoothPath(points) {
    if (!points.length) {
      return;
    }

    if (points.length === 1) {
      const point = this.worldToScreen(points[0]);
      ctx.lineTo(point.x, point.y);
      return;
    }

    const screens = points.map((point) => this.worldToScreen(point));
    ctx.lineTo(screens[0].x, screens[0].y);

    for (let index = 1; index < screens.length - 1; index += 1) {
      const current = screens[index];
      const next = screens[index + 1];
      const midX = (current.x + next.x) * 0.5;
      const midY = (current.y + next.y) * 0.5;
      ctx.quadraticCurveTo(current.x, current.y, midX, midY);
    }

    const penultimate = screens[screens.length - 2];
    const last = screens[screens.length - 1];
    ctx.quadraticCurveTo(penultimate.x, penultimate.y, last.x, last.y);
  }

  drawBackdrop() {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, "#22334f");
    gradient.addColorStop(0.55, "#31485f");
    gradient.addColorStop(1, "#6d5038");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    for (let index = 0; index < 12; index += 1) {
      const x = ((index * 83) % this.width) + 10;
      const y = ((index * 57) % this.height) + 10;
      ctx.fillStyle = index % 2 ? "rgba(255,255,255,0.04)" : "rgba(255,179,71,0.05)";
      ctx.beginPath();
      ctx.arc(x, y, 18 + (index % 4) * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawWall() {
    const floorLeft = this.worldToScreen({ x: 0.8, y: 0 });
    const floorRight = this.worldToScreen({ x: CONFIG.world.width, y: 0 });
    const wallBase = this.worldToScreen({ x: CONFIG.world.wallX, y: 0 });
    const wallTop = this.worldToScreen({ x: CONFIG.world.wallX, y: CONFIG.world.height });

    const wallGradient = ctx.createLinearGradient(wallBase.x, 0, wallBase.x + 120, 0);
    wallGradient.addColorStop(0, "#d08a4f");
    wallGradient.addColorStop(0.4, "#c77039");
    wallGradient.addColorStop(1, "#7a3f2f");

    ctx.fillStyle = "rgba(40, 22, 18, 0.45)";
    ctx.fillRect(0, 0, wallBase.x + 30, this.height);

    ctx.fillStyle = wallGradient;
    ctx.fillRect(0, 0, wallBase.x + 18, this.height);

    for (let index = 0; index < 18; index += 1) {
      const y = wallTop.y + index * 28;
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(wallBase.x + 18, y + 10);
      ctx.stroke();
    }

    const floorGradient = ctx.createLinearGradient(0, wallBase.y, 0, this.height);
    floorGradient.addColorStop(0, "rgba(255, 179, 71, 0.18)");
    floorGradient.addColorStop(1, "rgba(18, 24, 30, 0.85)");
    ctx.fillStyle = floorGradient;
    ctx.fillRect(0, wallBase.y, this.width, this.height - wallBase.y);

    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(floorLeft.x, floorLeft.y);
    ctx.lineTo(floorRight.x, floorRight.y);
    ctx.stroke();
  }

  drawRoute() {
    ctx.strokeStyle = "rgba(255, 245, 230, 0.14)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    QUICKDRAWS.forEach((draw, index) => {
      const p = this.worldToScreen(draw);
      if (index === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    });
    ctx.stroke();

    QUICKDRAWS.forEach((draw, index) => {
      const p = this.worldToScreen(draw);
      const clipped = index < this.clippedCount;
      ctx.strokeStyle = clipped ? "#9ff5cc" : "rgba(255,255,255,0.42)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(p.x - 8, p.y - 12);
      ctx.lineTo(p.x, p.y);
      ctx.lineTo(p.x + 8, p.y - 12);
      ctx.stroke();

      ctx.fillStyle = clipped ? "#69d2a2" : "#ffd39d";
      ctx.beginPath();
      ctx.arc(p.x, p.y - 2, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawRope() {
    if (this.phase !== "lead") {
      return;
    }

    const nodes = [this.getBelayerRopePoint(), ...QUICKDRAWS.slice(0, this.clippedCount), this.climber];
    const visibleLength = this.getVisibleRopeLength();
    const targets = this.getVisibleSegmentTargets(nodes, visibleLength);
    ctx.strokeStyle = this.fall ? "rgba(255, 224, 129, 0.95)" : "rgba(255, 243, 204, 0.88)";
    ctx.lineWidth = this.fall ? 4 : 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    const startPoint = this.worldToScreen(nodes[0]);
    ctx.moveTo(startPoint.x, startPoint.y);

    if (nodes.length >= 3) {
      const firstEnd = this.worldToScreen(nodes[1]);
      const firstGeometry = this.getBelayerSegmentGeometry(
        nodes[0],
        nodes[1],
        targets ? targets.firstTarget : distance(nodes[0], nodes[1]),
      );

      if (firstGeometry?.type === "bezier") {
        const control1 = this.worldToScreen(firstGeometry.controls[0]);
        const control2 = this.worldToScreen(firstGeometry.controls[1]);
        ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, firstEnd.x, firstEnd.y);
      } else if (firstGeometry?.type === "sampled") {
        this.strokeSmoothPath(firstGeometry.points.slice(1));
      } else {
        ctx.lineTo(firstEnd.x, firstEnd.y);
      }

      for (let index = 2; index < nodes.length - 1; index += 1) {
        const point = this.worldToScreen(nodes[index]);
        ctx.lineTo(point.x, point.y);
      }

      const lastStart = nodes[nodes.length - 2];
      const lastEnd = nodes[nodes.length - 1];
      const lastEndScreen = this.worldToScreen(lastEnd);
      const lastControls =
        targets?.straightLast
          ? null
          : this.getSagControls(
              lastStart,
              lastEnd,
              targets ? targets.lastTarget : distance(lastStart, lastEnd),
              false,
            );

      if (lastControls) {
        const control1 = this.worldToScreen(lastControls[0]);
        const control2 = this.worldToScreen(lastControls[1]);
        ctx.bezierCurveTo(
          control1.x,
          control1.y,
          control2.x,
          control2.y,
          lastEndScreen.x,
          lastEndScreen.y,
        );
      } else {
        ctx.lineTo(lastEndScreen.x, lastEndScreen.y);
      }
    } else {
      nodes.slice(1).forEach((node) => {
        const point = this.worldToScreen(node);
        ctx.lineTo(point.x, point.y);
      });
    }

    ctx.stroke();
  }

  drawBelayer() {
    const base = this.worldToScreen(this.belayer);
    const lift = this.belayer.visualLift * base.scale;
    const bodyY = base.y - 28 - lift;
    const airborne = this.belayer.y > CONFIG.belayer.baseY + 0.08;
    const ropeHandling =
      this.phase === "lead" && !this.fall && (isInputActive("ropeOut") || isInputActive("ropeIn"));
    const handBeat = ropeHandling ? Math.sin(this.elapsed * 18) * 7 : 0;
    const leftShoulder = { x: base.x - 2, y: bodyY + 14 };
    const rightShoulder = { x: base.x + 2, y: bodyY + 14 };
    const leftHand =
      this.phase === "preclip" || this.fall?.type === "spot"
        ? { x: base.x - 13, y: bodyY - 12 }
        : ropeHandling
          ? {
              x: base.x - 14 - (isInputActive("ropeOut") ? handBeat * 0.3 : 0),
              y: bodyY + 4 - (isInputActive("ropeOut") ? handBeat : handBeat * 0.2),
            }
          : { x: base.x - 13, y: bodyY - (airborne ? -7 : 2) };
    const rightHand =
      this.phase === "preclip" || this.fall?.type === "spot"
        ? { x: base.x + 13, y: bodyY - 12 }
        : ropeHandling
          ? {
              x: base.x + 12 + (isInputActive("ropeIn") ? handBeat * 0.22 : 0),
              y: bodyY + 18 + (isInputActive("ropeIn") ? handBeat : handBeat * 0.35),
            }
          : { x: base.x + 13, y: bodyY - (airborne ? -7 : 2) };

    ctx.fillStyle = "#f1d7b8";
    ctx.beginPath();
    ctx.arc(base.x, bodyY, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#1a2330";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(base.x, bodyY + 8);
    ctx.lineTo(base.x, bodyY + 30);
    ctx.lineTo(base.x - (airborne ? 7 : 10), bodyY + (airborne ? 52 : 48));
    ctx.moveTo(base.x, bodyY + 30);
    ctx.lineTo(base.x + (airborne ? 7 : 10), bodyY + (airborne ? 52 : 48));
    ctx.moveTo(leftShoulder.x, leftShoulder.y);
    ctx.lineTo(leftHand.x, leftHand.y);
    ctx.moveTo(rightShoulder.x, rightShoulder.y);
    ctx.lineTo(rightHand.x, rightHand.y);
    ctx.stroke();

    ctx.fillStyle = "#ff7b54";
    roundedRect(base.x - 11, bodyY + 8, 22, 16, 6);
    ctx.fill();

    if (ropeHandling) {
      ctx.fillStyle = "#d5dce4";
      ctx.beginPath();
      ctx.arc(base.x + 3, bodyY + 20, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawClimber() {
    const p = this.worldToScreen(this.climber);
    const armSwing = this.fall ? Math.sin(this.elapsed * 9) * 7 : 0;

    ctx.fillStyle = "#ffe2c4";
    ctx.beginPath();
    ctx.arc(p.x, p.y - 17, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#162130";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 9);
    ctx.lineTo(p.x, p.y + 12);
    ctx.lineTo(p.x - 10, p.y + 30);
    ctx.moveTo(p.x, p.y + 12);
    ctx.lineTo(p.x + 10, p.y + 28);
    ctx.moveTo(p.x, p.y - 4);
    ctx.lineTo(p.x - 12, p.y + armSwing * 0.1);
    ctx.moveTo(p.x, p.y - 4);
    ctx.lineTo(p.x + 12, p.y - 4 - armSwing * 0.1);
    ctx.stroke();

    ctx.fillStyle = this.fall ? "#ffb347" : "#69d2a2";
    roundedRect(p.x - 10, p.y - 10, 20, 18, 6);
    ctx.fill();
  }

  drawClimberSpeech() {
    if (!this.climberSpeech) {
      return;
    }

    const anchor = this.worldToScreen(this.climber);
    const text = this.climberSpeech.text;
    ctx.save();
    ctx.translate(anchor.x + 8, anchor.y - 78);
    ctx.rotate(-0.05);
    ctx.font = '700 16px "Trebuchet MS", sans-serif';
    const textWidth = ctx.measureText(text).width;
    const width = textWidth + 28;
    const height = 42;

    ctx.fillStyle = "rgba(255, 252, 244, 0.96)";
    ctx.strokeStyle = "#162130";
    ctx.lineWidth = 2;
    roundedRect(-width / 2, -height / 2, width, height, 16);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-10, height / 2 - 2);
    ctx.lineTo(-2, height / 2 + 13);
    ctx.lineTo(8, height / 2 - 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#162130";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  drawFeedbackBursts() {
    if (!this.feedbackBursts.length) {
      return;
    }

    this.feedbackBursts.forEach((burst) => {
      const progress = burst.elapsed / burst.duration;
      const alpha = clamp(1 - progress, 0, 1);
      const lift = progress * 42;
      const scale = 0.92 + Math.sin(Math.min(1, progress * 1.15) * Math.PI) * 0.14;
      const anchor = this.worldToScreen(burst.point);
      const tint = burst.tint || "#fff0b2";

      ctx.save();
      ctx.translate(anchor.x + burst.driftX * progress, anchor.y - 34 - lift);
      ctx.rotate(burst.tilt * (1 - progress * 0.6));
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0, 0, 0, 0.34)";
      ctx.shadowBlur = 16;

      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(12, 18, 28, 0.88)";
      ctx.fillStyle = tint;
      ctx.font = '700 24px "Trebuchet MS", sans-serif';
      ctx.strokeText(burst.title, 0, 0);
      ctx.fillText(burst.title, 0, 0);

      ctx.font = '700 12px "Trebuchet MS", sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeText(burst.subtitle, 0, 19);
      ctx.fillStyle = "#edf6f7";
      ctx.fillText(burst.subtitle, 0, 19);
      ctx.restore();
    });
  }

  drawHudOverlay() {
    const climberScreen = this.worldToScreen(this.climber);
    const bubbleWidth = Math.min(170, this.width * 0.4);
    const bubbleHeight = this.phase === "lead" ? 64 : 50;
    let bubbleX = climberScreen.x + 34;
    let bubbleY = climberScreen.y - bubbleHeight - 34;

    if (bubbleX + bubbleWidth > this.width - 14) {
      bubbleX = climberScreen.x - bubbleWidth - 28;
    }

    if (bubbleX < 12) {
      bubbleX = 12;
    }

    if (bubbleY < 12) {
      bubbleY = Math.min(this.height - bubbleHeight - 12, climberScreen.y + 24);
    }

    roundedRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 18);
    ctx.fillStyle = "rgba(7, 10, 15, 0.48)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#edf6f7";
    ctx.font = '700 15px "Trebuchet MS", sans-serif';
    ctx.fillText(this.getPhaseLabel(), bubbleX + 14, bubbleY + 22);

    ctx.fillStyle = "#adbfca";
    ctx.font = '12px "Trebuchet MS", sans-serif';

    if (this.phase === "lead") {
      const slack = this.getSlack();
      const window = this.getDisplaySlackWindow(this.subphase);
      ctx.fillText(`余绳 ${slack.toFixed(2)}m`, bubbleX + 14, bubbleY + 41);
      ctx.fillText(
        `建议 ${window.min.toFixed(2)}-${window.max.toFixed(2)}m`,
        bubbleX + 14,
        bubbleY + 57,
      );
    } else {
      ctx.fillText("跟住站位，准备抱石", bubbleX + 14, bubbleY + 40);
    }
  }

  random(min, max) {
    return this.rng() * (max - min) + min;
  }

  updateSlackNeed(delta, isClipping) {
    const mode = isClipping ? "clipping" : "climbing";
    if (this.slackNeedMode !== mode) {
      this.slackNeedMode = mode;
      this.slackNeedTime = 0;
    }

    this.slackNeedTime += delta;
    if (this.slackNeedTime >= 2) {
      this.promptClimberForSlack(isClipping);
    }
  }

  clearSlackNeed() {
    this.slackNeedTime = 0;
    this.slackNeedMode = null;
  }

  promptClimberForSlack(isClipping) {
    if (this.speechCooldown > 0 || this.fall) {
      return;
    }

    const lines = isClipping
      ? ["给绳啊！", "快给！", "给一米！"]
      : ["给绳啊！", "给点！", "松一点！"];
    const text = lines[Math.floor(this.random(0, lines.length))];
    this.climberSpeech = { kind: "slack", text, time: 1.1 };
    this.speechCooldown = 2.6;
  }

  setInputState(nextState) {
    Object.entries(nextState).forEach(([key, value]) => {
      if (Object.hasOwn(apiInput, key)) {
        apiInput[key] = Boolean(value);
      }
    });
  }

  getState() {
    const slackWindow =
      this.phase === "lead"
        ? this.getDisplaySlackWindow(this.subphase)
        : { min: 0, max: 0 };

    return {
      stage: this.stage,
      phase: this.phase,
      subphase: this.subphase,
      clippedCount: this.clippedCount,
      slack: this.phase === "lead" ? this.getSlack() : 0,
      slackWindow,
      advice: this.advice,
      manualRope: this.manualRope,
      belayerX: this.belayer.x,
      belayerY: this.belayer.y,
      climber: {
        x: this.climber.x,
        y: this.climber.y,
        vx: this.climber.vx,
        vy: this.climber.vy,
      },
      fall: this.fall
        ? {
            type: this.fall.type,
            elapsed: this.fall.elapsed,
            peakForce: this.fall.peakForce ?? 0,
            catchTime: this.fall.catchTime,
            jumpApplied: this.fall.jumpApplied ?? false,
          }
        : null,
      performance: { ...this.performance },
      protectionHistory: this.protectionHistory.map((record) => ({ ...record })),
      result: this.result,
    };
  }
}

const game = new LeadBelayGame();
window.__leadBelayGame = game;
window.__leadBelayApi = {
  start: () => game.start(),
  reset: () => game.reset(),
  state: () => game.getState(),
  input: (nextState) => game.setInputState(nextState),
  action: () => game.handleAction(),
};
