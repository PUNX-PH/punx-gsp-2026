-- Catcher (2D). Drag to move the basket; catch the apples and avoid the bombs. Catch 15 apples to win.
-- A bomb or a missed apple costs one of your three lives.

local TARGET = 15
local basket

local function show()
  ui.text("score", "Apples " .. game.score .. " / " .. TARGET, { x = 0.05, y = 0.04, size = 0.045, color = 5 })
  ui.bar("lives", game.lives, 3, { x = 0.05, y = 0.1, w = 0.3, h = 0.025, color = 2 })
end

local function lose_life()
  game.lives = game.lives - 1
  show()
  if game.lives <= 0 then
    game.lose("Out of lives")
  end
end

local function drop()
  local bomb = rand() < 0.25
  local kind = "apple"
  local color = 3
  if bomb then
    kind = "bomb"
    color = 4
  end
  world.spawn("sphere", { x = rand() * 7 - 3.5, y = 9, w = 0.9, h = 0.9, vy = -(3.5 + game.time * 0.08), color = color, solid = true, tag = kind })
end

function init()
  world.bounds(9, 16)
  world.camera{ mode = "side2d" }
  basket = world.spawn("box", { x = 0, y = -6.5, w = 2, h = 0.8, color = 1, solid = true, tag = "basket" })
  game.lives = 3
  timer.every(0.8, drop)
  show()
end

function on_hold(x, y)
  basket.x = math.max(-3.5, math.min(3.5, x))
end

function on_collide(a, b)
  local item
  if a.tag == "basket" then
    item = b
  elseif b.tag == "basket" then
    item = a
  end
  if not item then
    return
  end
  item:destroy()
  if item.tag == "apple" then
    game.score = game.score + 1
    show()
    if game.score >= TARGET then
      game.win("All caught!")
    end
  elseif item.tag == "bomb" then
    lose_life()
  end
end

function on_exit(obj)
  if obj.tag == "apple" then
    lose_life()
  end
  if obj.tag ~= "basket" then
    obj:destroy()
  end
end
