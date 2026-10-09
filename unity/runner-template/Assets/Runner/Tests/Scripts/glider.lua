-- Glider (3D, side camera). Hold to climb and let go to sink: fly through 8 rings and keep clear of the storm clouds.
-- A cloud costs one of your three lives. "glider", "ring" and "cloud" are models asked for in the assets; a model that is missing
-- is drawn as a box, so the game plays either way.

local TARGET = 8
local glider

local function show()
  ui.text("score", "Rings " .. game.score .. " of " .. TARGET, { x = 0.05, y = 0.04, size = 0.04, color = 5 })
  ui.bar("lives", game.lives, 3, { x = 0.05, y = 0.1, w = 0.3, h = 0.025, color = 2 })
end

local function spawn_ring()
  world.spawn("ring", { x = 7, y = (rand() - 0.5) * 8, w = 1.8, h = 1.8, d = 0.6, vx = -3.5, color = 3, solid = true, tag = "ring" })
end

local function spawn_cloud()
  world.spawn("cloud", { x = 7, y = (rand() - 0.5) * 9, w = 2.2, h = 1.4, d = 1.4, vx = -4, color = 2, solid = true, tag = "cloud" })
end

function init()
  world.bounds(12, 12)
  world.camera{ mode = "side" }
  game.lives = 3
  glider = world.spawn("glider", { x = -3, y = 0, w = 1.6, h = 0.8, d = 1.2, color = 4, solid = true, tag = "glider" })
  timer.every(1.6, spawn_ring)
  timer.every(1.1, spawn_cloud)
  show()
end

function update(dt)
  if input.down then
    glider.vy = math.min(glider.vy + 30 * dt, 6)
  else
    glider.vy = math.max(glider.vy - 20 * dt, -5)
  end
  glider.y = math.max(-5, math.min(5, glider.y))
end

function on_collide(a, b)
  local other
  if a.tag == "glider" then
    other = b
  elseif b.tag == "glider" then
    other = a
  else
    return
  end
  other:destroy()
  if other.tag == "ring" then
    game.score = game.score + 1
    show()
    if game.score >= TARGET then
      game.win("Through every ring!")
    end
  elseif other.tag == "cloud" then
    game.lives = game.lives - 1
    show()
    if game.lives <= 0 then
      game.lose("Lost in the storm")
    end
  end
end

function on_exit(obj)
  if obj.tag ~= "glider" then
    obj:destroy()
  end
end
