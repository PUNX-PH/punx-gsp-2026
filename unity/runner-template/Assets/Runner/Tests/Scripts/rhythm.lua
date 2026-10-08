-- Rhythm (2D). Notes fall down three lanes: tap the lane when a note reaches the line. Hit 20 notes to win.
-- Five misses (a note that gets past the line, or a tap with no note) lose.

local LANES = { -2.5, 0, 2.5 }
local LINE_Y = -6
local TARGET = 20
local misses = 0

local function show()
  ui.text("score", "Notes " .. game.score .. " / " .. TARGET, { x = 0.05, y = 0.04, size = 0.045, color = 5 })
  ui.bar("misses", 5 - misses, 5, { x = 0.05, y = 0.1, w = 0.3, h = 0.025, color = 2 })
end

local function miss()
  misses = misses + 1
  show()
  if misses >= 5 then
    game.lose("Too many misses")
  end
end

local function spawn_note()
  local lane = rand_int(1, 3)
  local note = world.spawn("box", { x = LANES[lane], y = 9, w = 1.6, h = 0.6, d = 0.05, vy = -6, color = 2 + lane, tag = "note" })
  note.lane = lane
end

function init()
  world.bounds(9, 16)
  world.camera{ mode = "side2d" }
  world.spawn("box", { x = 0, y = LINE_Y, z = 1, w = 8, h = 0.15, d = 0.05, color = 5 })
  timer.every(0.7, spawn_note)
  show()
end

function on_tap(x, y)
  local lane = 2
  if x < -1.25 then
    lane = 1
  elseif x > 1.25 then
    lane = 3
  end
  for _, note in ipairs(world.find("note")) do
    if note.lane == lane and math.abs(note.y - LINE_Y) < 0.9 then
      note:destroy()
      game.score = game.score + 1
      show()
      if game.score >= TARGET then
        game.win("Perfect rhythm!")
      end
      return
    end
  end
  miss()
end

function on_exit(obj)
  if obj.tag == "note" then
    miss()
  end
  obj:destroy()
end
