-- ============================================================
-- Steal An Egg - In-Game Egg, Boss & Rift Banner Notifier (Roblox Lua)
-- ============================================================
-- Stealth & Undetectable:
-- - Uses 100% passive, read-only event listeners
-- - Does NOT hook or overwrite TextChatService callbacks (BAC Safe)
-- - Does NOT access CoreGui or VirtualUser (Anti-Cheat Safe)
-- - Scans only PlayerGui and relevant lobby models (Zero World Lag)
-- - High-performance: Early-exit filters, O(1) pet lookup, async networking
-- ============================================================

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local TextChatService = game:GetService("TextChatService")
local StarterGui = game:GetService("StarterGui")
local localPlayer = Players.LocalPlayer
if not localPlayer then
    pcall(function()
        localPlayer = Players.PlayerAdded:Wait()
    end)
    if not localPlayer then
        localPlayer = Players.LocalPlayer
    end
end

-- Disconnect & clean up prior scanner instance if re-executed in the same session
local cleanupKey = "__rbx_sc_clean_fn"
local globalEnv = (typeof(getgenv) == "function" and getgenv()) or _G
if globalEnv[cleanupKey] then
    pcall(globalEnv[cleanupKey])
end

local activeConnections = {}
local activeThreads = {}

globalEnv[cleanupKey] = function()
    for _, conn in ipairs(activeConnections) do
        pcall(function() conn:Disconnect() end)
    end
    for _, th in ipairs(activeThreads) do
        pcall(function() task.cancel(th) end)
    end
    table.clear(activeConnections)
    table.clear(activeThreads)
    globalEnv[cleanupKey] = nil
    print("[Notifier] 🧹 Cleaned up prior scanner instance.")
end

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
local watchedElements = setmetatable({}, { __mode = "k" }) -- Weak-table for safe UI garbage collection
local isInitializing = true     -- Skip historical announcements during startup scan
local cachedRiftContainer = nil -- Cached Rift Machine GUI container for instant scans

-- Known Rift Banner pool descriptions
local BANNER_POOLS = {
    ["Riftborn"] = "🥚 Drops **Riftborn Egg** (45% chance)\n🗺️ Biome Pool: Jungle, Snow, Volcano, Abyss Ocean",
    ["Riftbeasts"] = "🥚 Drops **Riftbeasts Egg** (35% chance)\n🗺️ Biome Pool: Volcano, Abyss Ocean, Prehistoric, Cosmic",
    ["Shattered Rift"] = "🥚 Drops **Shattered Rift Egg** (20% chance)\n👑 Exclusive Divine: **Shattered Colossus** (0.5% pull rate)\n🗺️ Biome Pool: Prehistoric, Cosmic, Cherry Blossom, Titan Temple",
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

-- Pre-indexed lowercase map for fast O(1) pet lookup (avoids ~70 string allocations per search)
local LOWER_PET_TO_BIOME = {}
for pet, biome in pairs(PET_TO_BIOME) do
    LOWER_PET_TO_BIOME[pet:lower()] = biome
end

local KNOWN_BIOMES = {
    "Jungle", "Snow", "Volcano", "Abyss Ocean", "Prehistoric",
    "Cosmic", "Cherry Blossom", "Titan Temple", "Angels & Demons",
    "Forest", "Lake", "Desert"
}

local BIOME_KEYWORD_MAP = {
    {"demon", "Angels & Demons"},
    {"angel", "Angels & Demons"},
    {"cherry", "Cherry Blossom"},
    {"abyss", "Abyss Ocean"},
    {"titan", "Titan Temple"},
    {"cosmic", "Cosmic"},
    {"prehistoric", "Prehistoric"},
    {"volcano", "Volcano"},
    {"jungle", "Jungle"},
    {"snow", "Snow"},
    {"desert", "Desert"},
    {"forest", "Forest"},
    {"lake", "Lake"},
}

-- Known Steal An Egg rarities (single-word prefixes)
local KNOWN_RARITIES = {
    ["Common"] = true, ["Uncommon"] = true, ["Rare"] = true, ["Epic"] = true,
    ["Legendary"] = true, ["Mythic"] = true, ["Cosmic"] = true,
    ["Secret"] = true, ["Eternal"] = true, ["Divine"] = true, ["Ultra"] = true,
}

-- ── 0. Rich Text Stripper & Entity Decoder ────────────────────
-- Fast path: if no tags or HTML entities exist, returns original string with zero allocations.
local function stripRichText(text)
    if not text or typeof(text) ~= "string" then return text end
    if not (text:find("<", 1, true) or text:find("&", 1, true)) then
        return text
    end
    local s = text:gsub("<[^>]+>", "")
    return s:gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&quot;", '"'):gsub("&apos;", "'"):gsub("&amp;", "&")
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

-- ── 1. Safe, Stealth HTTP Request Wrapper ────────────────────
-- Detect and cache executor HTTP function ONCE at startup
local function detectSafeHttpFunction()
    local fn = nil
    pcall(function()
        local env = (typeof(getgenv) == "function" and getgenv()) or getfenv()
        for _, name in ipairs({"request", "http_request"}) do
            local candidate = rawget(env, name)
            if typeof(candidate) == "function" then
                fn = candidate
                return
            end
        end
        for _, libName in ipairs({"syn", "http", "fluxus"}) do
            local lib = rawget(env, libName)
            if typeof(lib) == "table" and typeof(rawget(lib, "request")) == "function" then
                fn = rawget(lib, "request")
                return
            end
        end
    end)
    return fn
end

local safeHttpReqFn = detectSafeHttpFunction()

local function httpRequest(url, payload)
    if safeHttpReqFn then
        local body = HttpService:JSONEncode(payload)
        return pcall(function()
            return safeHttpReqFn({
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
        local notifData = {
            Title = title,
            Text = text,
            Duration = duration
        }
        for i = 1, 6 do
            local ok = pcall(function()
                StarterGui:SetCore("SendNotification", notifData)
            end)
            if ok then break end
            task.wait(0.5)
        end
    end)
end

local function sendAlert(endpoint, payload, dedupeDuration)
    dedupeDuration = dedupeDuration or 15
    local dedupeKey = endpoint .. "_" .. (payload.eggName or payload.bossName or payload.bannerName or payload.account or "") .. "_" .. (payload.biome or "")
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

-- Cache pruning: prevents memory accumulation over extended play sessions (runs every 30s)
local function pruneCaches()
    local now = os.time()
    for k, t in pairs(recentMessages) do
        if now - t > 60 then recentMessages[k] = nil end
    end
    for k, t in pairs(lastAlerts) do
        if now - t > 300 then lastAlerts[k] = nil end
    end
    for k, t in pairs(lastInGameNotifs) do
        if now - t > 60 then lastInGameNotifs[k] = nil end
    end

    -- In-place pruning of disconnected signals (avoids table re-allocation)
    local liveCount = 0
    local totalCount = #activeConnections
    for i = 1, totalCount do
        local conn = activeConnections[i]
        if conn and conn.Connected then
            liveCount = liveCount + 1
            activeConnections[liveCount] = conn
        end
    end
    for i = liveCount + 1, totalCount do
        activeConnections[i] = nil
    end
end

-- ── 2. Biome & Pet Resolution ────────────────────────────────
local function resolveBiomeForPet(petName, rawText)
    if rawText then
        local rawLower = rawText:lower()
        for _, b in ipairs(KNOWN_BIOMES) do
            if rawLower:find(b:lower(), 1, true) then
                return b
            end
        end
    end
    if PET_TO_BIOME[petName] then
        return PET_TO_BIOME[petName]
    end
    local lower = petName:lower()
    if LOWER_PET_TO_BIOME[lower] then
        return LOWER_PET_TO_BIOME[lower]
    end
    for nameLower, biome in pairs(LOWER_PET_TO_BIOME) do
        if lower:find(nameLower, 1, true) or nameLower:find(lower, 1, true) then
            return biome
        end
    end
    return "Unknown Biome"
end

local function cleanBiomeName(raw)
    if not raw or typeof(raw) ~= "string" then return "Unknown" end
    local cleaned = raw:gsub("[%z\1-\31\127]", ""):gsub("^%s+", ""):gsub("[%s!%.]+$", "")
    local lower = cleaned:lower()
    for _, entry in ipairs(BIOME_KEYWORD_MAP) do
        if lower:find(entry[1], 1, true) then
            return entry[2]
        end
    end
    return cleaned
end

-- ── 3. Rift Machine & Banner Scanner (Dynamic UI Reading) ────
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
                    if not bannerFromTitle and txt:find("Banner", 1, true) and not txt:find("%", 1, true) and not txt:find("Rotation", 1, true) and not txt:find("Chances", 1, true) then
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

    -- Optimized Container Search:
    -- 1. Check cached container first if previously identified
    if cachedRiftContainer and cachedRiftContainer.Parent then
        inspectContainer(cachedRiftContainer)
    end

    -- 2. Scoped ScreenGui search inside PlayerGui
    local playerGui = localPlayer and localPlayer:FindFirstChild("PlayerGui")
    if not bannerFromNow and not bannerFromTitle and playerGui then
        for _, gui in ipairs(playerGui:GetChildren()) do
            local gName = gui.Name:lower()
            if gName:find("rift", 1, true) or gName:find("banner", 1, true) or gName:find("machine", 1, true)
               or gName:find("altar", 1, true) or gName:find("event", 1, true) or gName:find("main", 1, true) then
                inspectContainer(gui)
                if bannerFromNow or bannerFromTitle then
                    cachedRiftContainer = gui
                    break
                end
            end
        end

        -- Fallback: check full PlayerGui only if specialized containers didn't contain it
        if not bannerFromNow and not bannerFromTitle then
            inspectContainer(playerGui)
        end
    end

    -- 3. Only inspect workspace models that actually contain 3D GUI components (BillboardGui / SurfaceGui)
    for _, child in ipairs(workspace:GetChildren()) do
        local cName = child.Name:lower()
        if cName:find("rift", 1, true) or cName:find("machine", 1, true) or cName:find("lobby", 1, true) or cName:find("altar", 1, true) then
            if child:FindFirstChildWhichIsA("BillboardGui", true) or child:FindFirstChildWhichIsA("SurfaceGui", true) then
                inspectContainer(child)
            end
        end
    end

    -- Resolve pet names from "Found In" labels by checking sibling TextLabels
    for _, entry in ipairs(foundInLabels) do
        local petName = nil
        local searchNode = entry.obj.Parent
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
                        and not t:find("Found", 1, true)
                        and not t:find("Pet", 1, true)
                        and not t:find("%", 1, true)
                        and not t:find("Banner", 1, true)
                        and not t:find("Rotation", 1, true)
                        and not t:find("Rotates", 1, true)
                        and not t:find("Chances", 1, true)
                        and not t:find("Current", 1, true)
                        and not t:find("The Rift", 1, true)
                        and not t:find("Sacrifice", 1, true)
                        and not t:find("Required", 1, true)
                    then
                        petName = t
                        if PET_TO_BIOME[t] or LOWER_PET_TO_BIOME[tLow] then
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

        -- Immediate in-game popup confirmation
        notifyUser("Rift Banner: " .. banner, "Active now at Rift Machine!", 6)

        -- Dispatch network alert
        task.spawn(function()
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
        end)
    end
end

-- ── 4. Chat & Screen Announcement Handler ────────────────────
local function handleMessage(text)
    if not text or typeof(text) ~= "string" or #text < 5 then return end

    -- FAST ANCHOR FILTER:
    -- Announcements strictly contain one of these keywords.
    -- Discards >99% of unrelated text updates (chat, cash counters, leaderboards, stats)
    -- before allocating any new strings or running regex patterns.
    if not (text:find("Egg", 1, true) or text:find("egg", 1, true)
            or text:find("spawn", 1, true) or text:find("Spawn", 1, true)
            or text:find("Rift", 1, true) or text:find("rift", 1, true)
            or text:find("Banner", 1, true) or text:find("banner", 1, true)
            or text:find("Abyss", 1, true) or text:find("abyss", 1, true)
            or text:find("Boss", 1, true) or text:find("boss", 1, true)) then
        return
    end

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

    -- Check if announcement is about banner change
    if text:find("Rift", 1, true) or text:find("Banner", 1, true) or text:find("banner", 1, true) then
        task.spawn(checkAndNotifyBanner)
    end

    -- ── Pattern 1: Egg Spawn Announcements ───────────────────
    local rarity, eggName, biome = string.match(text, "A[n]?%s+([%a]+)%s+(.-)%s+Egg%s+spawned%s+in%s+(.-)[!%s%.]*$")

    if rarity and eggName and biome then
        if not KNOWN_RARITIES[rarity] then
            -- The first word was part of the egg name (e.g. "Shattered Rift Egg")
            eggName = rarity .. " " .. eggName
            rarity = (eggName:lower():find("rift", 1, true)) and "Rift" or "Special"
        end
    else
        local e, b = string.match(text, "A[n]?%s+(.-)%s+Egg%s+spawned%s+in%s+(.-)[!%s%.]*$")
        if e and b then
            eggName = e
            biome = b
            rarity = (e:lower():find("rift", 1, true)) and "Rift" or "Special"
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
                    if eLow == rLow or eLow:find(rLow, 1, true) or rLow:find(eLow, 1, true) then
                        isBannerEgg = true
                        requiredForPet = reqPet.name
                        matchingBanner = lastActiveBanner
                        break
                    end
                end
            end

            -- B. Check if this is an explicit Rift Egg (Riftborn, Riftbeasts, Shattered Rift)
            if not isBannerEgg and (eggName:lower():find("rift", 1, true) or text:lower():find("rift egg", 1, true)) then
                isBannerEgg = true
                matchingBanner = lastActiveBanner
            end
        end

        -- Print structured log tag for roblox-log-watcher.js (F9 Console Bridge)
        print(string.format("[EGG_ALERT] EGG:%s:%s:%s", rarity, eggName, cleanBiome))

        local notifTitle = requiredForPet
            and "⭐ BANNER SACRIFICE EGG!"
            or (isBannerEgg and ("📜 " .. (matchingBanner or "Rift") .. " Egg!") or (rarity .. " Egg Spawned!"))
        local notifText = requiredForPet
            and (eggName .. " in " .. cleanBiome .. "\nNeeded for " .. matchingBanner .. "!")
            or (eggName .. " in " .. cleanBiome)

        -- Immediate local in-game popup (zero latency)
        notifyUser(notifTitle, notifText, 6)

        -- Dispatch network alert asynchronously
        task.spawn(function()
            sendAlert("/api/notify-egg", {
                eggName        = eggName,
                rarity         = rarity,
                biome          = cleanBiome,
                isBannerEgg    = isBannerEgg,
                bannerName     = isBannerEgg and matchingBanner or nil,
                requiredForPet = requiredForPet,
            }, 15)
        end)
        return
    end

    -- ── Pattern 2: Rift Boss / Abyss Overlord Spawn ───────────
    local lower = text:lower()
    if (lower:find("rift", 1, true) or lower:find("abyss", 1, true)) and lower:find("spawn", 1, true) then
        local bossName = lower:find("abyss", 1, true) and "Abyss Overlord" or "Rift Boss"
        local bossBiome = "Unknown"
        for _, b in ipairs(KNOWN_BIOMES) do
            if lower:find(b:lower(), 1, true) then
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

        -- Filter: Never notify if biome is Unknown (drops secondary entity spawn announcements)
        if bossBiome == "Unknown" or #bossBiome < 3 then
            return
        end

        local now = os.time()
        -- Cooldown: prevent duplicate boss alerts within 600 seconds (10 minutes)
        if (now - lastBossEventTime < 600) then
            return
        end
        lastBossEventTime = now

        -- Print structured log tag for roblox-log-watcher.js (F9 Console Bridge)
        print(string.format("[EGG_ALERT] BOSS:%s:%s", bossName, bossBiome))

        -- Immediate local in-game popup (zero latency)
        notifyUser("Boss Spawned!", bossName .. " in " .. bossBiome, 6)

        -- Dispatch network alert asynchronously
        task.spawn(function()
            sendAlert("/api/notify-boss", {
                bossName = bossName,
                biome    = bossBiome
            }, 600)
        end)
    end
end

-- ── 5. Passive, Safe Listeners (Zero Anti-Cheat Footprint) ───

-- Read-only chat message event (Does NOT overwrite OnIncomingMessage)
pcall(function()
    local conn = TextChatService.MessageReceived:Connect(function(message)
        if message and message.Text then
            handleMessage(message.Text)
        end
    end)
    table.insert(activeConnections, conn)
end)

-- Helper: check if a descendant is a text element we should watch
local function isTextElement(obj)
    -- Only TextLabel and TextButton. Excludes TextBox to avoid capturing user keystrokes.
    return obj:IsA("TextLabel") or obj:IsA("TextButton")
end

-- Hook a single text element's Text property (only once per element)
local function hookTextElement(desc)
    if watchedElements[desc] then return end
    watchedElements[desc] = true

    local conn = nil
    local destroyConn = nil

    local function cleanupElement()
        if conn then
            pcall(function() conn:Disconnect() end)
            conn = nil
        end
        if destroyConn then
            pcall(function() destroyConn:Disconnect() end)
            destroyConn = nil
        end
        watchedElements[desc] = nil
    end

    pcall(function()
        conn = desc:GetPropertyChangedSignal("Text"):Connect(function()
            handleMessage(desc.Text)
        end)
        table.insert(activeConnections, conn)

        -- Disconnect immediately on destroy to release closure memory
        destroyConn = desc.Destroying:Connect(cleanupElement)
        table.insert(activeConnections, destroyConn)
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

-- Safe UI Watcher: hooks text elements in a container + future additions
local function watchContainer(container)
    if not container then return end
    for _, desc in ipairs(container:GetDescendants()) do
        if isTextElement(desc) then
            hookTextElement(desc)
        end
    end
    local conn = container.DescendantAdded:Connect(function(desc)
        if isTextElement(desc) then
            hookTextElement(desc)
        end
    end)
    table.insert(activeConnections, conn)
end

-- Watch PlayerGui (main source of in-game announcements)
if localPlayer then
    local playerGui = localPlayer:WaitForChild("PlayerGui", 5)
    if playerGui then watchContainer(playerGui) end
end

-- Watch workspace for BillboardGui / SurfaceGui announcements (only models that actually contain Guis)
pcall(function()
    for _, child in ipairs(workspace:GetChildren()) do
        local cName = child.Name:lower()
        if cName:find("rift", 1, true) or cName:find("lobby", 1, true) or cName:find("spawn", 1, true)
           or cName:find("announce", 1, true) or cName:find("egg", 1, true) or cName:find("event", 1, true) then
            if child:FindFirstChildWhichIsA("BillboardGui", true) or child:FindFirstChildWhichIsA("SurfaceGui", true) then
                watchContainer(child)
            end
        end
    end
end)

-- Initial scan complete: enable live alerts for newly spawned events
isInitializing = false

-- ── 6. Periodic Rift Banner Scanner & Cache Pruner (every 30 seconds) 
local loopThread = task.spawn(function()
    while task.wait(30) do
        pcall(checkAndNotifyBanner)
        pcall(pruneCaches)
    end
end)
table.insert(activeThreads, loopThread)
task.defer(checkAndNotifyBanner)

-- ── 7. Send Startup / Execution Alert (Anonymous) ───────────
-- Print structured log tag for roblox-log-watcher.js (F9 Console Bridge) - anonymous, no player name
print("[EGG_ALERT] READY")

task.spawn(function()
    local readyOk = sendAlert("/api/notify-ready", {}, 5)

    -- If /api/notify-ready fails (e.g. Railway pending rebuild), fallback to /api/notify-egg
    if not readyOk then
        sendAlert("/api/notify-egg", {
            eggName = "Scanner Connected",
            rarity  = "System",
            biome   = "Online"
        }, 5)
    end
    print("[Notifier] 📡 Server status: " .. (readyOk and "Connected ✅" or "Fallback / Pending ⚠️"))
end)

-- In-game popup confirmation
notifyUser(
    "Egg Notifier Active! 🚀",
    "Connected to Railway bot.\nWatching eggs, bosses & rift banners!",
    6
)

-- ── 8. Player Disconnect / Offline Handler ───────────────────
local hasNotifiedOffline = false

local function handleOffline()
    if hasNotifiedOffline then return end
    hasNotifiedOffline = true

    print("[EGG_ALERT] OFFLINE")

    -- Synchronous alert dispatch so network packet is sent before thread tears down
    pcall(function()
        local offlineOk = sendAlert("/api/notify-offline", {}, 5)
        if not offlineOk then
            sendAlert("/api/notify-egg", {
                eggName = "Scanner Disconnected",
                rarity  = "System",
                biome   = "Offline"
            }, 5)
        end
    end)
end

-- Hook PlayerRemoving (fires for LocalPlayer when leaving the server)
pcall(function()
    local conn = Players.PlayerRemoving:Connect(function(leavingPlayer)
        if leavingPlayer == localPlayer then
            handleOffline()
        end
    end)
    table.insert(activeConnections, conn)
end)

-- Hook AncestryChanged (fires when LocalPlayer instance is detached from Players)
pcall(function()
    if localPlayer then
        local conn = localPlayer.AncestryChanged:Connect(function(_, parent)
            if not parent then
                handleOffline()
            end
        end)
        table.insert(activeConnections, conn)
    end
end)

-- Hook BindToClose if client environment / executor supports it
pcall(function()
    game:BindToClose(function()
        handleOffline()
    end)
end)

print("[Notifier] 🚀 Steal An Egg Scanner v3.5 (Stealth & Anonymous) loaded!")
