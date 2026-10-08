-- Lane runner (3D, chase camera). Tap the left or right half of the screen to change lane and dodge the rocks.
-- Survive 30 seconds to win. You have three lives; a rock that hits you costs one.

local LANES = { -2.5, 0, 2.5 }
local SURVIVE = 30
local lane = 2
local player
local speed = 7

local function show()
  ui.text("score", "Dodged " .. game.score, { x = 0.05, y = 0.04, size = 0.04, color = 5 })
  ui.bar("lives", game.lives, 3, { x = 0.05, y = 0.1, w = 0.3, h = 0.025, color = 2 })
end

local function spawn_rock()
  local l = rand_int(1, 3)
  world.spawn("box", { x = LANES[l], y = 9, w = 1.4, h = 1.4, d = 1.4, vy = -speed, color = 4, solid = true, tag = "rock" })
end

function init()
  world.bounds(9, 16)
  player = world.spawn("box", { x = LANES[lane], y = -6, w = 1.2, h = 1.2, d = 1.2, color = 1, solid = true, tag = "player" })
  world.camera{ mode = "chase", follow = player }
  game.lives = 3
  timer.every(0.7, spawn_rock)
  show()
end

function update(dt)
  speed = 7 + game.time * 0.1
  if game.time >= SURVIVE then
    game.win("You made it!")
  end
end

function on_tap(x, y)
  if x < 0 then
    lane = math.max(1, lane - 1)
  else
    lane = math.min(3, lane + 1)
  end
  player.x = LANES[lane]
end

function on_collide(a, b)
  local rock
  if a.tag == "rock" and b.tag == "player" then
    rock = a
  elseif b.tag == "rock" and a.tag == "player" then
    rock = b
  end
  if not rock then
    return
  end
  rock:destroy()
  game.lives = game.lives - 1
  show()
  if game.lives <= 0 then
    game.lose("You crashed")
  end
end

function on_exit(obj)
  if obj.tag == "rock" then
    obj:destroy()
    game.score = game.score + 1
    show()
  end
end
