// The rules phase: queued events are matched against the rules in written order, conditions are read from the counters, actions run at once.
import type { Engine, Obj, Raised } from "./sim";
import { ENGINE_CAPS, type Action, type Condition, type GameEvent } from "./spec";

const CLAMP = 1_000_000;
const clamp = (n: number): number => Math.max(-CLAMP, Math.min(CLAMP, n));

function compare(left: number, c: Condition): boolean {
  switch (c.op) {
    case "<": return left < c.value;
    case "<=": return left <= c.value;
    case "==": return left === c.value;
    case ">=": return left >= c.value;
    default: return left > c.value;
  }
}

/** Does a rule's event match a raised one? Tick and counterReaches events are raised for one rule only. */
function matches(rule: GameEvent, ruleIndex: number, r: Raised): boolean {
  if (rule.type !== r.event.type) return false;
  if (rule.type === "tick" || rule.type === "counterReaches") return r.rule === ruleIndex;
  if (rule.type === "exitBounds") return r.event.type === "exitBounds" && r.event.entity === rule.entity;
  return true;
}

/** A collide event matches in either order; the rule's `a` and `b` are then bound to the right objects. */
function collideBinding(rule: GameEvent, r: Raised): { a?: Obj; b?: Obj } | null {
  if (rule.type !== "collide" || r.event.type !== "collide") return {};
  if (r.event.a === rule.a && r.event.b === rule.b) return { a: r.a, b: r.b };
  if (r.event.a === rule.b && r.event.b === rule.a) return { a: r.b, b: r.a };
  return null;
}

function perform(engine: Engine, action: Action, r: Raised, bound: { a?: Obj; b?: Obj }): void {
  const counters = engine.counters;
  switch (action.type) {
    case "add":
      counters[action.counter] = clamp(counters[action.counter] + action.n);
      engine.checkReaches();
      break;
    case "set":
      counters[action.counter] = clamp(action.n);
      engine.checkReaches();
      break;
    case "destroy": {
      const target = action.target === "a" ? bound.a : action.target === "b" ? bound.b : (r.self ?? engine.hero());
      if (target) target.alive = false;
      break;
    }
    case "spawn":
      engine.spawnAction(action.entity);
      break;
    case "bounce": {
      const target = action.target === "a" ? bound.a : bound.b;
      if (target) target.vy = -target.vy;
      break;
    }
    case "win":
      engine.end("won");
      break;
    case "lose":
      engine.end("lost");
      break;
    case "speedUp":
      engine.speedUpTotal = Math.min(300, engine.speedUpTotal + action.percent);
      break;
  }
}

export function runRules(engine: Engine): void {
  engine.checkReaches();
  const rules = engine.spec.rules;
  for (let i = 0; i < engine.queue.length; i++) {
    const raised = engine.queue[i];
    for (let k = 0; k < rules.length; k++) {
      const rule = rules[k];
      if (!matches(rule.on, k, raised)) continue;
      const bound = collideBinding(rule.on, raised);
      if (!bound) continue;
      if (rule.when && !rule.when.every((c) => compare(engine.counters[c.counter], c))) continue;
      for (const action of rule.do) {
        if (++engine.actions > ENGINE_CAPS.actionsPerStep) {
          engine.end("lost");
          return;
        }
        perform(engine, action, raised, bound);
      }
    }
  }
}
