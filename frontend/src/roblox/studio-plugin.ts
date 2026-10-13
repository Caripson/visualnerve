export const ROBLOX_STUDIO_PLUGIN = String.raw`
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local RunService = game:GetService("RunService")
local ServerScriptService = game:GetService("ServerScriptService")
local StarterPlayer = game:GetService("StarterPlayer")
local MANAGED = "VisualNerve/Roblox/v1"
local toolbar = plugin:CreateToolbar("Visual Nerve")
local open = toolbar:CreateButton("Import game", "Preview and apply this Visual Nerve game. Existing generated objects change only after Apply.", "")
local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 400, 520, 300, 300)
local widget = plugin:CreateDockWidgetPluginGui("VisualNerveImporter_" .. definition.id, info)
widget.Title = "Visual Nerve · Import game"
local panel = Instance.new("Frame"); panel.Size = UDim2.fromScale(1, 1); panel.BackgroundColor3 = Color3.fromRGB(15, 23, 42); panel.Parent = widget
local status = Instance.new("TextLabel"); status.Position = UDim2.fromOffset(14, 14); status.Size = UDim2.new(1, -28, 1, -140); status.BackgroundTransparency = 1; status.TextColor3 = Color3.fromRGB(241, 245, 249); status.TextXAlignment = Enum.TextXAlignment.Left; status.TextYAlignment = Enum.TextYAlignment.Top; status.TextWrapped = true; status.TextSize = 15; status.Text = "1. Preview changes.\n2. Read the list.\n3. Apply when you are ready.\n\nYour other Studio objects stay in place. Edits to generated objects are replaced only when you click Apply. Studio Undo can restore the previous version."; status.Parent = panel
local function button(label, y)
  local control = Instance.new("TextButton"); control.Position = UDim2.new(0, 14, 1, y); control.Size = UDim2.new(1, -28, 0, 44); control.Text = label; control.TextSize = 16; control.TextColor3 = Color3.new(1, 1, 1); control.BackgroundColor3 = Color3.fromRGB(37, 99, 235); control.Parent = panel; return control
end
local previewButton, applyButton = button("Preview changes", -114), button("Apply these changes", -60)
applyButton.Active = false
local previewFingerprint = nil
local busy, alive = false, true
plugin.Unloading:Connect(function() alive = false end)
local entities = {}
local function mark(instance, id, component)
  instance:SetAttribute("VNManaged", MANAGED); instance:SetAttribute("VNGameId", definition.id)
  if id then instance:SetAttribute("VNEntityId", id) end
  if component then instance:SetAttribute("VNComponent", component) end
end
local function owned(instance) return instance:GetAttribute("VNManaged") == MANAGED and instance:GetAttribute("VNGameId") == definition.id end
local function validate()
  assert(definition.schemaVersion == 1 and type(definition.id) == "string", "Unsupported game format")
  assert(#definition.entities <= 1000 and #definition.rules <= 1000, "This game exceeds the build limit")
  local seen, ruleIds = {}, {}
  local kinds = { spawn = true, platform = true, checkpoint = true, hazard = true, collectible = true, door = true, goal = true, npc = true, zone = true, decoration = true, movingPlatform = true }
  local function vector(v, min, max)
    assert(type(v) == "table", "Missing transform")
    for _, key in ipairs({ "x", "y", "z" }) do local n = v[key]; assert(type(n) == "number" and n == n and n >= min and n <= max, "Invalid transform") end
  end
  local hasSpawn = false
  for _, entity in ipairs(definition.entities) do
    assert(type(entity.id) == "string" and not seen[entity.id] and kinds[entity.kind], "Invalid or duplicate object")
    assert(type(entity.name) == "string" and type(entity.color) == "string" and string.match(entity.color, "^#%x%x%x%x%x%x$"), "Invalid name or colour")
    assert(Enum.Material[entity.material], "Unsupported material")
    for _, key in ipairs({ "anchored", "collidable", "visible", "enabled" }) do assert(type(entity[key]) == "boolean", "Missing object toggle") end
    vector(entity.transform.position, -100000, 100000); vector(entity.transform.rotation, -36000, 36000); vector(entity.transform.size, 0.05, 2048)
    if entity.movement then vector(entity.movement.offset, -100000, 100000); assert(type(entity.movement.duration) == "number" and entity.movement.duration >= 0.1 and entity.movement.duration <= 3600, "Invalid platform movement") end
    if entity.kind == "movingPlatform" then assert(entity.movement and entity.anchored, "Moving platform is incomplete") end
    seen[entity.id] = true; entities[entity.id] = entity
    if entity.kind == "spawn" and entity.enabled then hasSpawn = true end
  end
  assert(hasSpawn, "Add an enabled spawn first")
  for _, rule in ipairs(definition.rules) do
    assert(type(rule.id) == "string" and not ruleIds[rule.id] and type(rule.actions) == "table" and #rule.actions >= 1 and #rule.actions <= 64, "Invalid rule")
    ruleIds[rule.id] = true
    if rule.event.entityId then assert(seen[rule.event.entityId], "Rule event points to a missing object") end
    for _, instruction in ipairs(rule.actions) do if instruction.entityId then assert(seen[instruction.entityId], "Rule action points to a missing object") end end
  end
end
-- One Studio place has one generated game controller. Foreign games need a separate place.
local function assertSingleGame()
  local stack = { workspace, ServerScriptService, StarterPlayer.StarterPlayerScripts }
  local inspected = 0
  while #stack > 0 do
    local object = table.remove(stack)
    inspected = inspected + 1
    assert(inspected <= 50000, "This Studio place has too many objects to check safely. Use a smaller separate place for this game.")
    if object:GetAttribute("VNManaged") == MANAGED and object:GetAttribute("VNGameId") ~= definition.id then
      local component = object:GetAttribute("VNComponent")
      local isWorld = object:IsA("Folder") and not object:GetAttribute("VNEntityId") and not component
      assert(not isWorld and component ~= "server" and component ~= "client", "Another Visual Nerve game is already here. Use a separate Studio place or return to that game's blueprint.")
    end
    for _, child in ipairs(object:GetChildren()) do table.insert(stack, child) end
  end
end
local function worldFolder()
  local found = nil
  for _, child in ipairs(workspace:GetChildren()) do if owned(child) and child:IsA("Folder") and not child:GetAttribute("VNEntityId") then assert(not found, "Two owned worlds were found. Resolve the duplicate before importing."); found = child end end
  return found
end
local function generatedObjects(folder)
  local existing = {}
  if folder then for _, child in ipairs(folder:GetChildren()) do if owned(child) and child:GetAttribute("VNEntityId") then local id = child:GetAttribute("VNEntityId"); assert(not existing[id], "Duplicate generated object ID"); existing[id] = child end end end
  return existing
end
local function scriptObject(parent, role)
  local found = nil
  for _, child in ipairs(parent:GetChildren()) do if owned(child) and child:GetAttribute("VNComponent") == role then assert(not found, "Duplicate generated script"); found = child end end
  return found
end
local function fingerprint()
  local values = {}
  local folder = worldFolder()
  if folder then
    for _, child in ipairs(folder:GetDescendants()) do
      local row = child:GetFullName() .. ":" .. child.ClassName
      for _, attribute in ipairs({ "VNManaged", "VNGameId", "VNEntityId", "VNComponent" }) do row = row .. ":" .. tostring(child:GetAttribute(attribute)) end
      if child:IsA("BasePart") then
        for _, component in ipairs({ child.CFrame:GetComponents() }) do row = row .. ":" .. string.format("%.17g", component) end
        for _, component in ipairs({ child.Size.X, child.Size.Y, child.Size.Z }) do row = row .. ":" .. string.format("%.17g", component) end
        if child.Color then for _, component in ipairs({ child.Color.R, child.Color.G, child.Color.B }) do row = row .. ":" .. string.format("%.17g", component) end end
        row = row .. ":" .. tostring(child.Material) .. ":" .. tostring(child.Transparency) .. ":" .. tostring(child.CanCollide) .. ":" .. tostring(child.CanTouch) .. ":" .. tostring(child.Anchored)
        if child:IsA("SpawnLocation") then row = row .. ":" .. tostring(child.Enabled) .. ":" .. tostring(child.Neutral) .. ":" .. tostring(child.Duration) end
      elseif child:IsA("Humanoid") then row = row .. ":" .. tostring(child.DisplayName) .. ":" .. tostring(child.RequiresNeck)
      elseif child:IsA("Model") then row = row .. ":" .. tostring(child.PrimaryPart and child.PrimaryPart:GetFullName()) end
      table.insert(values, row)
    end
  end
  for _, entry in ipairs({ { ServerScriptService, "server" }, { StarterPlayer.StarterPlayerScripts, "client" } }) do
    local source = scriptObject(entry[1], entry[2])
    if source then
      local fields = { entry[2], source.ClassName, source:GetFullName(), tostring(source.Disabled) }
      for _, attribute in ipairs({ "VNManaged", "VNGameId", "VNEntityId", "VNComponent" }) do table.insert(fields, tostring(source:GetAttribute(attribute))) end
      table.insert(fields, ScriptEditorService:GetEditorSource(source))
      -- Length prefix each field so names or script text containing separators stay distinct.
      local row = {}; for _, field in ipairs(fields) do table.insert(row, tostring(#field) .. ":" .. field) end
      table.insert(values, table.concat(row))
    end
  end
  table.sort(values)
  return table.concat(values, "\n")
end
local function rescueChildren(object, destination)
  for _, child in ipairs(object:GetChildren()) do
    if owned(child) then rescueChildren(child, destination) else child.Parent = destination end
  end
end
local function transform(entity)
  local p, r = entity.transform.position, entity.transform.rotation
  return CFrame.new(p.x, p.y, p.z) * CFrame.fromOrientation(math.rad(r.x), math.rad(r.y), math.rad(r.z))
end
local function paint(part, entity, component)
  local s = entity.transform.size
  part.Name = component or entity.name
  part.Anchored = entity.anchored
  part.Size = Vector3.new(s.x, s.y, s.z)
  part.CFrame = transform(entity)
  part.Material = Enum.Material[entity.material]
  part.Color = Color3.fromRGB(tonumber(string.sub(entity.color, 2, 3), 16), tonumber(string.sub(entity.color, 4, 5), 16), tonumber(string.sub(entity.color, 6, 7), 16))
  part.CanCollide = entity.enabled and entity.collidable
  part.CanTouch = entity.enabled
  part.Transparency = entity.enabled and entity.visible and entity.kind ~= "zone" and component ~= "HumanoidRootPart" and 0 or 1
  if part:IsA("SpawnLocation") then part.Enabled = entity.enabled; part.Neutral = true; part.Duration = 0 end
end
local function npcComponent(model, name, class)
  for _, child in ipairs(model:GetChildren()) do if owned(child) and child:GetAttribute("VNComponent") == name and child:IsA(class) then return child end end
  local component = Instance.new(class); component.Name = name; mark(component, nil, name); component.Parent = model; return component
end
local function upsertEntity(existing, entity, folder)
  local class = entity.kind == "npc" and "Model" or entity.kind == "spawn" and "SpawnLocation" or "Part"
  local object = existing[entity.id]
  if object and object.ClassName ~= class then rescueChildren(object, folder); object:Destroy(); object = nil end
  if not object then object = Instance.new(class); mark(object, entity.id); object.Parent = folder end
  object.Name = entity.name
  if class == "Model" then
    local root = npcComponent(object, "HumanoidRootPart", "Part"); paint(root, entity, "HumanoidRootPart")
    local torso = npcComponent(object, "Torso", "Part"); paint(torso, entity, "Torso"); torso.Size = Vector3.new(entity.transform.size.x, entity.transform.size.y * 0.65, entity.transform.size.z)
    local head = npcComponent(object, "Head", "Part"); paint(head, entity, "Head"); head.Size = Vector3.new(entity.transform.size.x * 0.65, entity.transform.size.y * 0.35, entity.transform.size.z * 0.8); head.CFrame = transform(entity) * CFrame.new(0, entity.transform.size.y * 0.5, 0)
    local humanoid = npcComponent(object, "Humanoid", "Humanoid"); humanoid.DisplayName = entity.name; humanoid.RequiresNeck = false
    object.PrimaryPart = root
  else paint(object, entity) end
  return object
end
-- Source edits are excluded from ChangeHistoryService. Prepare detached replacements
-- before recording, then record only synchronous instance/parent changes.
local function stageScript(parent, role, class, source, staged)
  local object = Instance.new(class)
  local entry = { object = object, parent = parent }
  table.insert(staged, entry)
  entry.previous = scriptObject(parent, role)
  mark(object, nil, role)
  object.Name = "VisualNerve_" .. role .. "_" .. definition.id
  object.Disabled = false
  local initial = ScriptEditorService:GetEditorSource(object)
  local conflict = false
  ScriptEditorService:UpdateSourceAsync(object, function(current)
    if not alive or not busy or RunService:IsRunning() or current ~= initial then conflict = true; return nil end
    return source
  end)
  assert(not conflict and ScriptEditorService:GetEditorSource(object) == source, "Script preparation changed or was cancelled. Preview again before applying.")
end
local function swapScript(entry)
  local previous = entry.previous
  if previous then
    for _, child in ipairs(previous:GetChildren()) do child.Parent = entry.object end
    previous.Parent = nil -- Keep original source untouched for Cancel/Undo.
  end
  entry.object.Parent = entry.parent
end
open.Click:Connect(function() widget.Enabled = not widget.Enabled end)
previewButton.MouseButton1Click:Connect(function()
  if busy or not alive then return end
  applyButton.Active = false; previewFingerprint = nil
  local ok, result = pcall(function()
    validate(); assertSingleGame(); assert(not RunService:IsRunning(), "Stop the play test before importing")
    local folder = worldFolder(); local existing = generatedObjects(folder)
    local create, update, remove, unmanaged = 0, 0, 0, 0
    local lines = { "Game: " .. definition.name, "Edits to listed generated objects will be replaced." }
    for _, entity in ipairs(definition.entities) do if existing[entity.id] then update = update + 1 else create = create + 1 end; if #lines < 28 then table.insert(lines, (existing[entity.id] and "Update: " or "Create: ") .. entity.name) end end
    for id, object in pairs(existing) do if not entities[id] then remove = remove + 1; if #lines < 28 then table.insert(lines, "Remove generated: " .. object.Name) end end end
    if folder then for _, child in ipairs(folder:GetDescendants()) do if not owned(child) then unmanaged = unmanaged + 1 end end end
    table.insert(lines, "\nCreate " .. create .. " · Update " .. update .. " · Remove " .. remove)
    table.insert(lines, "Preserve " .. unmanaged .. " other objects. Replace generated server and HUD script objects; keep their custom children.")
    table.insert(lines, "Gravity, movement and respawn settings apply when you play. Set the Roblox Dashboard server size to " .. definition.settings.maxPlayers .. " or less.")
    previewFingerprint = fingerprint(); applyButton.Active = true
    return table.concat(lines, "\n")
  end)
  status.Text = ok and result or "Fix before importing: " .. tostring(result)
end)
applyButton.MouseButton1Click:Connect(function()
  if busy or not alive or not applyButton.Active or not previewFingerprint then return end
  busy = true; previewButton.Active = false; applyButton.Active = false
  status.Text = "Preparing replacement scripts. Your existing world stays in place until preparation and review checks finish."
  local approvedFingerprint = previewFingerprint
  local staged = {}
  local recording = nil
  local ok, result = pcall(function()
    validate(); assertSingleGame(); assert(not RunService:IsRunning(), "Stop the play test first")
    assert(fingerprint() == approvedFingerprint, "Studio changed after your preview. Preview again before applying.")
    stageScript(ServerScriptService, "server", "Script", serverSource, staged)
    stageScript(StarterPlayer.StarterPlayerScripts, "client", "LocalScript", clientSource, staged)
    -- UpdateSourceAsync yields and can retry its callback. Revalidate the approved
    -- world and editor buffers after all preparation, before any place mutation.
    assert(alive and not RunService:IsRunning(), "Stop the play test and keep the importer open.")
    validate(); assertSingleGame()
    assert(fingerprint() == approvedFingerprint, "Studio changed after your preview. Preview again before applying.")
    for _, entry in ipairs(staged) do
      assert(scriptObject(entry.parent, entry.object:GetAttribute("VNComponent")) == entry.previous, "A generated script was replaced while preparing. Preview again before applying.")
    end
    recording = ChangeHistoryService:TryBeginRecording("VisualNerveImport", "Apply Visual Nerve game")
    assert(recording, "Studio cannot start an Undo recording. Try again.")
    local folder = worldFolder()
    if not folder then folder = Instance.new("Folder"); folder.Name = "VisualNerve_" .. definition.id; mark(folder); folder.Parent = workspace end
    local existing = generatedObjects(folder)
    for _, entity in ipairs(definition.entities) do upsertEntity(existing, entity, folder) end
    for id, object in pairs(existing) do if not entities[id] then rescueChildren(object, folder); object:Destroy() end end
    for _, entry in ipairs(staged) do swapScript(entry) end
    ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit); recording = nil
    return "Applied! Click Play to test your game.\n\nUse Studio Undo to restore the previous version. To publish a new experience, choose File → Publish. To choose an existing test place, use File → Publish As. Keep the experience private until you finish testing."
  end)
  if recording then
    local restored = pcall(function() ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Cancel) end)
    if not restored then result = tostring(result) .. "\nStudio could not confirm rollback. Inspect your local backup before continuing." end
  end
  for _, entry in ipairs(staged) do if not entry.object.Parent then entry.object:Destroy() end end
  status.Text = ok and result or "Import stopped: " .. tostring(result)
  applyButton.Active = false; previewFingerprint = nil
  busy = false; previewButton.Active = alive
end)
`;
