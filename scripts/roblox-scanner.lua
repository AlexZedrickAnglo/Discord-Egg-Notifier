-- ============================================================
-- Steal An Egg - In-Game Egg, Boss & Banner Notifier (Roblox Lua)
-- ============================================================
-- Features:
-- 1. Rare Egg Spawns: Detects Secret, Eternal, and Divine eggs
-- 2. Rift Boss Spawns: Detects Rift Boss / Abyss Overlord events
-- 3. Active Rift Banner: Detects Riftborn, Riftbeasts & Shattered Rift
-- 4. Deep-Join Server Link: Sends game.JobId to join the exact server
-- 5. Anti-AFK: Prevents 20-minute idle kicks so your alt stays online
-- ============================================================

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local TextChatService = game:GetService("TextChatService")
local StarterGui = game:GetService("StarterGui")
local VirtualUser = game:GetService("VirtualUser")

-- Public Railway URL:
local BOT_URL = "https://discord-egg-notifier-production.up.railway.app"

-- Cache to avoid duplicate pings
local lastAlerts = {}
local lastActiveBanner = nil

-- Known Rift Banner pool descriptions
local BANNER_POOLS = {
    ["Riftborn"] = "🥚 Drops **Riftborn Egg** (45% chance)\n🗺️ Biome Pool: Jungle, Snow, Volcano, Abyss Ocean",
    ["Riftbeasts"] = "🥚 Drops **Riftbeasts Egg** (35% chance)\n🗺️ Biome Pool: Volcano, Abyss Ocean, Prehistoric, Cosmic",
    ["Shattered Rift"] = "🥚 Drops **Shattered Rift Egg** (20% chance)\n👑 Exclusive Divine: **Shattered Colossus** (0.5% pull rate)\n🗺️ Biome Pool: Prehistoric, Cosmic, Cherry Blossom",
}

-- ── 1. HTTP Request Wrapper (Supports all major executors) ───
local function httpRequest(url, payload)
    local body = HttpService:JSONEncode(payload)
    local reqFn = (syn and syn.request)
        or (http and http.request)
        or http_request
        or request
        or (fluxus and fluxus.request)

    if reqFn then
        return pcall(function()
            return reqFn({
                Url = url,
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = body
            })
        end)
    else
        return pcall(function()
            return HttpService:PostAsync(url, body, Enum.HttpContentType.ApplicationJson)
        end)
    end
end

local function sendAlert(endpoint, payload, dedupeDuration)
    dedupeDuration = dedupeDuration or 15
    local dedupeKey = (payload.eggName or payload.bossName or payload.bannerName or "") .. "_" .. (payload.biome or "")
    local now = os.time()

    if lastAlerts[dedupeKey] and (now - lastAlerts[dedupeKey] < dedupeDuration) then
        return -- Skip duplicate alert
    end
    lastAlerts[dedupeKey] = now

    -- Attach server JobId for deep-join link
    payload.jobId = game.JobId

    local url = BOT_URL .. endpoint
    local success, res = httpRequest(url, payload)
    if success then
        print("[Notifier] ✅ Alert sent to Discord:", payload.eggName or payload.bossName or payload.bannerName)
    else
        warn("[Notifier] ❌ Failed to send alert:", res)
    end
end

-- ── 2. Banner Detection & Notification ───────────────────────
local function checkBannerText(text)
    if not text or typeof(text) ~= "string" then return end

    local matchedBanner = nil
    if text:find("Shattered Rift") then
        matchedBanner = "Shattered Rift"
    elseif text:find("Riftbeasts") then
        matchedBanner = "Riftbeasts"
    elseif text:find("Riftborn") then
        matchedBanner = "Riftborn"
    end

    if matchedBanner and matchedBanner ~= lastActiveBanner then
        lastActiveBanner = matchedBanner
        local poolDetails = BANNER_POOLS[matchedBanner] or "Active 3-hour Rift Machine Banner"

        sendAlert("/api/notify-banner", {
            bannerName = matchedBanner,
            details    = poolDetails
        }, 180) -- 3-minute deduplication

        pcall(function()
            StarterGui:SetCore("SendNotification", {
                Title = "Rift Banner Detected!",
                Text = matchedBanner .. " is now active!",
                Duration = 5
            })
        end)
    end
end

-- Scan Workspace and UI for the active Rift Machine banner
local function scanWorldForBanner()
    -- Check PlayerGui TextLabels
    local player = Players.LocalPlayer
    if player and player:FindFirstChild("PlayerGui") then
        for _, desc in ipairs(player.PlayerGui:GetDescendants()) do
            if desc:IsA("TextLabel") and desc.Visible then
                checkBannerText(desc.Text)
            end
        end
    end

    -- Check Workspace objects (BillboardGuis / SurfaceGuis on Rift Machine)
    for _, desc in ipairs(workspace:GetDescendants()) do
        if desc:IsA("TextLabel") or desc:IsA("TextButton") then
            checkBannerText(desc.Text)
        end
    end
end

-- ── 3. Chat & Screen Announcement Handler ────────────────────
local function handleMessage(text)
    if not text or typeof(text) ~= "string" or #text < 5 then return end

    -- Check if announcement is about a banner
    checkBannerText(text)

    -- Pattern 1: Rare Egg Spawn
    -- e.g. "A Secret Pure Jellyfish Egg spawned in Angels😇!" or "An Eternal Ice Dragon Egg spawned in Snow!"
    local rarity, eggName, biome = string.match(text, "A[n]?%s+([%a%s]+)%s+(.-)%s+Egg%s+spawned%s+in%s+(.-)[!%.]?$")

    if eggName and biome then
        -- Clean up emoji and trailing spaces from biome name
        local cleanBiome = biome:gsub("[%z\1-\127\194-\244][\128-\191]*", function(c)
            local b = string.byte(c)
            return (b >= 32 and b <= 126) and c or ""
        end):gsub("%s+$", "")

        sendAlert("/api/notify-egg", {
            eggName = eggName,
            rarity  = rarity,
            biome   = cleanBiome
        }, 15)

        pcall(function()
            StarterGui:SetCore("SendNotification", {
                Title = rarity .. " Egg Spawned!",
                Text = eggName .. " in " .. cleanBiome,
                Duration = 5
            })
        end)
        return
    end

    -- Pattern 2: Rift Boss / Abyss Overlord Spawn
    local lower = text:lower()
    if (lower:find("rift") or lower:find("abyss")) and lower:find("spawn") then
        local bossName = lower:find("abyss") and "Abyss Overlord" or "Rift Boss"
        local bossBiome = text:match("in%s+([%a%s]+)") or "Unknown"

        sendAlert("/api/notify-boss", {
            bossName = bossName,
            biome    = bossBiome
        }, 30)

        pcall(function()
            StarterGui:SetCore("SendNotification", {
                Title = "Boss Spawned!",
                Text = bossName .. " in " .. bossBiome,
                Duration = 6
            })
        end)
    end
end

-- ── 4. Hook Listeners ────────────────────────────────────────

-- Modern Roblox TextChatService
pcall(function()
    TextChatService.OnIncomingMessage = function(message)
        if message and message.Text then
            handleMessage(message.Text)
        end
    end
    TextChatService.MessageReceived:Connect(function(message)
        if message and message.Text then
            handleMessage(message.Text)
        end
    end)
end)

-- Screen TextLabels (Announcements, banners, popups)
local function watchContainer(container)
    if not container then return end
    for _, desc in ipairs(container:GetDescendants()) do
        if desc:IsA("TextLabel") then
            desc:GetPropertyChangedSignal("Text"):Connect(function()
                handleMessage(desc.Text)
            end)
            handleMessage(desc.Text)
        end
    end
    container.DescendantAdded:Connect(function(desc)
        if desc:IsA("TextLabel") then
            desc:GetPropertyChangedSignal("Text"):Connect(function()
                handleMessage(desc.Text)
            end)
            handleMessage(desc.Text)
        end
    end)
end

local player = Players.LocalPlayer
if player then
    local playerGui = player:WaitForChild("PlayerGui", 5)
    if playerGui then watchContainer(playerGui) end
end
pcall(function()
    watchContainer(game:GetService("CoreGui"))
end)

-- ── 5. Periodic World Banner Scanner (every 30 seconds) ──────
task.spawn(function()
    while task.wait(30) do
        pcall(scanWorldForBanner)
    end
end)
-- Initial immediate scan
task.defer(scanWorldForBanner)

-- ── 6. Anti-AFK (Prevents 20-minute idle kick on alt account) ─
if player then
    player.Idled:Connect(function()
        pcall(function()
            VirtualUser:CaptureController()
            VirtualUser:ClickButton2(Vector2.new())
            print("[Notifier] ⏰ Anti-AFK tick triggered (staying active).")
        end)
    end)
end

-- Send in-game confirmation popup
pcall(function()
    StarterGui:SetCore("SendNotification", {
        Title = "Egg Notifier Active!",
        Text = "Connected to Railway bot.\nWatching eggs, bosses & banners!",
        Duration = 6
    })
end)

print("[Notifier] 🚀 Steal An Egg Scanner v2 loaded! (Eggs, Rift Bosses & Banners)")
