-- ============================================================
-- Steal An Egg - In-Game Egg, Boss & Rift Banner Notifier (Roblox Lua)
-- ============================================================
-- Features:
-- 1. Rare Egg Spawns: Detects Secret, Eternal, and Divine eggs
-- 2. Rift Boss Spawns: Detects Rift Boss / Abyss Overlord events
-- 3. Active Rift Banner + Required Pets: Detects Riftborn, Riftbeasts & Shattered Rift
--    and extracts the 3 required sacrifice pets with their respective biomes!
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
local lastBannerState = nil

-- Known Rift Banner pool descriptions
local BANNER_POOLS = {
    ["Riftborn"] = "🥚 Drops **Riftborn Egg** (45% chance)\n🗺️ Biome Pool: Jungle, Snow, Volcano, Abyss Ocean",
    ["Riftbeasts"] = "🥚 Drops **Riftbeasts Egg** (35% chance)\n🗺️ Biome Pool: Volcano, Abyss Ocean, Prehistoric, Cosmic",
    ["Shattered Rift"] = "🥚 Drops **Shattered Rift Egg** (20% chance)\n👑 Exclusive Divine: **Shattered Colossus** (0.5% pull rate)\n🗺️ Biome Pool: Prehistoric, Cosmic, Cherry Blossom",
}

-- Comprehensive Pet to Biome database for Steal An Egg
local PET_TO_BIOME = {
    -- Secret / Eternal / Divine Pets
    ["King Snake"] = "Jungle",
    ["Yeti"] = "Snow",
    ["Cerberus"] = "Volcano",
    ["Kraken"] = "Abyss Ocean",
    ["Tralaledon"] = "Prehistoric",
    ["T-Rex"] = "Prehistoric",
    ["Cosmic Dragon"] = "Cosmic",
    ["Cosmic Skeleton Boss"] = "Cosmic",
    ["Stag"] = "Cherry Blossom",
    ["Mutant Shark"] = "Titan Temple",
    ["Gargoyle"] = "Angels & Demons",
    ["RazorFang"] = "Angels & Demons",
    ["Pure Jellyfish"] = "Angels & Demons",
    ["Centaur"] = "Angels & Demons",
    ["Ice Dragon"] = "Snow",
    ["Phoenix"] = "Volcano",
    ["Lava Dragon"] = "Volcano",
    ["El Maja"] = "Abyss Ocean",
    ["Mosasaurus"] = "Prehistoric",
    ["Eternal Lunar Dragon"] = "Cosmic",
    ["Oni Tiger"] = "Cherry Blossom",
    ["Gorilla King"] = "Titan Temple",
    ["Skeleton Horse"] = "Angels & Demons",
    ["Pegasus"] = "Angels & Demons",
    ["Unicorn"] = "Cosmic",
    ["Kitsune"] = "Cherry Blossom",
    ["Nightflame"] = "Titan Temple",
    ["ArchAngel"] = "Angels & Demons",
    ["World Burner"] = "Angels & Demons",
    -- Jungle
    ["Snake"] = "Jungle", ["Frog"] = "Jungle", ["Monkey"] = "Jungle", ["Parrot"] = "Jungle", ["Jaguar"] = "Jungle", ["Chameleon"] = "Jungle", ["Toucan"] = "Jungle",
    -- Snow
    ["Polar Bear"] = "Snow", ["Penguin"] = "Snow", ["Walrus"] = "Snow", ["Snow Leopard"] = "Snow", ["Mammoth"] = "Snow", ["Arctic Fox"] = "Snow", ["Seal"] = "Snow",
    -- Volcano
    ["Lava Hound"] = "Volcano", ["Magma Golem"] = "Volcano", ["Flame Fox"] = "Volcano", ["Fire Serpent"] = "Volcano", ["Salamander"] = "Volcano", ["Obsidian Golem"] = "Volcano",
    -- Abyss Ocean
    ["Shark"] = "Abyss Ocean", ["Jellyfish"] = "Abyss Ocean", ["Anglerfish"] = "Abyss Ocean", ["Sea Turtle"] = "Abyss Ocean", ["Manta Ray"] = "Abyss Ocean", ["Eel"] = "Abyss Ocean", ["Dolphin"] = "Abyss Ocean",
    -- Prehistoric
    ["Raptor"] = "Prehistoric", ["Stegosaurus"] = "Prehistoric", ["Triceratops"] = "Prehistoric", ["Pterodactyl"] = "Prehistoric", ["Brontosaurus"] = "Prehistoric", ["Spinosaurus"] = "Prehistoric", ["Ankylosaurus"] = "Prehistoric",
    -- Cosmic
    ["Moon Bunny"] = "Cosmic", ["Astro Pug"] = "Cosmic", ["Star Fox"] = "Cosmic", ["Nebula Dragon"] = "Cosmic", ["Alien"] = "Cosmic", ["Star Golem"] = "Cosmic", ["Solar Cat"] = "Cosmic",
    -- Cherry Blossom
    ["Koi"] = "Cherry Blossom", ["Tanuki"] = "Cherry Blossom", ["Panda"] = "Cherry Blossom", ["Red Panda"] = "Cherry Blossom", ["Crane"] = "Cherry Blossom", ["Shiba"] = "Cherry Blossom",
    -- Titan Temple
    ["Stone Golem"] = "Titan Temple", ["Sand Scarab"] = "Titan Temple", ["Sphinx"] = "Titan Temple", ["Mummy"] = "Titan Temple", ["Anubis"] = "Titan Temple", ["Desert Fox"] = "Titan Temple",
    -- Forest / Lake / Desert
    ["Bunny"] = "Forest", ["Dog"] = "Forest", ["Cat"] = "Forest", ["Deer"] = "Forest", ["Bear"] = "Forest", ["Fox"] = "Forest", ["Wolf"] = "Forest",
    ["Duck"] = "Lake", ["Fish"] = "Lake", ["Beaver"] = "Lake", ["Otter"] = "Lake", ["Froggy"] = "Lake",
    ["Camel"] = "Desert", ["Scorpion"] = "Desert", ["Cactus Dog"] = "Desert", ["Cobra"] = "Desert", ["Fennec Fox"] = "Desert",
    -- Angels & Demons
    ["Imp"] = "Angels & Demons", ["Cherub"] = "Angels & Demons", ["Seraph"] = "Angels & Demons", ["Demon"] = "Angels & Demons", ["Angel"] = "Angels & Demons", ["Fallen Angel"] = "Angels & Demons",
}

-- ── 1. HTTP Request Wrapper ──────────────────────────────────
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

-- ── 2. Biome & Pet Resolution ────────────────────────────────
local function resolveBiomeForPet(petName, rawText)
    if rawText then
        local biomes = {"Jungle", "Snow", "Volcano", "Abyss Ocean", "Prehistoric", "Cosmic", "Cherry Blossom", "Titan Temple", "Angels & Demons", "Forest", "Lake", "Desert"}
        for _, b in ipairs(biomes) do
            if rawText:lower():find(b:lower()) then
                return b
            end
        end
    end
    if PET_TO_BIOME[petName] then
        return PET_TO_BIOME[petName]
    end
    local lower = petName:lower()
    for name, biome in pairs(PET_TO_BIOME) do
        if lower:find(name:lower()) or name:lower():find(lower) then
            return biome
        end
    end
    return "Unknown Biome"
end

-- ── 3. Rift Machine & Banner Scanner ─────────────────────────
local function scanRiftBannerAndPets()
    local detectedBanner = nil
    local detectedPets = {}
    local timeRemaining = nil

    local function inspectContainer(container)
        if not container then return end
        for _, desc in ipairs(container:GetDescendants()) do
            if (desc:IsA("TextLabel") or desc:IsA("TextButton")) and desc.Text and #desc.Text > 0 then
                local txt = desc.Text

                -- Check for banner name
                if not detectedBanner then
                    if txt:find("Shattered Rift") then
                        detectedBanner = "Shattered Rift"
                    elseif txt:find("Riftbeasts") then
                        detectedBanner = "Riftbeasts"
                    elseif txt:find("Riftborn") then
                        detectedBanner = "Riftborn"
                    end
                end

                -- Check for timer
                local timeMatch = txt:match("%d%d?:%d%d:%d%d") or txt:match("%d+h%s*%d+m")
                if timeMatch and not timeRemaining then
                    timeRemaining = timeMatch
                end

                -- Check for pet names
                for pName, _ in pairs(PET_TO_BIOME) do
                    if #pName > 3 and txt:lower():find(pName:lower()) then
                        local alreadyAdded = false
                        for _, p in ipairs(detectedPets) do
                            if p.name == pName then alreadyAdded = true break end
                        end
                        if not alreadyAdded and #detectedPets < 3 then
                            table.insert(detectedPets, {
                                name = pName,
                                biome = resolveBiomeForPet(pName, txt)
                            })
                        end
                    end
                end
            end
        end
    end

    -- Check PlayerGui
    local player = Players.LocalPlayer
    if player and player:FindFirstChild("PlayerGui") then
        inspectContainer(player.PlayerGui)
    end

    -- Check Workspace (Rift machine and lobby)
    inspectContainer(workspace)

    return detectedBanner, detectedPets, timeRemaining
end

local function checkAndNotifyBanner()
    local banner, pets, timeRem = scanRiftBannerAndPets()
    if not banner then return end

    local petKey = ""
    for _, p in ipairs(pets) do
        petKey = petKey .. "_" .. p.name .. "(" .. p.biome .. ")"
    end
    local stateKey = banner .. petKey

    if stateKey ~= lastBannerState then
        lastBannerState = stateKey
        local poolDetails = BANNER_POOLS[banner] or "Active 3-hour Rift Machine Banner"

        sendAlert("/api/notify-banner", {
            bannerName    = banner,
            requiredPets  = pets,
            details       = poolDetails,
            timeRemaining = timeRem,
        }, 120)

        pcall(function()
            local petText = (#pets > 0) and ("Requires: " .. pets[1].name .. " & more") or "Active now!"
            StarterGui:SetCore("SendNotification", {
                Title = "Rift Banner: " .. banner,
                Text = petText,
                Duration = 6
            })
        end)
    end
end

-- ── 4. Chat & Screen Announcement Handler ────────────────────
local function handleMessage(text)
    if not text or typeof(text) ~= "string" or #text < 5 then return end

    -- Check if announcement is about banner change
    if text:find("Rift") or text:find("Banner") or text:find("banner") then
        task.spawn(checkAndNotifyBanner)
    end

    -- Pattern 1: Rare Egg Spawn
    local rarity, eggName, biome = string.match(text, "A[n]?%s+([%a%s]+)%s+(.-)%s+Egg%s+spawned%s+in%s+(.-)[!%.]?$")

    if eggName and biome then
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

-- ── 5. Hook Listeners ────────────────────────────────────────
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

-- ── 6. Periodic Rift Banner & Pets Scanner (every 30 seconds) 
task.spawn(function()
    while task.wait(30) do
        pcall(checkAndNotifyBanner)
    end
end)
task.defer(checkAndNotifyBanner)

-- ── 7. Anti-AFK (Prevents 20-minute idle kick on alt account) ─
if player then
    player.Idled:Connect(function()
        pcall(function()
            VirtualUser:CaptureController()
            VirtualUser:ClickButton2(Vector2.new())
            print("[Notifier] ⏰ Anti-AFK tick triggered (staying active).")
        end)
    end)
end

-- In-game popup confirmation
pcall(function()
    StarterGui:SetCore("SendNotification", {
        Title = "Egg & Rift Notifier Active!",
        Text = "Connected to Railway bot.\nTracking eggs, bosses & rift banner pets!",
        Duration = 6
    })
end)

print("[Notifier] 🚀 Steal An Egg Scanner v2.5 loaded! (Eggs, Rift Bosses, Banners & Pets)")
