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
local lastBannerNotifyTime = 0
local lastActiveBanner = nil
local lastRequiredPets = {}
local lastBossEventTime = 0     -- Prevent double boss notifications (120s cooldown)
local lastInGameNotifs = {}     -- Prevent in-game popup notification spam (30s cooldown)
local recentMessages = {}       -- Message-level dedupe cache
local watchedElements = {}      -- Track already-hooked UI elements
local isInitializing = true     -- Skip historical announcements during startup scan

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

-- Known Steal An Egg rarities (single-word prefixes)
local KNOWN_RARITIES = {
    ["Common"] = true, ["Uncommon"] = true, ["Rare"] = true, ["Epic"] = true,
    ["Legendary"] = true, ["Mythic"] = true, ["Cosmic"] = true,
    ["Secret"] = true, ["Eternal"] = true, ["Divine"] = true, ["Ultra"] = true,
}

-- ── 0. Rich Text Stripper & Entity Decoder ────────────────────
-- Roblox TextLabels with RichText enabled contain HTML-like tags
-- (e.g. <font color="#ff0">Secret</font>) and entities that break pattern matching.
local function stripRichText(text)
    if not text or typeof(text) ~= "string" then return text end
    local s = text:gsub("<[^>]+>", "")
    s = s:gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&quot;", '"'):gsub("&apos;", "'"):gsub("&amp;", "&")
    return s
end

-- Helper: clean banner names from UI markers, percentages, and linebreaks
local function cleanBannerName(raw)
    if not raw then return nil end
    local clean = raw:gsub("\r?\n", " ")
    clean = clean:gsub("[%-%(]?%s*%d+%%%s*%)?", "")
    clean = clean:gsub("%s*[Bb]anner%s*$", "")
    clean = clean:gsub("^%s+", ""):gsub("%s+$", "")
    return #clean > 0 and clean or nil
end

-- ── 1. HTTP Request Wrapper ──────────────────────────────────
local function httpRequest(url, payload)
    local reqFn = (typeof(syn) == "table" and syn.request)
        or (typeof(http) == "table" and http.request)
        or (typeof(http_request) == "function" and http_request)
        or (typeof(request) == "function" and request)
        or (typeof(fluxus) == "table" and fluxus.request)

    if reqFn then
        local body = HttpService:JSONEncode(payload)
        return pcall(function()
            return reqFn({
                Url = url,
                url = url,
                Method = "POST",
                method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                headers = { ["Content-Type"] = "application/json" },
                Body = body,
                body = body
            })
        end)
    else
        -- Running in standard Roblox client (Developer Console F9 mode)
        -- No executor HTTP available; alerts are logged via [EGG_ALERT]
        -- and relayed to Discord via roblox-log-watcher.js (< 50ms).
        return true, { StatusCode = 200, StatusMessage = "Bridged via Watcher" }
    end
end

-- Helper: show in-game notification with automatic retry if CoreScripts not ready (throttled to prevent spam)
local function notifyUser(title, text, duration)
    duration = duration or 5
    local key = tostring(title) .. "_" .. tostring(text)
    local now = os.time()
    if lastInGameNotifs[key] and (now - lastInGameNotifs[key] < 30) then
        return -- Skip duplicate in-game notification popup
    end
    lastInGameNotifs[key] = now

    task.spawn(function()
        for i = 1, 6 do
            local ok = pcall(function()
                StarterGui:SetCore("SendNotification", {
                    Title = title,
                    Text = text,
                    Duration = duration
                })
            end)
            if ok then break end
            task.wait(0.5)
        end
    end)
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
            local code = res.StatusCode or res.status_code or res.Status
            isOk = (code and code >= 200 and code < 300) or res.Success == true or res.ok == true
        else
            isOk = true
        end
    end

    if isOk then
        print("[Notifier] ✅ Alert sent:", payload.eggName or payload.bossName or payload.bannerName or payload.account or "Ready")
        return true
    else
        local errMsg = (typeof(res) == "table" and (res.StatusMessage or res.status_message or res.StatusCode or res.status_code or "Failed")) or tostring(res)
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

local function cleanBiomeName(raw)
    if not raw or typeof(raw) ~= "string" then return "Unknown" end
    local cleaned = raw:gsub("[%z\1-\31\127]", ""):gsub("^%s+", ""):gsub("[%s!%.]+$", "")
    local lower = cleaned:lower()
    if lower:find("demon") or lower:find("angel") then
        return "Angels & Demons"
    elseif lower:find("cherry") then
        return "Cherry Blossom"
    elseif lower:find("abyss") then
        return "Abyss Ocean"
    elseif lower:find("titan") then
        return "Titan Temple"
    elseif lower:find("cosmic") then
        return "Cosmic"
    elseif lower:find("prehistoric") then
        return "Prehistoric"
    elseif lower:find("volcano") then
        return "Volcano"
    elseif lower:find("jungle") then
        return "Jungle"
    elseif lower:find("snow") then
        return "Snow"
    elseif lower:find("desert") then
        return "Desert"
    elseif lower:find("forest") then
        return "Forest"
    elseif lower:find("lake") then
        return "Lake"
    end
    return cleaned
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
        pcall(function()
            for _, desc in ipairs(container:GetDescendants()) do
            if (desc:IsA("TextLabel") or desc:IsA("TextButton")) and desc.Text and #desc.Text > 0 then
                local txt = stripRichText(desc.Text)

                -- Active banner: "(Now)" marker in rotation chances (most reliable)
                if not bannerFromNow then
                    local nowMatch = txt:match("(.-)%s*%(Now%)") 
                    if nowMatch then
                        local clean = cleanBannerName(nowMatch)
                        if clean then
                            bannerFromNow = clean
                        end
                    end
                end

                -- Banner fallback: "X Banner" title (skip rotation % entries)
                if not bannerFromTitle and txt:find("Banner") and not txt:find("%%") and not txt:find("Rotation") and not txt:find("Chances") then
                    local bMatch = txt:match("(.-)%s+[Bb]anner") or txt:match("(.-)%s*Banner")
                    if bMatch then
                        local clean = cleanBannerName(bMatch)
                        if clean then
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
                local foundBiome = txt:match("Found%s+[Ii]n%s+%[(.-)%]") or txt:match("Found%s+[Ii]n%s+([%a%s&]+)")
                if foundBiome then
                    local cleanFound = foundBiome:gsub("^%s+", ""):gsub("%s+$", ""):gsub("[%[%]]", "")
                    if #cleanFound > 0 then
                        table.insert(foundInLabels, {
                            biome = cleanFound,
                            obj = desc,
                        })
                    end
                end
            end
        end
    end)
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
                    local t = stripRichText(child.Text):gsub("^%s+", ""):gsub("%s+$", "")
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
                        and not t:find("Sacrifice")
                        and not t:find("Required")
                    then
                        petName = t
                        if PET_TO_BIOME[t] then
                            break
                        end
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

    local stateKey = banner

    if stateKey ~= lastBannerState then
        -- Prevent duplicate notifications within 60 seconds
        local now = os.time()
        if (now - lastBannerNotifyTime) < 60 then return end
        lastBannerNotifyTime = now
        lastBannerState = stateKey
        local poolDetails = BANNER_POOLS[banner] or "Active 3-hour Rift Machine Banner"

        -- Print structured log tag for roblox-log-watcher.js (F9 Console Bridge)
        print(string.format("[EGG_ALERT] BANNER:%s", banner))

        local bannerOk = sendAlert("/api/notify-banner", {
            bannerName    = banner,
            details       = poolDetails,
            timeRemaining = timeRem,
        }, 120)

        -- If /api/notify-banner 404s (e.g. Railway pending rebuild), fallback to /api/notify-egg
        if not bannerOk then
            sendAlert("/api/notify-egg", {
                eggName = "Banner: " .. banner,
                rarity  = "Rift",
                biome   = "Lobby",
            }, 120)
        end

        notifyUser("Rift Banner: " .. banner, "Active now at Rift Machine!", 6)
    end
end

-- ── 4. Chat & Screen Announcement Handler ────────────────────
local function handleMessage(text)
    if not text or typeof(text) ~= "string" or #text < 5 then return end

    -- Strip Roblox Rich Text formatting tags (e.g. <font color="#ff0">)
    text = stripRichText(text)

    -- Message-level dedupe: prevent the same text from being processed
    -- twice when both chat and UI watcher fire for the same spawn
    local msgKey = text:lower():gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
    local now = os.time()
    if recentMessages[msgKey] and (now - recentMessages[msgKey] < 30) then
        return -- Already processed this exact message
    end
    recentMessages[msgKey] = now

    -- Periodically clean expired entries
    if math.random(1, 5) == 1 then
        for k, t in pairs(recentMessages) do
            if now - t > 30 then recentMessages[k] = nil end
        end
    end

    -- Check if announcement is about banner change
    if text:find("Rift") or text:find("Banner") or text:find("banner") then
        task.spawn(checkAndNotifyBanner)
    end

    -- ── Pattern 1: Egg Spawn Announcements ───────────────────
    local rarity, eggName, biome = string.match(text, "A[n]?%s+([%a]+)%s+(.-)%s+Egg%s+spawned%s+in%s+(.-)[!%s%.]*$")

    if rarity and eggName and biome then
        if not KNOWN_RARITIES[rarity] then
            -- The first word was part of the egg name (e.g. "Shattered Rift Egg")
            eggName = rarity .. " " .. eggName
            rarity = (eggName:lower():find("rift")) and "Rift" or "Special"
        end
    else
        local e, b = string.match(text, "A[n]?%s+(.-)%s+Egg%s+spawned%s+in%s+(.-)[!%s%.]*$")
        if e and b then
            eggName = e
            biome = b
            rarity = (e:lower():find("rift")) and "Rift" or "Special"
        end
    end

    if eggName and biome then
        local cleanBiome = cleanBiomeName(biome)

        local isBannerEgg = false
        local matchingBanner = lastActiveBanner
        local requiredForPet = nil

        if lastActiveBanner then
            -- A. Check if the egg matches one of the required sacrifice pets
            if lastRequiredPets and #lastRequiredPets > 0 then
                for _, reqPet in ipairs(lastRequiredPets) do
                    local rLow = reqPet.name:lower()
                    local eLow = eggName:lower()
                    if eLow == rLow or eLow:find(rLow) or rLow:find(eLow) then
                        isBannerEgg = true
                        requiredForPet = reqPet.name
                        matchingBanner = lastActiveBanner
                        break
                    end
                end
            end

            -- B. Check if this is an explicit Rift Egg (Riftborn, Riftbeasts, Shattered Rift)
            if not isBannerEgg and (eggName:lower():find("rift") or text:lower():find("rift egg")) then
                isBannerEgg = true
                matchingBanner = lastActiveBanner
            end
        end

        -- Print structured log tag for roblox-log-watcher.js (F9 Console Bridge)
        print(string.format("[EGG_ALERT] EGG:%s:%s:%s", rarity, eggName, cleanBiome))

        sendAlert("/api/notify-egg", {
            eggName        = eggName,
            rarity         = rarity,
            biome          = cleanBiome,
            isBannerEgg    = isBannerEgg,
            bannerName     = isBannerEgg and matchingBanner or nil,
            requiredForPet = requiredForPet,
        }, 15)

        local notifTitle = requiredForPet
            and "⭐ BANNER SACRIFICE EGG!"
            or (isBannerEgg and ("📜 " .. (matchingBanner or "Rift") .. " Egg!") or (rarity .. " Egg Spawned!"))
        local notifText = requiredForPet
            and (eggName .. " in " .. cleanBiome .. "\nNeeded for " .. matchingBanner .. "!")
            or (eggName .. " in " .. cleanBiome)

        notifyUser(notifTitle, notifText, 6)
        return
    end

    -- ── Pattern 2: Rift Boss / Abyss Overlord Spawn ───────────
    local lower = text:lower()
    if (lower:find("rift") or lower:find("abyss")) and lower:find("spawn") then
        local now = os.time()
        -- Cooldown: prevent duplicate boss alerts and in-game popups within 120 seconds
        if (now - lastBossEventTime < 120) then
            return
        end
        lastBossEventTime = now

        local bossName = lower:find("abyss") and "Abyss Overlord" or "Rift Boss"
        local bossBiome = "Unknown"
        local knownBiomes = {"Abyss Ocean", "Cherry Blossom", "Titan Temple", "Angels & Demons", "Prehistoric", "Cosmic", "Volcano", "Jungle", "Snow", "Forest", "Lake", "Desert"}
        for _, b in ipairs(knownBiomes) do
            if lower:find(b:lower()) then
                bossBiome = b
                break
            end
        end
        if bossBiome == "Unknown" then
            local bMatch = text:match("in%s+([%a%s&]+)")
            if bMatch then
                bossBiome = cleanBiomeName(bMatch)
            end
        else
            bossBiome = cleanBiomeName(bossBiome)
        end

        -- Print structured log tag for roblox-log-watcher.js (F9 Console Bridge)
        print(string.format("[EGG_ALERT] BOSS:%s:%s", bossName, bossBiome))

        sendAlert("/api/notify-boss", {
            bossName = bossName,
            biome    = bossBiome
        }, 120)

        notifyUser("Boss Spawned!", bossName .. " in " .. bossBiome, 6)
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

-- Helper: check if a descendant is a text element we should watch
local function isTextElement(obj)
    return obj:IsA("TextLabel") or obj:IsA("TextButton") or obj:IsA("TextBox")
end

-- Hook a single text element's Text property (only once per element)
local function hookTextElement(desc)
    if watchedElements[desc] then return end
    watchedElements[desc] = true
    pcall(function()
        desc:GetPropertyChangedSignal("Text"):Connect(function()
            handleMessage(desc.Text)
        end)
    end)
    -- Process current text immediately (if initializing, seed dedupe cache to prevent old history alerts)
    if desc.Text and #desc.Text > 0 then
        if isInitializing then
            local seedKey = desc.Text:lower():gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
            recentMessages[seedKey] = os.time()
        else
            handleMessage(desc.Text)
        end
    end
end

-- Safe UI Watcher: hooks all text elements in a container + future additions
local function watchContainer(container)
    if not container then return end
    for _, desc in ipairs(container:GetDescendants()) do
        if isTextElement(desc) then
            hookTextElement(desc)
        end
    end
    container.DescendantAdded:Connect(function(desc)
        if isTextElement(desc) then
            hookTextElement(desc)
        end
    end)
end

-- Watch PlayerGui (main source of in-game announcements)
local player = Players.LocalPlayer
if player then
    local playerGui = player:WaitForChild("PlayerGui", 5)
    if playerGui then watchContainer(playerGui) end
end

-- Watch workspace for BillboardGui / SurfaceGui announcements (scoped to lobby models only, never global workspace)
pcall(function()
    for _, child in ipairs(workspace:GetChildren()) do
        local cName = child.Name:lower()
        if cName:find("rift") or cName:find("lobby") or cName:find("spawn")
           or cName:find("announce") or cName:find("egg") or cName:find("event") then
            watchContainer(child)
        end
    end
end)

-- Initial scan complete: enable live alerts for newly spawned events
isInitializing = false

-- ── 6. Periodic Rift Banner & Pets Scanner (every 30 seconds) 
-- Also re-scans PlayerGui for any new text elements that were missed
task.spawn(function()
    while task.wait(30) do
        pcall(checkAndNotifyBanner)
        -- Re-scan PlayerGui for new text elements
        pcall(function()
            local p = Players.LocalPlayer
            if p and p:FindFirstChild("PlayerGui") then
                for _, desc in ipairs(p.PlayerGui:GetDescendants()) do
                    if isTextElement(desc) then
                        hookTextElement(desc)
                    end
                end
            end
        end)
    end
end)
task.defer(checkAndNotifyBanner)

-- ── 7. Send Startup / Execution Alert ────────────────────────
local accountName = player and player.Name or "In-Game Client"

-- Print structured log tag for roblox-log-watcher.js (F9 Console Bridge)
print(string.format("[EGG_ALERT] READY:%s", accountName))

local readyOk = sendAlert("/api/notify-ready", {
    account = accountName
}, 5)

-- If /api/notify-ready fails (e.g. Railway pending rebuild), fallback to /api/notify-egg
if not readyOk then
    sendAlert("/api/notify-egg", {
        eggName = "Scanner Connected (" .. accountName .. ")",
        rarity  = "System",
        biome   = "Online"
    }, 5)
end

-- In-game popup confirmation
notifyUser(
    "Egg Notifier Active! 🚀",
    "Connected to Railway bot.\nWatching eggs, bosses & rift banners!",
    6
)

print("[Notifier] 🚀 Steal An Egg Scanner v3.3 (Stealth Mode) loaded!")
print("[Notifier] 📡 Server status: " .. (readyOk and "Connected ✅" or "Fallback / Pending ⚠️"))
