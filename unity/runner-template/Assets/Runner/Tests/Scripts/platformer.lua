-- Platformer (2D). Hold to run toward your finger, tap to jump. Collect all 5 coins to win; falling off the bottom loses.
-- The world has no floors of its own, so update() lands the hero on a platform by hand.

local hero
local on_ground = false
local platforms = {}

local function platform(x, y, w)
  platforms[#platforms + 1] = world.spawn("box", { x = x, y = y, w = w, h = 0.6, d = 0.05, color = 2, tag = "platform" })
end

local function coin(x, y)
  world.spawn("sphere", { x = x, y = y, w = 0.6, h = 0.6, d = 0.05, color = 3, solid = true, tag = "coin" })
end

function init()
  world.bounds(9, 16)
  world.gravity(28)
  world.camera{ mode = "side2d" }
  hero = world.spawn("box", { x = -3, y = -2, w = 0.8, h = 1.2, d = 0.05, color = 1, gravity = true, solid = true, tag = "hero" })
  platform(-3, -4, 4)
  platform(0, -2, 3)
  platform(3, 0, 3)
  platform(0, 2, 3)
  platform(-3, 4, 4)
  coin(0, -1.2)
  coin(3, 0.8)
  coin(0, 2.8)
  coin(-3, 4.8)
  coin(-3, -3.2)
end

function update(dt)
  on_ground = false
  if hero.vy <= 0 then
    local feet = hero.y - hero.h / 2
    for _, p in ipairs(platforms) do
      local top = p.y + p.h / 2
      if math.abs(hero.x - p.x) < (p.w + hero.w) / 2 and feet <= top and feet >= top - 0.6 then
        hero.y = top + hero.h / 2
        hero.vy = 0
        on_ground = true
      end
    end
  end
  if not input.down then
    hero.vx = 0
  end
  if hero.y < -9 then
    game.lose("You fell")
  end
end

function on_hold(x, y)
  hero.vx = math.max(-5, math.min(5, (x - hero.x) * 4))
end

function on_tap(x, y)
  if on_ground then
    hero.vy = 12
  end
end

function on_collide(a, b)
  local c
  if a.tag == "coin" and b.tag == "hero" then
    c = a
  elseif b.tag == "coin" and a.tag == "hero" then
    c = b
  end
  if c then
    c:destroy()
    game.score = game.score + 1
    ui.text("score", "Coins " .. game.score .. " / 5", { x = 0.05, y = 0.04, size = 0.045, color = 5 })
    if game.score >= 5 then
      game.win("All the coins!")
    end
  end
end
