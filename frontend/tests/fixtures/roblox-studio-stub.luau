-- Test-only Studio API surface; validates generated merge behavior, not actual Studio UI/Undo.
local uiObjects = {}
local originalNewIndex = instanceMeta.__newindex
local fixtureRecording, fixtureUndo, undoing = nil, nil, false
local fixtureEditorSources, fixtureStaged = {}, {}
local fixtureStageCount, fixtureCallbackCount = 0, 0
local fixtureRejectStageAt, fixtureStageHook, fixtureRetrySource = nil, nil, nil
local fixtureRejectCommit = false
instanceMeta.__newindex = function(object, key, value)
  if key == "Source" and #value >= 200000 then error("Test surface rejects large direct Source assignment; use ScriptEditorService") end
  -- Real Studio deliberately excludes Source from the 3D ChangeHistory stack.
  if key ~= "Source" and fixtureRecording and not undoing and (object.Parent or key == "Parent") then table.insert(fixtureRecording, { object = object, key = key, previous = object._values[key] }) end
  return originalNewIndex(object, key, value)
end
local originalSetAttribute = methods.SetAttribute
methods.SetAttribute = function(object, key, value)
  if fixtureRecording and not undoing then table.insert(fixtureRecording, { object = object, key = key, previous = object._attributes[key], attribute = true }) end
  originalSetAttribute(object, key, value)
end
function methods:GetFullName() return self.Parent and (self.Parent:GetFullName() .. "." .. self.Name) or self.Name end
function methods:Destroy() self.Parent = nil; fixtureEditorSources[self] = nil; self.Destroyed = true end
Instance.new = function(class) local object = instance(class); object.MouseButton1Click = signal(); object.Click = signal(); table.insert(uiObjects, object); return object end
local ServerScriptService = instance("ServerScriptService")
local StarterPlayer = instance("StarterPlayer"); StarterPlayer.StarterPlayerScripts = instance("StarterPlayerScripts"); StarterPlayer.StarterPlayerScripts.Parent = StarterPlayer
services.ServerScriptService = ServerScriptService; services.StarterPlayer = StarterPlayer
function RunService:IsRunning() return false end
Enum.Material = { Plastic = "Plastic", SmoothPlastic = "SmoothPlastic", Neon = "Neon", Wood = "Wood", Metal = "Metal", Glass = "Glass", Grass = "Grass", Concrete = "Concrete" }
Enum.TextXAlignment = { Left = "Left" }; Enum.TextYAlignment = { Top = "Top" }
Enum.InitialDockState = { Right = "Right" }; Enum.FinishRecordingOperation = { Commit = "Commit", Cancel = "Cancel" }
local ChangeHistoryService = {}
services.ChangeHistoryService = ChangeHistoryService
local function revert(edits)
  undoing = true
  for index = #edits, 1, -1 do local edit = edits[index]; if edit.attribute then edit.object._attributes[edit.key] = edit.previous else originalNewIndex(edit.object, edit.key, edit.previous) end end
  undoing = false
end
function ChangeHistoryService:TryBeginRecording() assert(not fixtureRecording); fixtureRecording = {}; return "test-recording" end
function ChangeHistoryService:FinishRecording(_, operation)
  if operation == "Commit" and fixtureRejectCommit then error("Commit denied in this fixture") end
  if operation == "Cancel" then revert(fixtureRecording) else fixtureUndo = fixtureRecording end
  fixtureRecording = nil
end
function ChangeHistoryService:Undo() assert(fixtureUndo); revert(fixtureUndo); fixtureUndo = nil end
local ScriptEditorService = {}
services.ScriptEditorService = ScriptEditorService
function ScriptEditorService:GetEditorSource(object) return fixtureEditorSources[object] or object.Source or "" end
function ScriptEditorService:UpdateSourceAsync(object, callback)
  fixtureStageCount = fixtureStageCount + 1; table.insert(fixtureStaged, object)
  assert(object.Parent == nil, "Importer must prepare only detached replacement scripts")
  if fixtureRejectStageAt == fixtureStageCount then error("Script editor permission denied in this fixture") end
  fixtureCallbackCount = fixtureCallbackCount + 1
  local proposed = callback(self:GetEditorSource(object))
  if fixtureStageHook then fixtureStageHook(object, callback, proposed) end
  if fixtureRetrySource ~= nil then
    local changed = fixtureRetrySource; fixtureRetrySource = nil; fixtureEditorSources[object] = changed
    fixtureCallbackCount = fixtureCallbackCount + 1; proposed = callback(changed)
  end
  if proposed ~= nil then originalNewIndex(object, "Source", proposed); fixtureEditorSources[object] = nil end
end
local CFrame = { new = frame, fromOrientation = function() return frame(0, 0, 0) end }
frameMeta.__mul = function(a, b) return frame(a.Position.X + b.Position.X, a.Position.Y + b.Position.Y, a.Position.Z + b.Position.Z) end
Color3.new = function(r, g, b) return { R = r, G = g, B = b } end
local UDim2 = { new = function(...) return { ... } end, fromOffset = function(...) return { ... } end, fromScale = function(...) return { ... } end }
local DockWidgetPluginGuiInfo = { new = function(...) return { ... } end }
local plugin = { Unloading = signal() }
function plugin:CreateToolbar() return { CreateButton = function() return Instance.new("ToolbarButton") end } end
function plugin:CreateDockWidgetPluginGui() return Instance.new("DockWidgetPluginGui") end
local function managed(object, id, component)
  object:SetAttribute("VNManaged", "VisualNerve/Roblox/v1"); object:SetAttribute("VNGameId", fixtureDefinition.id)
  if id then object:SetAttribute("VNEntityId", id) end
  if component then object:SetAttribute("VNComponent", component) end
end
local custom = instance("Part"); custom.Name = "Keep my custom detail"; custom.Parent = fixtureParts.island
local obsolete = instance("Part"); obsolete.Name = "Old generated block"; managed(obsolete, "obsolete"); obsolete.Parent = world
local rescued = instance("Part"); rescued.Name = "Keep obsolete block's custom child"; rescued.Parent = obsolete
local unmanagedScript = instance("Script"); unmanagedScript.Name = "My own script"; unmanagedScript.Source = "KEEP SOURCE"; unmanagedScript.Parent = ServerScriptService
local oldServer = instance("Script"); oldServer.Name = "Generated server from last export"; oldServer.Source = "OLD SERVER"; managed(oldServer, nil, "server"); oldServer.Parent = ServerScriptService
local oldClient = instance("LocalScript"); oldClient.Name = "Generated HUD from last export"; oldClient.Source = "OLD CLIENT"; managed(oldClient, nil, "client"); oldClient.Parent = StarterPlayer.StarterPlayerScripts
local scriptDetail = instance("Folder"); scriptDetail.Name = "Keep my script detail"; scriptDetail.Parent = oldServer
local function ui(label)
  for index = #uiObjects, 1, -1 do if uiObjects[index].Text == label then return uiObjects[index] end end
  error("Missing generated plugin control: " .. label)
end
local function statusText()
  for _, object in ipairs(uiObjects) do if object.ClassName == "TextLabel" then return object.Text end end
end
