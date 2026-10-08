-- Shooter (top-down 2D). Drag to move your ship; it fires on its own. Shoot 20 aliens to win.
-- An alien that reaches the bottom or hits your ship costs one of your three lives.

local TARGET = 20
local ship

local function show()
  ui.text("score", "Aliens " .. game.score .. " / " .. TARGET, { x = 0.05, y = 0.04, size = 0.045, color = 5 })
  ui.bar("lives", game.lives, 3, { x = 0.05, y = 0.1, w = 0.3, h = 0.025, color = 2 })
end

local function lose_life()
  game.lives = game.lives - 1
  show()
  if game.lives <= 0 then
    game.lose("Overrun")
  end
end

-- Returns the object with the first tag and the object with the second tag, whichever order they came in.
local function pair(a, b, first, second)
  if a.tag == first and b.tag == second then
    return a, b
  end
  if a.tag == second and b.tag == first then
    return b, a
  end
end

local function fire()
  world.spawn("box", { x = ship.x, y = ship.y + 0.9, w = 0.25, h = 0.7, d = 0.05, vy = 14, color = 3, solid = true, tag = "shot", life = 1.5 })
end

local function invade()
  world.spawn("cone", { x = rand() * 7 - 3.5, y = 9, w = 1, h = 1, d = 0.05, vy = -(2.5 + game.time * 0.05), color = 4, solid = true, tag = "alien" })
end

function init()
  world.bounds(9, 16)
  world.camera{ mode = "top2d" }
  ship = world.spawn("box", { x = 0, y = -6.5, w = 1, h = 1, d = 0.05, color = 1, solid = true, tag = "ship" })
  game.lives = 3
  timer.every(0.25, fire)
  timer.every(0.9, invade)
  show()
end

function on_hold(x, y)
  ship.x = math.max(-4, math.min(4, x))
end

function on_collide(a, b)
  local shot, alien = pair(a, b, "shot", "alien")
  if shot then
    shot:destroy()
    alien:destroy()
    game.score = game.score + 1
    show()
    if game.score >= TARGET then
      game.win("Earth is safe!")
    end
    return
  end
  local _, hitter = pair(a, b, "ship", "alien")
  if hitter then
    hitter:destroy()
    lose_life()
  end
end

function on_exit(obj)
  if obj.tag == "alien" then
    lose_life()
  end
  obj:destroy()
end
