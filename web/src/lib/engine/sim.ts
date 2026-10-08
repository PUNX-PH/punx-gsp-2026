// The TypeScript simulator: the engine's semantics (docs/superpowers/notes/engine-semantics.md) run headlessly, deterministically, in integers.
// The C# engine implements the same steps; shared fixtures keep them equal. Phases per step: input, controls, moves, spawns, collisions,
// rules, cleanup, ends.
import { collides } from "./collide";
import { xorshift32 } from "./rng";
import { runRules } from "./rules";
import { ENGINE_CAPS, type Behavior, type Entity, type GameEvent, type GameSpec } from "./spec";

export interface SimInput {
  /** The input was newly pressed this step. */
  tap: boolean;
  /** The input is held this step. */
  hold: boolean;
}
export type Status = "running" | "won" | "lost";
export interface SimEntity {
  id: number;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
}
export interface SimState {
  step: number;
  counters: Record<string, number>;
  entities: SimEntity[];
  status: Status;
}
export interface Sim {
  step(input: SimInput): void;
  state(): SimState;
}

/** A live object. */
export interface Obj extends SimEntity {
  w: number;
  h: number;
  spawner: boolean;
  birth: number;
  baseX: number;
  baseY: number;
  exited: boolean;
  gravSign: 1 | -1;
  lane: number;
  laneDir: 1 | -1;
  switching: { from: number; to: number; k: number; n: number } | null;
  cooldown: number;
  nextSpawn: number;
}

/** What the rules phase reads: an event, the objects it concerns, and (for tick and counterReaches) the one rule it is for. */
export interface Raised {
  event: GameEvent;
  a?: Obj;
  b?: Obj;
  self?: Obj;
  rule?: number;
}

export const toSteps = (ms: number): number => Math.max(1, Math.floor((ms * 60 + 500) / 1000));
const tdiv = (a: number, b: number): number => Math.trunc(a / b);

export class Engine {
  step = 0;
  status: Status = "running";
  counters: Record<string, number>;
  objs: Obj[] = [];
  queue: Raised[] = [];
  speedUpTotal = 0;
  reached: boolean[];
  actions = 0;
  private nextId = 1;
  private rng: () => number;
  private prevHold = false;
  private spawnSteps: number[] = [];
  private templates: Set<string>;
  private firstProjectile: string | null;

  constructor(readonly spec: GameSpec) {
    this.counters = { ...spec.counters };
    this.rng = xorshift32(spec.seed);
    this.reached = spec.rules.map(() => false);
    const targets = new Set<string>();
    for (const e of Object.values(spec.entities)) for (const b of e.behaviors) if (b.type === "spawn") targets.add(b.entity);
    for (const r of spec.rules) for (const a of r.do) if (a.type === "spawn") targets.add(a.entity);
    this.firstProjectile = Object.keys(spec.entities).find((n) => spec.entities[n].role === "projectile") ?? null;
    if (this.firstProjectile) targets.add(this.firstProjectile);
    this.templates = targets;
    for (const [name, e] of Object.entries(spec.entities)) if (e.role === "hero" || !targets.has(name)) this.objs.push(this.make(name, e.x, e.y, 0, 0, false));
  }

  hero(): Obj {
    return this.objs.find((o) => this.spec.entities[o.type].role === "hero")!;
  }

  def(o: Obj): Entity {
    return this.spec.entities[o.type];
  }

  private flag(o: Obj, type: Behavior["type"]): boolean {
    return this.def(o).behaviors.some((b) => b.type === type);
  }
  private has(o: Obj, does: string): boolean {
    return this.def(o).behaviors.some((b) => b.type === "control" && b.does === does);
  }

  /** The speed of a spawned object: the spawner's own speed when it has one, scaled by percent. */
  private scaled(speed: number, pct: number): number {
    return tdiv(speed * (100 + pct), 100);
  }

  private laneAxisSpan(): { axis: "x" | "y"; span: number } {
    return this.spec.world.camera === "side" ? { axis: "y", span: this.spec.world.height } : { axis: "x", span: this.spec.world.width };
  }
  private laneCoord(i: number, count: number, size: number): number {
    return tdiv(this.laneAxisSpan().span * (2 * i + 1), 2 * count) - tdiv(size, 2);
  }

  make(type: string, x: number, y: number, birth: number, speedOverride: number, ramped: boolean, pct = 0): Obj {
    const e = this.spec.entities[type];
    const o: Obj = {
      id: this.nextId++, type, x, y, vx: 0, vy: 0, alive: true, w: e.w, h: e.h, spawner: e.behaviors.some((b) => b.type === "spawn"),
      birth, baseX: x, baseY: y, exited: false, gravSign: 1, lane: 0, laneDir: 1, switching: null, cooldown: 0, nextSpawn: 0,
    };
    const speedPct = ramped || speedOverride >= 0 ? pct : 0;
    for (const b of e.behaviors) {
      const s = (v: number) => (speedOverride > 0 ? this.scaled(speedOverride, speedPct) : this.scaled(v, speedPct));
      if (b.type === "move") {
        const v = s(b.speed);
        if (b.dir === "left") o.vx = -v;
        else if (b.dir === "right") o.vx = v;
        else if (b.dir === "up") o.vy = v;
        else o.vy = -v;
      } else if (b.type === "fall") o.vy = -s(b.speed);
      else if (b.type === "lane") {
        o.lane = b.count >> 1;
        const { axis } = this.laneAxisSpan();
        const c = this.laneCoord(o.lane, b.count, axis === "x" ? e.w : e.h);
        if (axis === "x") o.x = o.baseX = c;
        else o.y = o.baseY = c;
      } else if (b.type === "spawn") o.nextSpawn = birth + toSteps(b.intervalMs);
    }
    return o;
  }

  private rampPercent(percent: number): number {
    const d = this.spec.difficulty;
    const ramp = toSteps(d.rampMs);
    return d.rampMs === 0 ? 0 : tdiv(Math.min(this.step, ramp) * percent, ramp);
  }

  raise(r: Raised): void {
    this.queue.push(r);
  }

  /** Raises counterReaches events for counters that have just crossed their value. */
  checkReaches(): void {
    this.spec.rules.forEach((rule, i) => {
      if (rule.on.type !== "counterReaches") return;
      const now = this.counters[rule.on.counter] >= rule.on.value;
      if (now && !this.reached[i]) {
        this.reached[i] = true;
        this.raise({ event: rule.on, rule: i });
      } else if (!now) this.reached[i] = false;
    });
  }

  /** Makes one object of a template at its own start position (the `spawn` action). Silently skipped at the live-object cap. */
  spawnAction(type: string): void {
    if (this.live() >= ENGINE_CAPS.liveObjects) return;
    const e = this.spec.entities[type];
    this.objs.push(this.make(type, e.x, e.y, this.step, 0, false));
  }

  live(): number {
    return this.objs.filter((o) => o.alive && !o.spawner).length;
  }

  end(status: "won" | "lost"): void {
    if (this.status === "running") this.status = status;
  }

  run(input: SimInput): void {
    if (this.status !== "running") return;
    this.step++;
    this.queue = [];
    this.actions = 0;
    this.phaseInput(input);
    this.phaseControls(input);
    this.phaseMoves(input);
    this.phaseSpawns();
    this.phaseCollisions();
    runRules(this);
    this.phaseCleanup();
    this.phaseEnds();
  }

  private phaseInput(input: SimInput): void {
    if (Object.hasOwn(this.counters, "time")) this.counters.time = tdiv(this.step, 60);
    if (this.step === 1) this.raise({ event: { type: "start" } });
    if (input.tap) this.raise({ event: { type: "tap" } });
    if (input.hold) this.raise({ event: { type: "hold" } });
    if (this.prevHold && !input.hold) this.raise({ event: { type: "release" } });
    this.prevHold = input.hold;
    this.spec.rules.forEach((rule, i) => {
      if (rule.on.type === "tick" && this.step % toSteps(rule.on.everyMs) === 0) this.raise({ event: rule.on, rule: i });
    });
  }

  private thrusting = new Set<number>();

  private phaseControls(input: SimInput): void {
    this.thrusting.clear();
    for (const o of [...this.objs]) {
      if (!o.alive || o.spawner) continue;
      if (o.cooldown > 0) o.cooldown--;
      for (const b of this.def(o).behaviors) {
        if (b.type !== "control") continue;
        const on = b.on === "tap" ? input.tap : input.hold;
        if (!on) continue;
        if (b.does === "jump") {
          if (o.y <= this.def(o).y && o.vy <= 0) o.vy = b.power;
        } else if (b.does === "flap") o.vy = b.power;
        else if (b.does === "flip") o.gravSign = o.gravSign === 1 ? -1 : 1;
        else if (b.does === "thrust") this.thrusting.add(o.id);
        else if (b.does === "fire") {
          if (o.cooldown === 0 && this.firstProjectile && this.live() < ENGINE_CAPS.liveObjects) {
            const p = this.make(this.firstProjectile, o.x, o.y, this.step, 0, false);
            if (b.power !== 0) p.vy = b.power;
            this.objs.push(p);
            o.cooldown = 10;
          }
        } else if (b.does === "switchLane") {
          const lane = this.def(o).behaviors.find((x) => x.type === "lane");
          if (lane && lane.type === "lane" && !o.switching) {
            if (o.lane === 0) o.laneDir = 1;
            else if (o.lane === lane.count - 1) o.laneDir = -1;
            const target = o.lane + o.laneDir;
            const { axis } = this.laneAxisSpan();
            const size = axis === "x" ? o.w : o.h;
            o.switching = { from: axis === "x" ? o.x : o.y, to: this.laneCoord(target, lane.count, size), k: 0, n: toSteps(lane.switchMs) };
          }
        }
      }
    }
  }

  private phaseMoves(input: SimInput): void {
    const w = this.spec.world;
    const scroll = tdiv(w.scroll, 60);
    for (const o of this.objs) {
      if (!o.alive || o.spawner) continue;
      const e = this.def(o);
      const heavy = this.has(o, "jump") || this.has(o, "flap") || this.has(o, "flip") || this.has(o, "thrust");
      if (heavy) {
        if (this.thrusting.has(o.id)) {
          const t = e.behaviors.find((b) => b.type === "control" && b.does === "thrust");
          o.vy += t && t.type === "control" ? tdiv(t.power, 60) : 0;
        } else o.vy -= tdiv(w.gravity, 60) * o.gravSign;
      }
      for (const b of e.behaviors) {
        if (b.type !== "follow") continue;
        let best: Obj | null = null;
        let bestD = Infinity;
        for (const t of this.objs) {
          if (!t.alive || t.type !== b.target) continue;
          const d = Math.abs(t.x - o.x) + Math.abs(t.y - o.y);
          if (d < bestD) {
            best = t;
            bestD = d;
          }
        }
        if (best) {
          const step = tdiv(b.speed, 60);
          o.x += Math.sign(best.x - o.x) * Math.min(step, Math.abs(best.x - o.x));
          o.y += Math.sign(best.y - o.y) * Math.min(step, Math.abs(best.y - o.y));
        }
      }
      o.x += tdiv(o.vx, 60);
      o.y += tdiv(o.vy, 60);
      if (e.role === "platform" || e.role === "hazard" || e.role === "pickup") {
        if (w.camera === "side") o.x -= scroll;
        else o.y -= scroll;
      }
      if (this.has(o, "jump") && o.y <= e.y && o.vy <= 0) {
        o.y = e.y;
        o.vy = 0;
      }
      for (const b of e.behaviors) {
        if (b.type !== "oscillate") continue;
        const P = toSteps(b.periodMs);
        const h = 4 * ((this.step - o.birth) % P);
        const A = b.amplitude;
        const offset = h <= P ? tdiv(A * h, P) : h <= 3 * P ? tdiv(A * (2 * P - h), P) : tdiv(A * (h - 4 * P), P);
        if (b.axis === "x") o.x = o.baseX + offset;
        else o.y = o.baseY + offset;
      }
      if (o.switching) {
        const s = o.switching;
        s.k++;
        const pos = s.from + tdiv((s.to - s.from) * s.k, s.n);
        if (this.laneAxisSpan().axis === "x") o.x = pos;
        else o.y = pos;
        if (s.k >= s.n) {
          o.lane += o.laneDir;
          o.switching = null;
        }
      }
    }
    void input;
  }

  private phaseSpawns(): void {
    const w = this.spec.world;
    this.spawnSteps = this.spawnSteps.filter((s) => s > this.step - 60);
    for (const o of [...this.objs]) {
      if (!o.alive || !o.spawner || this.step < o.nextSpawn) continue;
      const b = this.def(o).behaviors.find((x) => x.type === "spawn");
      if (!b || b.type !== "spawn") continue;
      const sp = b.ramp ? this.rampPercent(this.spec.difficulty.speedPercent) : 0;
      const pct = Math.min(300, sp + this.speedUpTotal);
      const shrink = b.ramp ? this.rampPercent(this.spec.difficulty.spawnPercent) : 0;
      o.nextSpawn = this.step + Math.max(1, tdiv(toSteps(b.intervalMs) * (100 - shrink), 100));
      if (this.live() >= ENGINE_CAPS.liveObjects || this.spawnSteps.length >= ENGINE_CAPS.spawnsPerSecond) continue;
      const t = this.spec.entities[b.entity];
      const side = w.camera === "side";
      const span = side ? w.height : w.width;
      const along = (size: number) => (span - size < 0 ? 0 : this.rng() % (span - size + 1));
      let x: number;
      let y: number;
      if (b.pattern === "stream") {
        x = o.x;
        y = o.y;
      } else if (b.pattern === "rain") {
        y = w.height;
        x = w.width - t.w < 0 ? 0 : this.rng() % (w.width - t.w + 1);
      } else {
        let pos: number;
        if (b.pattern === "random") pos = along(side ? t.h : t.w);
        else if (b.pattern === "wave") {
          const ph = this.step % 120;
          const v = ph <= 60 ? ph : 120 - ph;
          pos = tdiv(Math.max(0, span - (side ? t.h : t.w)) * v, 60);
        } else {
          const hero = this.hero();
          const lane = this.def(hero).behaviors.find((q) => q.type === "lane");
          const count = lane && lane.type === "lane" ? lane.count : 3;
          pos = this.laneCoord(this.rng() % count, count, side ? t.h : t.w);
        }
        if (side) {
          x = w.width;
          y = pos;
        } else {
          x = pos;
          y = w.height;
        }
      }
      this.objs.push(this.make(b.entity, x, y, this.step, b.speed, b.ramp, pct));
      this.spawnSteps.push(this.step);
    }
  }

  private phaseCollisions(): void {
    const list = this.objs.filter((o) => o.alive && !o.spawner);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (collides(this.def(list[i]).collider, list[i], this.def(list[j]).collider, list[j])) {
          this.raise({ event: { type: "collide", a: list[i].type, b: list[j].type }, a: list[i], b: list[j] });
        }
      }
    }
    const f = this.spec.world;
    for (const o of list) {
      if (o.exited || this.def(o).role === "hero") continue;
      if (o.x + o.w < 0 || o.x > f.width || o.y + o.h < 0 || o.y > f.height) {
        o.exited = true;
        this.raise({ event: { type: "exitBounds", entity: o.type }, self: o });
      }
    }
  }

  private phaseCleanup(): void {
    const f = this.spec.world;
    for (const o of this.objs) {
      if (!o.alive || o.spawner) continue;
      const life = this.def(o).behaviors.find((b) => b.type === "lifetime");
      if (life && life.type === "lifetime" && this.step - o.birth >= toSteps(life.ms)) o.alive = false;
      if (this.def(o).role !== "hero" && (o.x + o.w < -o.w || o.x > f.width + o.w || o.y + o.h < -o.h || o.y > f.height + o.h)) o.alive = false;
    }
    this.objs = this.objs.filter((o) => o.alive);
  }

  private phaseEnds(): void {
    if (this.status !== "running") return;
    const ends = this.spec.ends;
    if (Object.hasOwn(this.counters, "lives") && this.counters.lives <= 0) this.end("lost");
    else if (ends.scoreToWin > 0 && Object.hasOwn(this.counters, "score") && this.counters.score >= ends.scoreToWin) this.end("won");
    else if (ends.timeLimitMs > 0 && this.step >= toSteps(ends.timeLimitMs)) this.end(ends.winOnTime ? "won" : "lost");
  }

  snapshot(): SimState {
    return {
      step: this.step,
      counters: { ...this.counters },
      entities: this.objs.filter((o) => o.alive && !o.spawner).map((o) => ({ id: o.id, type: o.type, x: o.x, y: o.y, vx: o.vx, vy: o.vy, alive: true })),
      status: this.status,
    };
  }
}

export function createSim(spec: GameSpec): Sim {
  const engine = new Engine(spec);
  return { step: (input) => engine.run(input), state: () => engine.snapshot() };
}
