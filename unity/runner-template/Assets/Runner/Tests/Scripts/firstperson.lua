-- First-person shooter (3D, first-person camera). You strafe along a rail on your own; hold the pointer to turn toward it and fire. Hit 15 targets in 45 seconds.
-- "target" is a model asked for in the assets; a model that is missing is drawn as a box, so the game plays either way.
-- The first camera looks along the follow object's angle: facing (-sin a, cos a) for an angle a in degrees. Where the pointer is (input.x, input.y)
-- is a point ahead of you in the view, to the left or right of the middle, so turning toward it turns the view.

local GOAL = 15
local TIME = 45
local me
local last_shot = -1

local function show()
  ui.text("score", "Hits " .. game.score .. " of " .. GOAL, { x = 0.05, y = 0.04, size = 0.04, color = 5 })
  ui.text("time", math.max(0, math.ceil(TIME - game.time)), { x = 0.5, y = 0.04, size = 0.05, color = 5, align = "center" })
  ui.text("sight", "+", { x = 0.5, y = 0.47, size = 0.06, color = 5, align = "center" })
end

local function pop_target()
  if world.count("target") >= 6 then
    return
  end
  local ahead = me.y + 8 + rand() * 10
  world.spawn("target", { x = (rand() - 0.5) * 14, y = ahead, z = 1.1, w = 1.4, h = 1.4, d = 1.6, vx = (rand() - 0.5) * 3, color = 2, solid = true, tag = "target", life = 5 })
end

local function shoot()
  local a = math.rad(me.angle)
  world.spawn("sphere", { x = me.x, y = me.y, z = 1.4, w = 0.3, h = 0.3, d = 0.3, vx = -math.sin(a) * 30, vy = math.cos(a) * 30, color = 3, solid = true, tag = "shot", life = 1.5 })
end

function init()
  world.bounds(20, 40)
  me = world.spawn("box", { x = 0, y = -16, z = 0, w = 0.6, h = 0.6, d = 0.6, color = 4, tag = "me" })
  world.camera{ mode = "first", follow = me }
  for i = 1, 3 do
    pop_target()
  end
  timer.every(0.9, pop_target)
  show()
end

function update(dt)
  -- strafe back and forth along the rail
  me.x = math.sin(game.time * 0.7) * 6
  if input.down then
    local want = math.deg(math.atan2(input.x - me.x, input.y - me.y) * -1)
    local diff = (want - me.angle + 540) % 360 - 180
    me.angle = me.angle + math.max(-80 * dt, math.min(80 * dt, diff))
    me.angle = math.max(-60, math.min(60, me.angle))
    if game.time - last_shot >= 0.25 then
      last_shot = game.time
      shoot()
    end
  end
  show()
  if game.time >= TIME then
    game.lose("Out of time")
  end
end

function on_collide(a, b)
  local shot, target
  if a.tag == "shot" and b.tag == "target" then
    shot, target = a, b
  elseif b.tag == "shot" and a.tag == "target" then
    shot, target = b, a
  else
    return
  end
  shot:destroy()
  target:destroy()
  game.score = game.score + 1
  show()
  if game.score >= GOAL then
    game.win("Dead on target!")
  end
end

function on_exit(obj)
  if obj.tag ~= "me" then
    obj:destroy()
  end
end
