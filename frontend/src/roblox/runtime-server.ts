/** Trusted runtime. Game data is JSON, never interpolated into executable expressions. */
export const ROBLOX_SERVER_RUNTIME = String.raw`
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Lighting = game:GetService("Lighting")
local world = nil
for _, child in ipairs(workspace:GetChildren()) do
  if child:GetAttribute("VNManaged") == "VisualNerve/Roblox/v1" and child:GetAttribute("VNGameId") == definition.id then world = child; break end
end
assert(world, "Visual Nerve world is missing. Import the complete place or apply the Studio importer.")
workspace.Gravity = definition.settings.gravity
Players.RespawnTime = definition.settings.respawnSeconds
local function color(hex) return Color3.fromRGB(tonumber(string.sub(hex, 2, 3), 16), tonumber(string.sub(hex, 4, 5), 16), tonumber(string.sub(hex, 6, 7), 16)) end
Lighting.Ambient = color(definition.settings.ambient)
local network = Instance.new("Folder")
network.Name = "VisualNerveGame_" .. definition.id
network:SetAttribute("VNManaged", "VisualNerve/Roblox/v1")
network:SetAttribute("VNGameId", definition.id)
local output = Instance.new("RemoteEvent")
output.Name = "State"
output.Parent = network
network.Parent = ReplicatedStorage
-- This event only sends server state. There is intentionally no OnServerEvent handler.
local variables, items, quests, timers, entities, parts, entityState = {}, {}, {}, {}, {}, {}, {}
local shared, states, activeTimers, cooldowns, once = {}, {}, {}, {}, {}
local queue, dispatching, roundActive = {}, false, false
local logicalTime = 0
local joinOrdinal = 0
local function orderedPlayers()
  local actors = {}; for player in pairs(states) do table.insert(actors, player) end
  table.sort(actors, function(a, b) return states[a].ordinal < states[b].ordinal end)
  return actors
end
local function finite(n, lower, upper)
  if type(n) ~= "number" or n ~= n or n == math.huge or n == -math.huge then return 0 end
  return math.clamp(n, lower or -1e12, upper or 1e12)
end
for _, v in ipairs(definition.variables) do variables[v.id] = v; if v.scope == "shared" then shared[v.id] = v.initial end end
for _, v in ipairs(definition.items) do items[v.id] = v end
for _, v in ipairs(definition.quests) do quests[v.id] = v end
for _, v in ipairs(definition.timers) do timers[v.id] = v end
for _, v in ipairs(definition.entities) do entities[v.id] = v; entityState[v.id] = { enabled = v.enabled, visible = v.visible, collidable = v.collidable } end
for _, item in ipairs(world:GetChildren()) do
  local id = item:GetAttribute("VNEntityId")
  if id and entities[id] and item:GetAttribute("VNManaged") == "VisualNerve/Roblox/v1" and item:GetAttribute("VNGameId") == definition.id then
    parts[id] = item:IsA("Model") and item.PrimaryPart or item
  end
end
local function firstEnabledSpawn()
  for _, entity in ipairs(definition.entities) do
    local part = parts[entity.id]
    if entity.kind == "spawn" and entityState[entity.id].enabled and part and part:IsA("SpawnLocation") then return entity.id end
  end
  return nil
end
local function refreshRespawnLocations()
  local id = firstEnabledSpawn()
  for player in pairs(states) do player.RespawnLocation = id and parts[id] or nil end
end
local function eachPart(id, callback)
  local part = parts[id]
  if not part then return end
  if entities[id].kind == "npc" then
    for _, child in ipairs(part.Parent:GetDescendants()) do if child:IsA("BasePart") and child:GetAttribute("VNManaged") == "VisualNerve/Roblox/v1" and child:GetAttribute("VNGameId") == definition.id then callback(child) end end
  else callback(part) end
end
local function refreshEntity(id)
  local state = entityState[id]
  eachPart(id, function(part)
    local hidden = entities[id].kind == "zone" or (entities[id].kind == "npc" and part.Name == "HumanoidRootPart")
    part.Transparency = state.enabled and state.visible and not hidden and 0 or 1
    part.CanCollide = state.enabled and state.collidable
    part.CanTouch = state.enabled
    if part:IsA("SpawnLocation") then part.Enabled = state.enabled end
    for _, child in ipairs(part:GetChildren()) do if child:IsA("ProximityPrompt") and child:GetAttribute("VNManaged") == "VisualNerve/Roblox/v1" and child:GetAttribute("VNGameId") == definition.id then child.Enabled = state.enabled end end
  end)
end
for id in pairs(entities) do refreshEntity(id) end
local function publish(player, text, won)
  local state = states[player]
  if not state or player.Parent ~= Players then return end
  output:FireClient(player, { name = definition.name, variables = state.variables, shared = shared, inventory = state.inventory, quests = state.quests, variableNames = variables, itemNames = items, questNames = quests, roundActive = roundActive, text = text, won = won == true })
end
local function broadcast()
  for player in pairs(states) do publish(player) end
end
local function value(expr, player)
  local state = player and states[player]
  if expr.kind == "literal" then return expr.value end
  if expr.kind == "variable" then local variable = variables[expr.variableId]; if variable.scope == "shared" then return shared[expr.variableId] end; return state and state.variables[expr.variableId] end
  if expr.kind == "inventory" then return state and state.inventory[expr.itemId] end
  if expr.kind == "questProgress" then return state and state.quests[expr.questId].progress end
  if expr.kind == "questState" then return state and state.quests[expr.questId].state end
  if expr.kind == "arithmetic" then
    local a, b = value(expr.left, player), value(expr.right, player)
    if type(a) ~= "number" or type(b) ~= "number" then return nil end
    if expr.operator == "+" then return finite(a + b) end
    if expr.operator == "-" then return finite(a - b) end
    if expr.operator == "*" then return finite(a * b) end
    return finite(b == 0 and 0 or a / b)
  end
  return nil
end
local function condition(check, player)
  if check.kind == "all" then for _, child in ipairs(check.conditions) do if not condition(child, player) then return false end end; return true end
  if check.kind == "any" then for _, child in ipairs(check.conditions) do if condition(child, player) then return true end end; return false end
  if check.kind == "not" then return not condition(check.condition, player) end
  local a, b = value(check.left, player), value(check.right, player)
  if a == nil or b == nil then return false end
  if check.operator == "==" then return a == b end
  if check.operator == "!=" then return a ~= b end
  if type(a) ~= "number" or type(b) ~= "number" then return false end
  if check.operator == ">" then return a > b end
  if check.operator == ">=" then return a >= b end
  if check.operator == "<" then return a < b end
  return a <= b
end
local function characterParts(player)
  local character = player and player.Character
  return character and character:FindFirstChildOfClass("Humanoid"), character and character:FindFirstChild("HumanoidRootPart")
end
local function teleport(player, id)
  local _, root = characterParts(player)
  local target = parts[id]
  if root and target then root.CFrame = target.CFrame + Vector3.new(0, target.Size.Y / 2 + 3, 0) end
end
local function enqueue(event, player) table.insert(queue, { event = event, player = player }) end
local function action(instruction, player)
  local state = player and states[player]
  local kind = instruction.kind
  if kind == "setVariable" or kind == "addVariable" then
    local variable = variables[instruction.variableId]
    local values = variable.scope == "shared" and shared or state and state.variables
    if not values then return end
    local nextValue = value(instruction.value, player)
    if kind == "addVariable" then if type(nextValue) ~= "number" or type(values[variable.id]) ~= "number" then return end; nextValue = nextValue + values[variable.id] end
    if type(nextValue) ~= type(variable.initial) then return end
    values[variable.id] = type(nextValue) == "number" and finite(nextValue, variable.min, variable.max) or nextValue
  elseif kind == "giveItem" or kind == "removeItem" then
    local amount = value(instruction.amount, player)
    if state and type(amount) == "number" then state.inventory[instruction.itemId] = finite(state.inventory[instruction.itemId] + (kind == "giveItem" and 1 or -1) * math.max(0, math.floor(amount)), 0, items[instruction.itemId].maxStack) end
  elseif kind == "startQuest" or kind == "advanceQuest" or kind == "completeQuest" then
    local quest = state and state.quests[instruction.questId]
    if not quest then return end
    if kind == "startQuest" and quest.state == "inactive" then quest.state = "active"
    elseif kind == "advanceQuest" and quest.state == "active" then
      local amount = value(instruction.amount, player)
      if type(amount) == "number" then quest.progress = finite(quest.progress + math.max(0, math.floor(amount)), 0, quests[instruction.questId].target); if quest.progress >= quests[instruction.questId].target then quest.state = "complete" end end
    elseif kind == "completeQuest" and quest.state == "active" then quest.state = "complete"; quest.progress = quests[instruction.questId].target end
  elseif kind == "startTimer" or kind == "stopTimer" then
    local timer = timers[instruction.timerId]
    if timer.scope == "player" and not state then return end
    local owner = timer.scope == "player" and player or nil
    local key = (owner and tostring(owner.UserId) or "shared") .. "|" .. timer.id
    if kind == "startTimer" then activeTimers[key] = { id = timer.id, player = owner, due = logicalTime + timer.duration } else activeTimers[key] = nil end
  elseif kind == "setEntityEnabled" or kind == "setEntityVisible" or kind == "setEntityCollidable" then
    local key = kind == "setEntityEnabled" and "enabled" or kind == "setEntityVisible" and "visible" or "collidable"
    entityState[instruction.entityId][key] = instruction.value
    refreshEntity(instruction.entityId)
    if kind == "setEntityEnabled" and entities[instruction.entityId].kind == "spawn" then refreshRespawnLocations() end
  elseif kind == "teleport" then teleport(player, instruction.entityId)
  elseif kind == "setCheckpoint" then if state then state.checkpoint = instruction.entityId end
  elseif kind == "message" then if state then publish(player, instruction.text) end
  elseif kind == "damage" or kind == "heal" then
    local humanoid = characterParts(player)
    local amount = value(instruction.amount, player)
    if humanoid and type(amount) == "number" then humanoid.Health = finite(humanoid.Health + (kind == "heal" and 1 or -1) * math.max(0, amount), 0, humanoid.MaxHealth) end
  elseif kind == "win" then if state then state.won = true; publish(player, instruction.message, true) end
  elseif kind == "startRound" and not roundActive then roundActive = true; for _, actor in ipairs(orderedPlayers()) do enqueue({ kind = "roundStart" }, actor) end
  elseif kind == "endRound" and roundActive then roundActive = false; for _, actor in ipairs(orderedPlayers()) do enqueue({ kind = "roundEnd" }, actor) end end
end
local function emit(event, player)
  enqueue(event, player)
  if dispatching then return end
  dispatching = true
  local budget, eventBudget = 8192, 256
  while #queue > 0 and budget > 0 and eventBudget > 0 do
    eventBudget = eventBudget - 1
    local nextEvent = table.remove(queue, 1)
    if nextEvent.player == nil or states[nextEvent.player] then
      for _, rule in ipairs(definition.rules) do
        if rule.enabled and rule.event.kind == nextEvent.event.kind and (not rule.event.entityId or rule.event.entityId == nextEvent.event.entityId) and (not rule.event.timerId or rule.event.timerId == nextEvent.event.timerId) then
          local key = (nextEvent.player and tostring(nextEvent.player.UserId) or "shared") .. "|" .. rule.id
          if not (rule.oncePerPlayer and once[key]) and (cooldowns[key] or -math.huge) <= logicalTime and (not rule.condition or condition(rule.condition, nextEvent.player)) then
            local minimum = (nextEvent.event.kind == "touch" or nextEvent.event.kind == "interact") and 0.1 or 0
            cooldowns[key] = logicalTime + math.max(rule.cooldown, minimum)
            if rule.oncePerPlayer then once[key] = true end
            for _, instruction in ipairs(rule.actions) do
              if budget <= 0 then break end
              budget = budget - 1
              action(instruction, nextEvent.player)
            end
          end
        end
        if budget <= 0 then break end
      end
    end
  end
  if #queue > 0 or budget <= 0 then table.clear(queue); warn("Visual Nerve: rule chain reached the safety limit. Check rules that trigger each other."); for actor in pairs(states) do publish(actor, "A rule chain stopped at the safety limit. Check rules that trigger each other.") end end
  dispatching = false
  broadcast()
end
local function validActor(player, part, interaction)
  local humanoid, root = characterParts(player)
  if not states[player] or not humanoid or humanoid.Health <= 0 or not root or not part then return false end
  if interaction then return (root.Position - part.Position).Magnitude <= 16 end
  local localPosition = part.CFrame:PointToObjectSpace(root.Position)
  local half = part.Size / 2 + Vector3.new(5, 7, 5)
  return math.abs(localPosition.X) <= half.X and math.abs(localPosition.Y) <= half.Y and math.abs(localPosition.Z) <= half.Z
end
for id, part in pairs(parts) do
  local entityId = id
  part.Touched:Connect(function(hit)
    if not entityState[entityId].enabled then return end
    local character = hit:FindFirstAncestorOfClass("Model")
    local player = character and Players:GetPlayerFromCharacter(character)
    if player and validActor(player, part, false) then emit({ kind = "touch", entityId = entityId }, player) end
  end)
  local needsPrompt = false
  for _, rule in ipairs(definition.rules) do if rule.event.kind == "interact" and rule.event.entityId == id then needsPrompt = true; break end end
  if needsPrompt then
    local prompt = nil
    for _, child in ipairs(part:GetChildren()) do if child:IsA("ProximityPrompt") and child:GetAttribute("VNManaged") == "VisualNerve/Roblox/v1" and child:GetAttribute("VNGameId") == definition.id and child:GetAttribute("VNComponent") == "interaction" then prompt = child; break end end
    if not prompt then
      prompt = Instance.new("ProximityPrompt"); prompt.Name = "VNInteract"
      prompt:SetAttribute("VNManaged", "VisualNerve/Roblox/v1"); prompt:SetAttribute("VNGameId", definition.id); prompt:SetAttribute("VNComponent", "interaction")
      prompt.Parent = part
    end
    prompt.ActionText = "Interact"; prompt.ObjectText = entities[id].name; prompt.MaxActivationDistance = 12; prompt.HoldDuration = 0; prompt.Enabled = entityState[id].enabled
    prompt.Triggered:Connect(function(player) if entityState[entityId].enabled and validActor(player, part, true) then emit({ kind = "interact", entityId = entityId }, player) end end)
  end
  if entities[id].movement then
    local movement = entities[id].movement
    local offset = Vector3.new(movement.offset.x, movement.offset.y, movement.offset.z)
    TweenService:Create(part, TweenInfo.new(movement.duration, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true), { CFrame = part.CFrame + offset }):Play()
  end
end
local function configureCharacter(player, character)
  local state = states[player]
  if not state then return end
  local function current() return states[player] == state and player.Parent == Players and player.Character == character end
  local humanoid = character:WaitForChild("Humanoid", 10)
  if not current() then return end
  local root = character:WaitForChild("HumanoidRootPart", 10)
  if not current() or not humanoid or not humanoid:IsA("Humanoid") or not root or not root:IsA("BasePart") then return end
  humanoid.WalkSpeed = definition.settings.walkSpeed; humanoid.UseJumpPower = true; humanoid.JumpPower = definition.settings.jumpPower
  local target = state.checkpoint and entityState[state.checkpoint].enabled and state.checkpoint or firstEnabledSpawn()
  if target then teleport(player, target) else root.CFrame = CFrame.new(0, 3, 0) end
  if not state.joined then state.joined = true; emit({ kind = "playerJoin" }, player) end
  if current() then publish(player) end
end
local function join(player)
  if states[player] then return end
  local count = 0
  for _ in pairs(states) do count = count + 1 end
  if count >= definition.settings.maxPlayers then player:Kick("This game is full. Please try again soon."); return end
  joinOrdinal = joinOrdinal + 1
  local state = { variables = {}, inventory = {}, quests = {}, won = false, ordinal = joinOrdinal }
  for _, variable in ipairs(definition.variables) do if variable.scope == "player" then state.variables[variable.id] = variable.initial end end
  for _, item in ipairs(definition.items) do state.inventory[item.id] = 0 end
  for _, quest in ipairs(definition.quests) do state.quests[quest.id] = { state = "inactive", progress = 0 } end
  states[player] = state
  local initialSpawn = firstEnabledSpawn(); player.RespawnLocation = initialSpawn and parts[initialSpawn] or nil
  player.CharacterAdded:Connect(function(character) configureCharacter(player, character) end)
  if player.Character then task.spawn(configureCharacter, player, player.Character) end
  task.delay(2, function() if states[player] then publish(player) end end)
end
Players.PlayerAdded:Connect(join)
Players.PlayerRemoving:Connect(function(player)
  states[player] = nil
  for key, timer in pairs(activeTimers) do if timer.player == player then activeTimers[key] = nil end end
  local prefix = tostring(player.UserId) .. "|"
  for key in pairs(cooldowns) do if string.sub(key, 1, #prefix) == prefix then cooldowns[key] = nil end end
  for key in pairs(once) do if string.sub(key, 1, #prefix) == prefix then once[key] = nil end end
end)
for _, player in ipairs(Players:GetPlayers()) do join(player) end
RunService.Heartbeat:Connect(function(dt)
  local targetTime = logicalTime + dt
  local count = 0
  while count < 4096 do
    local nextKey, nextTimer = nil, nil
    for key, timer in pairs(activeTimers) do
      if timer.due <= targetTime and (not nextTimer or timer.due < nextTimer.due or (timer.due == nextTimer.due and key < nextKey)) then nextKey = key; nextTimer = timer end
    end
    if not nextTimer then break end
    count = count + 1
    logicalTime = nextTimer.due
    local timer = timers[nextTimer.id]
    if timer["repeat"] then activeTimers[nextKey] = { id = nextTimer.id, player = nextTimer.player, due = logicalTime + timer.duration } else activeTimers[nextKey] = nil end
    emit({ kind = "timer", timerId = nextTimer.id }, nextTimer.player)
  end
  if count >= 4096 then
    for _, timer in pairs(activeTimers) do if timer.due <= targetTime then timer.due = targetTime + (timers[timer.id]["repeat"] and timers[timer.id].duration or 0.1) end end
    warn("Visual Nerve: timer step reached the safety limit. Split repeating timers or increase their duration.")
    for player in pairs(states) do publish(player, "Too many timer ticks. Some timers were delayed. Check short repeating timers.") end
  end
  logicalTime = targetTime
end)
`;
