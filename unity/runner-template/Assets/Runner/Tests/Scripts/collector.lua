-- Collector (3D, top camera). Drag to move around the arena and collect 12 gems before the time runs out. Drones drift toward you:
-- touching one costs a life. "bot", "gem" and "drone" are models asked for in the assets; a model that is missing is drawn as a box.

local GOAL = 12
local TIME = 40
local player

local function show()
  ui.text("score", "Gems " .. game.score .. " of " .. GOAL, { x = 0.05, y = 0.04, size = 0.04, color = 5 })
  ui.text("time", math.max(0, math.ceil(TIME - game.time)), { x = 0.5, y = 0.04, size = 0.05, color = 5, align = "center" })
  ui.bar("lives", game.lives, 3, { x = 0.05, y = 0.1, w = 0.3, h = 0.025, color = 2 })
end

local function drop_gem()
  world.spawn("gem", { x = (rand() - 0.5) * (game.width - 2), y = (rand() - 0.5) * (game.height - 2), w = 0.8, h = 0.8, d = 0.8, color = 3, solid = true, tag = "gem", spin = 90 })
end

local function send_drone()
  world.spawn("drone", { x = (rand() - 0.5) * game.width, y = game.height / 2 - 1, w = 1, h = 1, d = 1, color = 2, solid = true, tag = "drone" })
end

function init()
  world.bounds(12, 12)
  world.camera{ mode = "top" }
  player = world.spawn("bot", { x = 0, y = 0, w = 1.2, h = 1.2, d = 1.2, color = 4, solid = true, tag = "player" })
  game.lives = 3
  for i = 1, 4 do
    drop_gem()
  end
  for i = 1, 3 do
    send_drone()
  end
  show()
end

function update(dt)
  for _, d in ipairs(world.find("drone")) do
    local dx = player.x - d.x
    local dy = player.y - d.y
    local length = math.sqrt(dx * dx + dy * dy) + 0.001
    d.vx = dx / length * 2.2
    d.vy = dy / length * 2.2
  end
  show()
  if game.time >= TIME then
    game.lose("Out of time")
  end
end

function on_hold(x, y)
  player.x = math.max(-game.width / 2 + 0.6, math.min(game.width / 2 - 0.6, x))
  player.y = math.max(-game.height / 2 + 0.6, math.min(game.height / 2 - 0.6, y))
end

function on_collide(a, b)
  local other
  if a.tag == "player" then
    other = b
  elseif b.tag == "player" then
    other = a
  else
    return
  end
  if other.tag == "gem" then
    other:destroy()
    game.score = game.score + 1
    show()
    if game.score >= GOAL then
      game.win("All the gems!")
    else
      drop_gem()
    end
  elseif other.tag == "drone" then
    other:destroy()
    game.lives = game.lives - 1
    send_drone()
    show()
    if game.lives <= 0 then
      game.lose("Caught")
    end
  end
end
