-- Memory (2D puzzle). Watch the tiles light up, then tap them in the same order. Each round adds one more. Repeat 5 in a row to win.
-- (sequence, showing and at are globals only so that a test can watch the game.)

local COLORS = { 2, 3, 4, 5 }
local tiles = {}
sequence = {}
showing = true
at = 1

local function flash(i)
  tiles[i]:set_color(1)
  timer.after(0.3, function()
    tiles[i]:set_color(COLORS[i])
  end)
end

local function play_sequence()
  showing = true
  ui.text("hint", "Watch", { x = 0.5, y = 0.12, size = 0.05, align = "center", color = 5 })
  for i = 1, #sequence do
    timer.after(0.6 * i, function()
      flash(sequence[i])
    end)
  end
  timer.after(0.6 * (#sequence + 1), function()
    showing = false
    at = 1
    ui.text("hint", "Your turn", { x = 0.5, y = 0.12, size = 0.05, align = "center", color = 5 })
  end)
end

local function next_round()
  sequence[#sequence + 1] = rand_int(1, 4)
  game.score = #sequence - 1
  ui.text("score", "Round " .. #sequence .. " / 5", { x = 0.5, y = 0.05, size = 0.05, align = "center", color = 5 })
  timer.after(0.8, play_sequence)
end

local function tile_at(x, y)
  for i, t in ipairs(tiles) do
    if math.abs(x - t.x) < t.w / 2 and math.abs(y - t.y) < t.h / 2 then
      return i
    end
  end
end

function init()
  world.bounds(9, 16)
  world.camera{ mode = "side2d" }
  local spots = { { -2, 2 }, { 2, 2 }, { -2, -2 }, { 2, -2 } }
  for i = 1, 4 do
    tiles[i] = world.spawn("quad", { x = spots[i][1], y = spots[i][2], w = 3.5, h = 3.5, color = COLORS[i], tag = "tile" })
  end
  next_round()
end

function on_tap(x, y)
  if showing then
    return
  end
  local i = tile_at(x, y)
  if not i then
    return
  end
  flash(i)
  if i ~= sequence[at] then
    game.lose("Wrong tile")
    return
  end
  at = at + 1
  if at > #sequence then
    showing = true
    if #sequence >= 5 then
      game.score = 5
      game.win("Great memory!")
    else
      next_round()
    end
  end
end
