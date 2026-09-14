-- ============================================================
-- Steal An Egg - In-Game Egg, Boss & Rift Banner Notifier (Roblox Lua)
-- ============================================================
-- Stealth & Undetectable:
-- - Uses 100% passive, read-only event listeners
-- - Does NOT hook or overwrite TextChatService callbacks (BAC Safe)
-- - Does NOT access CoreGui or VirtualUser (Anti-Cheat Safe)
-- - Scans only PlayerGui and relevant lobby models (Zero World Lag)
-- ============================================================

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local TextChatService = game:GetService("TextChatService")
local StarterGui = game:GetService("StarterGui")

-- Public Railway URL:
local BOT_URL = "https://discord-egg-notifier-production.up.railway.app"

-- State tracking
local lastAlerts = {}
local lastBannerState = nil
local lastActiveBanner = nil
local lastRequiredPets = {}

-- Known Rift Banner pool descriptions
local BANNER_POOLS = {
    ["Riftborn"] = "🥚 Drops **Riftborn Egg** (45% chance)\n🗺️ Biome Pool: Jungle, Snow, Volcano, Abyss Ocean",
    ["Riftbeasts"] = "🥚 Drops **Riftbeasts Egg** (35% chance)\n🗺️ Biome Pool: Volcano, Abyss Ocean, Prehistoric, Cosmic",
    ["Shattered Rift"] = "🥚 Drops **Shattered Rift Egg** (20% chance)\n👑 Exclusive Divine: **Shattered Colossus** (0.5% pull rate)\n🗺️ Biome Pool: Prehistoric, Cosmic, Cherry Blossom, Titan Temple",
}

-- Biomes associated with each banner
local BANNER_BIOMES = {
    ["Riftborn"] = { "Jungle", "Snow", "Volcano", "Abyss Ocean" },
    ["Riftbeasts"] = { "Volcano", "Abyss Ocean", "Prehistoric", "Cosmic" },
    ["Shattered Rift"] = { "Prehistoric", "Cosmic", "Cherry Blossom", "Titan Temple" },
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
    local dedupeKey = (payload.eggName or payload.bossName or payload.bannerName or payload.account or "") .. "_" .. (payload.biome or "")
    local now = os.time()

    if lastAlerts[dedupeKey] and (now - lastAlerts[dedupeKey] < dedupeDuration) then
        return false -- Skip duplicate alert
    end
    lastAlerts[dedupeKey] = now

    payload.jobId = game.JobId
    local url = BOT_URL .. endpoint
    local success, res = httpRequest(url, payload)

    local isOk = false
    if success then
        if typeof(res) == "table" then
            isOk = (res.StatusCode and res.StatusCode >= 200 and res.StatusCode < 300) or res.Success == true
        else
            isOk = true
        end
    end

    if isOk then
        print("[Notifier] ✅ Alert sent:", payload.eggName or payload.bossName or payload.bannerName or payload.account or "Ready")
        return true
    else
        local errMsg = (typeof(res) == "table" and (res.StatusMessage or res.StatusCode or "Failed")) or tostring(res)
        warn("[Notifier] ❌ Failed to send alert (" .. tostring(endpoint) .. "):", errMsg)
        return false
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

-- ── 3. Rift Machine & Banner Scanner (Dynamic UI Reading) ────
-- Reads actual UI elements instead of matching hardcoded names:
--   1. Active banner from "(Now)" marker in rotation list
--   2. Fallback: "X Banner" title text
--   3. Required pets from "Found In [Biome]" labels + sibling pet names
--   4. Timer from "Rotates in:" text

local RARITY_FILTER = {
    legendary = true, mythic = true, cosmic = true,
    secret = true, eternal = true, divine = true,
    rare = true, uncommon = true, common = true,
    epic = true, ultra = true,
}
local ACTION_FILTER = {
    ["return"] = true, add = true, equip = true,
    remove = true, sell = true, buy = true, use = true,
}

local function scanRiftBannerAndPets()
    local bannerFromNow = nil   -- from "(Now)" marker (most reliable)
    local bannerFromTitle = nil -- from "X Banner" title text
    local detectedPets = {}
    local timeRemaining = nil
    local foundInLabels = {}    -- TextLabels with "Found In [Biome]"

    local function inspectContainer(container)
        if not container then return end
        for _, desc in ipairs(container:GetDescendants()) do
            if (desc:IsA("TextLabel") or desc:IsA("TextButton")) and desc.Text and #desc.Text > 0 then
                local txt = desc.Text

                -- Active banner: "(Now)" marker in rotation chances (most reliable)
                if not bannerFromNow then
                    local nowMatch = txt:match("(.-)%s*%(Now%)") 
                    if nowMatch then
                        local clean = nowMatch:gsub("^%s+", ""):gsub("%s+$", "")
                        if #clean > 0 then
                            bannerFromNow = clean
                        end
                    end
                end

                -- Banner fallback: "X Banner" title (skip rotation % entries)
                if not bannerFromTitle and txt:find("Banner") and not txt:find("%%") and not txt:find("Rotation") and not txt:find("Chances") then
                    local bMatch = txt:match("(.-)%s+Banner")
                    if bMatch then
                        local clean = bMatch:gsub("^%s+", ""):gsub("%s+$", "")
                        if #clean > 0 then
                            bannerFromTitle = clean
                        end
                    end
                end

                -- Rotation timer: "Rotates in: Xm Xs"
                if not timeRemaining then
                    local timer = txt:match("Rotates%s+in:%s*(.+)")
                    if timer then
                        timeRemaining = timer:gsub("^%s+", ""):gsub("%s+$", "")
                    end
                end

                -- "Found In [Biome]" → marks a pet slot in the Rift UI
                local foundBiome = txt:match("Found%s+[Ii]n%s+%[(.-)%]")
                if foundBiome then
                    table.insert(foundInLabels, {
                        biome = foundBiome,
                        obj = desc,
                    })
                end
            end
        end
    end

    -- Check PlayerGui (Safe & fast)
    local player = Players.LocalPlayer
    if player and player:FindFirstChild("PlayerGui") then
        inspectContainer(player.PlayerGui)
    end

    -- Only inspect specific lobby models, NOT entire workspace
    for _, child in ipairs(workspace:GetChildren()) do
        local cName = child.Name:lower()
        if cName:find("rift") or cName:find("machine") or cName:find("lobby") or cName:find("altar") then
            inspectContainer(child)
        end
    end

    -- Resolve pet names from "Found In" labels by checking sibling TextLabels
    -- Each pet card frame contains: pet name, rarity, action button, "Found In [X]"
    for _, entry in ipairs(foundInLabels) do
        local petName = nil
        local searchNode = entry.obj.Parent
        -- Walk up 1-2 levels to find the pet card container
        for depth = 1, 2 do
            if not searchNode or petName then break end
            for _, child in ipairs(searchNode:GetChildren()) do
                if child:IsA("TextLabel") and child ~= entry.obj and child.Text then
                    local t = child.Text:gsub("^%s+", ""):gsub("%s+$", "")
                    local tLow = t:lower()
                    if #t > 1
                        and not RARITY_FILTER[tLow]
                        and not ACTION_FILTER[tLow]
                        and not t:match("^%d")
                        and not t:find("Found")
                        and not t:find("Pet")
                        and not t:find("%%")
                        and not t:find("Banner")
                        and not t:find("Rotation")
                        and not t:find("Rotates")
                        and not t:find("Chances")
                        and not t:find("Current")
                        and not t:find("The Rift")
                    then
                        petName = t
                        break
                    end
                end
            end
            searchNode = searchNode.Parent
        end

        if petName then
            local alreadyAdded = false
            for _, p in ipairs(detectedPets) do
                if p.name == petName then alreadyAdded = true break end
            end
            if not alreadyAdded then
                table.insert(detectedPets, {
                    name = petName,
                    biome = entry.biome
                })
            end
        end
    end

    local finalBanner = bannerFromNow or bannerFromTitle
    return finalBanner, detectedPets, timeRemaining
end

local function checkAndNotifyBanner()
    local banner, pets, timeRem = scanRiftBannerAndPets()
    if not banner then return end

    -- Update active banner and required pets state
    lastActiveBanner = banner
    if #pets > 0 then
        lastRequiredPets = pets
    end

    local petKey = ""
    for _, p in ipairs(pets) do
        petKey = petKey .. "_" .. p.name .. "(" .. p.biome .. ")"
    end
    local stateKey = banner .. petKey

    if stateKey ~= lastBannerState then
        lastBannerState = stateKey
        local poolDetails = BANNER_POOLS[banner] or "Active 3-hour Rift Machine Banner"

        local bannerOk = sendAlert("/api/notify-banner", {
            bannerName    = banner,
            requiredPets  = pets,
            details       = poolDetails,
            timeRemaining = timeRem,
        }, 120)

        -- If /api/notify-banner 404s (e.g. Railway pending rebuild), fallback to /api/notify-egg
        if not bannerOk then
            local petNames = ""
            for _, p in ipairs(pets) do
                petNames = petNames .. p.name .. " (" .. p.biome .. "), "
            end
            -- Build biome list from dynamically-detected pets instead of hardcoded table
            local biomeStr = "Lobby"
            if #pets > 0 then
                local biomes = {}
                for _, p in ipairs(pets) do
                    if p.biome then table.insert(biomes, p.biome) end
                end
                if #biomes > 0 then biomeStr = table.concat(biomes, ", ") end
            end
            sendAlert("/api/notify-egg", {
                eggName = "Banner: " .. banner .. (petNames ~= "" and (" | Pets: " .. petNames:sub(1, -3)) or ""),
                rarity  = "Rift",
                biome   = biomeStr,
            }, 120)
        end

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

    -- ── Pattern 1: Egg Spawn Announcements ───────────────────
    local rarity, eggName, biome = string.match(text, "A[n]?%s+([%a%s]+)%s+(.-)%s+Egg%s+spawned%s+in%s+(.-)[!%.]?$")

    if not eggName or not biome then
        local e, b = string.match(text, "A[n]?%s+(.-)%s+Egg%s+spawned%s+in%s+(.-)[!%.]?$")
        if e and b then
            eggName = e
            biome = b
            rarity = (e:lower():find("rift")) and "Rift" or "Special"
        end
    end

    if eggName and biome then
        local cleanBiome = biome:gsub("[%z\1-\127\194-\244][\128-\191]*", function(c)
            local b = string.byte(c)
            return (b >= 32 and b <= 126) and c or ""
        end):gsub("%s+$", "")

        local isBannerEgg = false
        local matchingBanner = lastActiveBanner
        local requiredForPet = nil

        if lastActiveBanner then
            if lastRequiredPets and #lastRequiredPets > 0 then
                for _, reqPet in ipairs(lastRequiredPets) do
                    local rLow = reqPet.name:lower()
                    local eLow = eggName:lower()
                    if eLow:find(rLow) or rLow:find(eLow) then
                        isBannerEgg = true
                        requiredForPet = reqPet.name
                        matchingBanner = lastActiveBanner
                        break
                    end
                end
            end

            if not isBannerEgg and (eggName:lower():find("rift") or text:lower():find("rift egg")) then
                isBannerEgg = true
                matchingBanner = lastActiveBanner
            end

            -- Use dynamically-detected pet biomes instead of hardcoded BANNER_BIOMES
            if not isBannerEgg and lastRequiredPets and #lastRequiredPets > 0 then
                for _, reqPet in ipairs(lastRequiredPets) do
                    if reqPet.biome and cleanBiome:lower():find(reqPet.biome:lower()) then
                        isBannerEgg = true
                        matchingBanner = lastActiveBanner
                        break
                    end
                end
            end
        end

        sendAlert("/api/notify-egg", {
            eggName        = eggName,
            rarity         = rarity,
            biome          = cleanBiome,
            isBannerEgg    = isBannerEgg,
            bannerName     = isBannerEgg and matchingBanner or nil,
            requiredForPet = requiredForPet,
        }, 15)

        pcall(function()
            local notifTitle = requiredForPet
                and "⭐ BANNER SACRIFICE EGG!"
                or (isBannerEgg and ("📜 " .. (matchingBanner or "Rift") .. " Egg!") or (rarity .. " Egg Spawned!"))
            local notifText = requiredForPet
                and (eggName .. " in " .. cleanBiome .. "\nNeeded for " .. matchingBanner .. "!")
                or (eggName .. " in " .. cleanBiome)

            StarterGui:SetCore("SendNotification", {
                Title = notifTitle,
                Text = notifText,
                Duration = 6
            })
        end)
        return
    end

    -- ── Pattern 2: Rift Boss / Abyss Overlord Spawn ───────────
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

-- ── 5. Passive, Safe Listeners (Zero Anti-Cheat Footprint) ───

-- Read-only chat message event (Does NOT overwrite OnIncomingMessage)
pcall(function()
    TextChatService.MessageReceived:Connect(function(message)
        if message and message.Text then
            handleMessage(message.Text)
        end
    end)
end)

-- Safe UI Watcher (Watches only PlayerGui, NEVER CoreGui)
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

-- ── 6. Periodic Rift Banner & Pets Scanner (every 30 seconds) 
task.spawn(function()
    while task.wait(30) do
        pcall(checkAndNotifyBanner)
    end
end)
task.defer(checkAndNotifyBanner)

-- ── 7. Send Startup / Execution Alert ────────────────────────
local readyOk = sendAlert("/api/notify-ready", {
    account = player and player.Name or "In-Game Client"
}, 5)

-- If /api/notify-ready fails (e.g. Railway pending rebuild), fallback to /api/notify-egg
if not readyOk then
    sendAlert("/api/notify-egg", {
        eggName = "Scanner Connected (" .. (player and player.Name or "In-Game Client") .. ")",
        rarity  = "System",
        biome   = "Online"
    }, 5)
end

-- In-game popup confirmation
pcall(function()
    StarterGui:SetCore("SendNotification", {
        Title = "Egg Notifier Active!",
        Text = "Connected to Railway bot.\nWatching eggs, bosses & rift banners!",
        Duration = 6
    })
end)

print("[Notifier] 🚀 Steal An Egg Scanner v3.2 (Stealth Mode) loaded!")
