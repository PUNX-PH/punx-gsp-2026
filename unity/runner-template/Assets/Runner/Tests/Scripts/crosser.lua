-- Crosser (3D, top camera). Tap to hop forward one row; drag sideways to steer. Cross the six roads to the far bank and win.
-- A car that hits you costs one of your three lives and sends you back to the start. "frog" and "car" are models asked for in
-- the assets; a model that is missing is drawn as a box, so the game plays either way.

local ROWS = 6
local ROW_H = 2.4
local START_Y = -9
local player
local row = 0

local function lane_y(i)
  return START_Y + i * ROW_H
end

local function show()
  ui.text("score", "Roads " .. math.min(row, ROWS) .. " of " .. ROWS, { x = 0.05, y = 0.04, size = 0.04, color = 5 })
  ui.bar("lives", game.lives, 3, { x = 0.05, y = 0.1, w = 0.3, h = 0.025, color = 2 })
end

local function spawn_car(i)
  local dir = 1
  local x = -game.width / 2 - 2
  if i % 2 == 0 then
    dir = -1
    x = game.width / 2 + 2
  end
  world.spawn("car", { x = x, y = lane_y(i), w = 2.2, h = 1.2, d = 1.1, vx = dir * (2.5 + i * 0.6), color = 2 + i % 3, solid = true, tag = "car" })
end

local function back_to_start()
  row = 0
  player.x = 0
  player.y = START_Y
end

function init()
  world.bounds(12, 24)
  -- the roads: flat dark boxes under the cars (not solid, so nothing hits them)
  for i = 1, ROWS do
    world.spawn("box", { x = 0, y = lane_y(i), w = 12, h = ROW_H - 0.3, d = 0.05, color = 1 })
  end
  player = world.spawn("frog", { x = 0, y = START_Y, w = 1, h = 1, d = 1, color = 4, solid = true, tag = "player" })
  world.camera{ mode = "top", follow = player }
  game.lives = 3
  for i = 1, ROWS do
    timer.every(1.6 + i * 0.3, function() spawn_car(i) end)
  end
  show()
end

function on_tap(x, y)
  row = row + 1
  player.y = START_Y + row * ROW_H
  show()
  if row > ROWS then
    game.win("You made it across!")
  end
end

function on_drag(x, y, dx, dy)
  player.x = math.max(-5, math.min(5, player.x + dx))
end

function on_collide(a, b)
  if not (a.tag == "player" or b.tag == "player") then
    return
  end
  game.lives = game.lives - 1
  back_to_start()
  show()
  if game.lives <= 0 then
    game.lose("Flattened")
  end
end

function on_exit(obj)
  if obj.tag == "car" then
    obj:destroy()
  end
end
