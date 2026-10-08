-- Flier (2D). Tap to flap and fly through the gaps between the pipes. Pass 10 pipes to win; touching a pipe or the edge loses.

local TARGET = 10
local GAP = 5.2
local bird

local function show()
  ui.text("score", "Pipes " .. game.score .. " / " .. TARGET, { x = 0.5, y = 0.05, size = 0.05, align = "center", color = 5 })
end

local function spawn_pipes()
  local center = rand() * 6 - 3
  local top = center + GAP / 2
  local bottom = center - GAP / 2
  world.spawn("box", { x = 6, y = (top + 10) / 2, w = 1.6, h = 10 - top, vx = -3.2, color = 3, solid = true, tag = "pipe" })
  world.spawn("box", { x = 6, y = (bottom - 10) / 2, w = 1.6, h = bottom + 10, vx = -3.2, color = 3, solid = true, tag = "pipe_low" })
end

function init()
  world.bounds(9, 16)
  world.gravity(24)
  world.camera{ mode = "side2d" }
  bird = world.spawn("sphere", { x = -2, y = 0, w = 0.9, h = 0.9, color = 2, gravity = true, solid = true, tag = "bird" })
  timer.every(1.5, spawn_pipes)
  show()
end

function update(dt)
  if bird.y < -8 or bird.y > 8 then
    game.lose("You hit the edge")
  end
end

function on_tap()
  bird.vy = 8.5
end

function on_collide(a, b)
  if a.tag == "bird" or b.tag == "bird" then
    game.lose("You hit a pipe")
  end
end

function on_exit(obj)
  if obj.tag == "bird" then
    return
  end
  if obj.tag == "pipe_low" then
    game.score = game.score + 1
    show()
    if game.score >= TARGET then
      game.win("You flew through!")
    end
  end
  obj:destroy()
end
