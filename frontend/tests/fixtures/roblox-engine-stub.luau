-- Test-only Roblox API surface. Executes generated Luau instructions, not Roblox physics or Studio.
local fixtureDefinition = FIXTURE_DEFINITION
local fixtureSnapshots, fixtureWarnings = {}, {}
local function clone(value)
  if type(value) ~= "table" then return value end
  local output = {}; for key, entry in pairs(value) do output[key] = clone(entry) end; return output
end
local function signal()
  local callbacks = {}
  return { Connect = function(_, callback) table.insert(callbacks, callback); return { Disconnect = function() end } end, Fire = function(_, ...) for _, callback in ipairs(callbacks) do callback(...) end end }
end
local vectorMeta = {}
local function vector(x, y, z) return setmetatable({ X = x, Y = y, Z = z }, vectorMeta) end
vectorMeta.__add = function(a, b) return vector(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
vectorMeta.__sub = function(a, b) return vector(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
vectorMeta.__div = function(a, b) return vector(a.X / b, a.Y / b, a.Z / b) end
vectorMeta.__index = function(a, key) if key == "Magnitude" then return math.sqrt(a.X * a.X + a.Y * a.Y + a.Z * a.Z) end end
local frameMeta = {}
local function frame(x, y, z) return setmetatable({ Position = vector(x, y, z) }, frameMeta) end
frameMeta.__add = function(a, b) return frame(a.Position.X + b.X, a.Position.Y + b.Y, a.Position.Z + b.Z) end
frameMeta.__index = { PointToObjectSpace = function(a, position) return position - a.Position end, GetComponents = function(a) return a.Position.X, a.Position.Y, a.Position.Z, 1, 0, 0, 0, 1, 0, 0, 0, 1 end }
local methods = {}
local instanceMeta = {}
instanceMeta.__index = function(object, key) return methods[key] or object._values[key] end
instanceMeta.__newindex = function(object, key, value)
  if key == "Parent" then
    local previous = object._values.Parent
    if previous then for i, child in ipairs(previous._children) do if child == object then table.remove(previous._children, i); break end end end
    object._values.Parent = value
    if value then table.insert(value._children, object); if value.ChildAdded then value.ChildAdded:Fire(object) end end
  elseif key == "CFrame" then object._values.CFrame = value; object._values.Position = value.Position
  elseif key == "Position" then object._values.Position = value; object._values.CFrame = frame(value.X, value.Y, value.Z)
  else object._values[key] = value end
end
local function instance(class)
  local object = setmetatable({ _values = { ClassName = class, Name = class }, _children = {}, _attributes = {} }, instanceMeta)
  object.ChildAdded = signal(); object.Touched = signal(); object.Triggered = signal(); object.CharacterAdded = signal()
  if class == "Part" or class == "SpawnLocation" then object.CFrame = frame(0, 0, 0); object.Size = vector(1, 1, 1) end
  return object
end
function methods:IsA(class) return self.ClassName == class or class == "BasePart" and (self.ClassName == "Part" or self.ClassName == "SpawnLocation") end
function methods:GetChildren() return table.clone(self._children) end
function methods:GetDescendants() local result = {}; for _, child in ipairs(self._children) do table.insert(result, child); for _, descendant in ipairs(child:GetDescendants()) do table.insert(result, descendant) end end; return result end
function methods:SetAttribute(key, value) self._attributes[key] = value end
function methods:GetAttribute(key) return self._attributes[key] end
function methods:FindFirstChild(name) for _, child in ipairs(self._children) do if child.Name == name then return child end end; return nil end
local fixtureBeforeWait = nil
function methods:WaitForChild(name) if fixtureBeforeWait then local callback = fixtureBeforeWait; fixtureBeforeWait = nil; callback(self, name) end; return self:FindFirstChild(name) end
function methods:FindFirstChildOfClass(class) for _, child in ipairs(self._children) do if child:IsA(class) then return child end end end
function methods:FindFirstAncestorOfClass(class) local parent = self.Parent; while parent do if parent:IsA(class) then return parent end; parent = parent.Parent end end
function methods:FireClient(player, state) fixtureSnapshots[tostring(player.UserId)] = clone(state) end
function methods:Kick(text) self.Kicked = text end
local Players = instance("Players"); Players.PlayerAdded = signal(); Players.PlayerRemoving = signal(); Players._actors = {}
function Players:GetPlayers() return table.clone(self._actors) end
function Players:GetPlayerFromCharacter(character) for _, player in ipairs(self._actors) do if player.Character == character then return player end end end
local RunService = { Heartbeat = signal() }
local ReplicatedStorage = instance("ReplicatedStorage")
local services = { Players = Players, ReplicatedStorage = ReplicatedStorage, RunService = RunService, Lighting = {}, HttpService = { JSONDecode = function() return fixtureDefinition end }, TweenService = { Create = function() return { Play = function() end } end } }
local game = { GetService = function(_, name) assert(services[name], "Unexpected Roblox service: " .. name); return services[name] end }
local workspace = instance("Workspace")
local Instance = { new = instance }
local Vector3 = { new = vector }
local CFrame = { new = frame }
local Color3 = { fromRGB = function(r, g, b) return { R = r, G = g, B = b } end }
local TweenInfo = { new = function() return {} end }
local Enum = { EasingStyle = { Sine = "Sine" }, EasingDirection = { InOut = "InOut" } }
local delayed = {}
local task = { spawn = function(callback, ...) callback(...) end, delay = function(seconds, callback) table.insert(delayed, { seconds = seconds, callback = callback }) end }
local warn = function(message) table.insert(fixtureWarnings, message) end
local world = instance("Folder"); world:SetAttribute("VNManaged", "VisualNerve/Roblox/v1"); world:SetAttribute("VNGameId", fixtureDefinition.id); world.Parent = workspace
local fixtureParts = {}
for _, entity in ipairs(fixtureDefinition.entities) do
  local object = instance(entity.kind == "npc" and "Model" or entity.kind == "spawn" and "SpawnLocation" or "Part")
  object.Name = entity.name; object:SetAttribute("VNManaged", "VisualNerve/Roblox/v1"); object:SetAttribute("VNGameId", fixtureDefinition.id); object:SetAttribute("VNEntityId", entity.id); object.Parent = world
  local part = object
  if entity.kind == "npc" then
    part = instance("Part"); part.Name = "HumanoidRootPart"; part.Parent = object; object.PrimaryPart = part
    part:SetAttribute("VNManaged", "VisualNerve/Roblox/v1"); part:SetAttribute("VNGameId", fixtureDefinition.id)
  end
  part.Size = vector(entity.transform.size.x, entity.transform.size.y, entity.transform.size.z)
  part.CFrame = frame(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z)
  fixtureParts[entity.id] = part
end
-- GENERATED_RUNTIME
local fixtureActors = {}
local function makeCharacter()
  local character = instance("Model"); character.Parent = workspace
  local root = instance("Part"); root.Name = "HumanoidRootPart"; root.Parent = character
  local humanoid = instance("Humanoid"); humanoid.Name = "Humanoid"; humanoid.Health = 100; humanoid.MaxHealth = 100; humanoid.Parent = character
  return character
end
local function join(id, delayedCharacter)
  local player = instance("Player"); player.UserId = id; player.Parent = Players
  if not delayedCharacter then player.Character = makeCharacter() end
  table.insert(Players._actors, player); fixtureActors[id] = player; Players.PlayerAdded:Fire(player)
  return player
end
local function attachCharacter(id)
  local player = fixtureActors[id]; local character = makeCharacter(); player.Character = character; player.CharacterAdded:Fire(character); return character
end
local function interact(id, entityId, distant)
  local player = fixtureActors[id]; local part = fixtureParts[entityId]
  player.Character:FindFirstChild("HumanoidRootPart").Position = part.Position + vector(distant and 100 or 0, 0, 0)
  local prompt = part:FindFirstChild("VNInteract"); assert(prompt, "Missing interaction prompt"); prompt.Triggered:Fire(player)
end
local function touch(id, entityId, distant)
  local player = fixtureActors[id]; local part = fixtureParts[entityId]; local root = player.Character:FindFirstChild("HumanoidRootPart")
  root.Position = part.Position + vector(distant and 100 or 0, 0, 0)
  part.Touched:Fire(root)
end
local function advance(seconds) RunService.Heartbeat:Fire(seconds) end
local function state(id) return assert(fixtureSnapshots[tostring(id)], "Missing server HUD state") end
-- FIXTURE_ASSERTIONS
