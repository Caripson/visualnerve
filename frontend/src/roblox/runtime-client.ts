/** Read-only client HUD; gameplay commands never travel from the client. */
export const ROBLOX_CLIENT_RUNTIME = String.raw`
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local player = Players.LocalPlayer
local screen = Instance.new("ScreenGui")
screen.Name = "VisualNerveHUD_" .. gameId
screen.ResetOnSpawn = false
screen.Parent = player:WaitForChild("PlayerGui")
local frame = Instance.new("Frame")
frame.Position = UDim2.fromOffset(16, 60)
frame.Size = UDim2.fromOffset(280, 240)
frame.BackgroundColor3 = Color3.fromRGB(15, 23, 42)
frame.BackgroundTransparency = 0.15
frame.Parent = screen
local corner = Instance.new("UICorner"); corner.CornerRadius = UDim.new(0, 12); corner.Parent = frame
local text = Instance.new("TextLabel")
text.Position = UDim2.fromOffset(12, 12)
text.Size = UDim2.new(1, -24, 1, -24)
text.BackgroundTransparency = 1
text.TextColor3 = Color3.fromRGB(241, 245, 249)
text.TextXAlignment = Enum.TextXAlignment.Left
text.TextYAlignment = Enum.TextYAlignment.Top
text.TextWrapped = true
text.TextSize = 16
text.Font = Enum.Font.Gotham
text.Text = "Loading your adventure..."
text.Parent = frame
local message = Instance.new("TextLabel")
message.Position = UDim2.new(0.5, -240, 1, -110)
message.Size = UDim2.fromOffset(480, 80)
message.BackgroundColor3 = Color3.fromRGB(15, 23, 42)
message.BackgroundTransparency = 0.15
message.TextColor3 = Color3.fromRGB(241, 245, 249)
message.TextSize = 20
message.TextWrapped = true
message.Font = Enum.Font.GothamBold
message.Visible = false
message.Parent = screen
local messageCorner = Instance.new("UICorner"); messageCorner.CornerRadius = UDim.new(0, 12); messageCorner.Parent = message
local revision = 0
local function sortedKeys(dictionary)
  local keys = {}; for key in pairs(dictionary or {}) do table.insert(keys, key) end; table.sort(keys); return keys
end
local function listen(folder)
  if folder:GetAttribute("VNManaged") ~= "VisualNerve/Roblox/v1" or folder:GetAttribute("VNGameId") ~= gameId then return end
  local output = folder:WaitForChild("State", 10)
  if not output or not output:IsA("RemoteEvent") then return end
  output.OnClientEvent:Connect(function(state)
    local lines = { state.name, state.roundActive and "Round in progress" or "Explore and start a round" }
    for _, id in ipairs(sortedKeys(state.variables)) do table.insert(lines, state.variableNames[id].name .. ": " .. tostring(state.variables[id])) end
    for _, id in ipairs(sortedKeys(state.shared)) do table.insert(lines, state.variableNames[id].name .. " (everyone): " .. tostring(state.shared[id])) end
    for _, id in ipairs(sortedKeys(state.inventory)) do table.insert(lines, state.itemNames[id].name .. ": " .. tostring(state.inventory[id])) end
    for _, id in ipairs(sortedKeys(state.quests)) do
      local quest = state.quests[id]
      if quest.state ~= "inactive" then table.insert(lines, state.questNames[id].name .. ": " .. quest.progress .. "/" .. state.questNames[id].target .. (quest.state == "complete" and " ✓" or "")) end
    end
    text.Text = table.concat(lines, "\n")
    if state.text then
      revision = revision + 1; local current = revision
      message.Text = state.text; message.Visible = true
      task.delay(state.won and 12 or 6, function() if revision == current then message.Visible = false end end)
    end
  end)
end
ReplicatedStorage.ChildAdded:Connect(listen)
for _, folder in ipairs(ReplicatedStorage:GetChildren()) do task.spawn(listen, folder) end
`;
