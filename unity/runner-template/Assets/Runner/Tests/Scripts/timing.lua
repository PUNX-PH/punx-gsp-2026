-- Timing (2D). A marker slides along the bar: tap when it is inside the green zone. Ten hits win.
-- A miss costs one of your three lives. The marker speeds up and the zone shrinks as you score.

local TARGET = 10
local marker
local zone
local direction = 1

local function show()
  ui.text("score", "Hits " .. game.score .. " / " .. TARGET, { x = 0.5, y = 0.05, size = 0.05, align = "center", color = 5 })
  ui.bar("lives", game.lives, 3, { x = 0.35, y = 0.12, w = 0.3, h = 0.03, color = 2 })
end

function init()
  world.bounds(9, 16)
  world.camera{ mode = "side2d" }
  world.spawn("box", { x = 0, y = 0, z = 1, w = 8, h = 0.4, d = 0.05, color = 2, tag = "track" })
  zone = world.spawn("box", { x = 0, y = 0, z = 0.5, w = 1.2, h = 0.9, d = 0.05, color = 4, tag = "zone" })
  marker = world.spawn("box", { x = -4, y = 0, z = 0, w = 0.3, h = 1.4, d = 0.05, color = 5, tag = "marker" })
  game.lives = 3
  show()
end

function update(dt)
  local speed = 5 + game.score * 0.6
  marker.x = marker.x + direction * speed * dt
  if marker.x > 4 then
    marker.x = 4
    direction = -1
  elseif marker.x < -4 then
    marker.x = -4
    direction = 1
  end
end

function on_tap(x, y)
  if math.abs(marker.x - zone.x) <= zone.w / 2 then
    game.score = game.score + 1
    zone.x = rand() * 6 - 3
    zone.w = math.max(0.8, 1.2 - game.score * 0.04)
    show()
    if game.score >= TARGET then
      game.win("Perfect timing!")
    end
  else
    game.lives = game.lives - 1
    show()
    if game.lives <= 0 then
      game.lose("Too many misses")
    end
  end
end
