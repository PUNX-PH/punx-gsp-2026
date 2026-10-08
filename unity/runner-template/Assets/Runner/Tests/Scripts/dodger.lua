-- Dodger (2D, endless). Hold and drag to steer under the falling rocks; they get faster. Survive 45 seconds to win.
-- One hit and it is over. The score is the seconds you lasted.

local SURVIVE = 45
local player

local function drop()
  local size = 0.8 + rand() * 1.2
  world.spawn("sphere", { x = rand() * 8 - 4, y = 9, w = size, h = size, d = 0.05, vy = -(4 + game.time * 0.12), color = 4, solid = true, tag = "rock" })
end

function init()
  world.bounds(9, 16)
  world.camera{ mode = "side2d" }
  player = world.spawn("box", { x = 0, y = -6.5, w = 1, h = 1, d = 0.05, color = 1, solid = true, tag = "player" })
  timer.every(0.45, drop)
end

function update(dt)
  game.score = math.floor(game.time)
  ui.text("score", "Seconds " .. game.score .. " / " .. SURVIVE, { x = 0.05, y = 0.04, size = 0.045, color = 5 })
  if game.time >= SURVIVE then
    game.win("You lasted!")
  end
end

function on_hold(x, y)
  player.x = math.max(-4, math.min(4, x))
end

function on_collide(a, b)
  if a.tag == "player" or b.tag == "player" then
    game.lose("Hit by a rock")
  end
end

function on_exit(obj)
  if obj.tag == "rock" then
    obj:destroy()
  end
end
