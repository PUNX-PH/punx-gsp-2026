-- Breaker (2D). Drag to move the paddle and bounce the ball into the bricks. Break them all to win.
-- Letting the ball fall past the paddle costs one of your three lives.

local paddle
local ball
local bricks = 0

local function show()
  ui.text("score", "Bricks " .. game.score, { x = 0.05, y = 0.04, size = 0.045, color = 5 })
  ui.bar("lives", game.lives, 3, { x = 0.05, y = 0.1, w = 0.3, h = 0.025, color = 2 })
end

local function serve()
  ball.x = 0
  ball.y = -5
  ball.vx = 3
  ball.vy = 7
end

function init()
  world.bounds(9, 16)
  world.camera{ mode = "side2d" }
  paddle = world.spawn("box", { x = 0, y = -7, w = 2, h = 0.5, d = 0.05, color = 1, solid = true, tag = "paddle" })
  ball = world.spawn("sphere", { x = 0, y = -5, w = 0.5, h = 0.5, d = 0.05, color = 5, solid = true, tag = "ball" })
  serve()
  for row = 0, 3 do
    for col = 0, 5 do
      world.spawn("box", { x = -3.75 + col * 1.5, y = 4 + row * 0.8, w = 1.3, h = 0.6, d = 0.05, color = 2 + row % 3, solid = true, tag = "brick" })
      bricks = bricks + 1
    end
  end
  game.lives = 3
  show()
end

function update(dt)
  if ball.x < -4.25 then
    ball.x = -4.25
    ball.vx = math.abs(ball.vx)
  elseif ball.x > 4.25 then
    ball.x = 4.25
    ball.vx = -math.abs(ball.vx)
  end
  if ball.y > 7.75 then
    ball.y = 7.75
    ball.vy = -math.abs(ball.vy)
  end
  if ball.y < -8.5 then
    game.lives = game.lives - 1
    show()
    if game.lives <= 0 then
      game.lose("Out of balls")
    else
      serve()
    end
  end
end

function on_hold(x, y)
  paddle.x = math.max(-3.5, math.min(3.5, x))
end

function on_collide(a, b)
  local other
  if a.tag == "ball" then
    other = b
  elseif b.tag == "ball" then
    other = a
  end
  if not other then
    return
  end
  if other.tag == "paddle" then
    ball.vy = math.abs(ball.vy)
    ball.vx = (ball.x - paddle.x) * 3
  elseif other.tag == "brick" then
    other:destroy()
    ball.vy = -ball.vy
    game.score = game.score + 1
    bricks = bricks - 1
    show()
    if bricks == 0 then
      game.win("Every brick!")
    end
  end
end
