-- ============================================================
-- Steal An Egg - In-Game Egg & Boss Spawn Notifier (Roblox Lua)
-- ============================================================
-- Put this script into your Roblox client executor (or game server script).
-- It detects in-game announcements (like "A Secret Pure Jellyfish Egg spawned in Angels😇!")
-- and immediately sends a webhook to your Railway bot to ping Discord.

local HttpService = game:GetService("HttpService")

-- ⚠️ REPLACE WITH YOUR RAILWAY DOMAIN:
-- Find this in Railway -> Settings -> Domains (e.g., https://your-project.up.railway.app)
local BOT_URL = "https://YOUR-RAILWAY-DOMAIN.up.railway.app"

-- HTTP Request wrapper (compatible with executors like syn.request / http_request / request and HttpService)
local function httpRequest(url, payload)
    local body = HttpService:JSONEncode(payload)
    local reqFn = (syn and syn.request) or (http and http.request) or http_request or request

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

local function sendAlert(endpoint, payload)
    local url = BOT_URL .. endpoint
    local success, res = httpRequest(url, payload)
    if success then
        print("[Notifier] ✅ Alert sent to Discord:", payload.eggName or payload.bossName)
    else
        warn("[Notifier] ❌ Failed to send alert:", res)
    end
end

-- Handler for announcement text
local function handleMessage(text)
    if not text or typeof(text) ~= "string" then return end

    -- Pattern 1: "A Secret Pure Jellyfish Egg spawned in Angels😇!"
    -- or "An Eternal Ice Dragon Egg spawned in Snow!"
    local rarity, eggName, biome = string.match(text, "^A[n]?%s+([%a%s]+)%s+(.-)%s+Egg%s+spawned%s+in%s+(.-)[!%.]?$")

    if eggName and biome then
        -- Clean up emoji from biome (e.g. "Angels😇" -> "Angels")
        local cleanBiome = biome:gsub("[%z\1-\127\194-\244][\128-\191]*", function(c)
            local b = string.byte(c)
            return (b >= 32 and b <= 126) and c or ""
        end):gsub("%s+$", "")

        sendAlert("/api/notify-egg", {
            eggName = eggName,
            rarity  = rarity,
            biome   = cleanBiome
        })
        return
    end

    -- Pattern 2: Rift Boss spawn
    local lower = text:lower()
    if lower:find("rift") and lower:find("spawn") then
        local bossBiome = text:match("in%s+([%a%s]+)") or "Unknown"
        sendAlert("/api/notify-boss", {
            bossName = "Rift Boss",
            biome    = bossBiome
        })
    end
end

-- ── Hook into Game UI Announcements & Chat ──────────────────
-- 1. Monitor screen text announcements (ScreenGui / BillboardGui)
game:GetService("CoreGui").DescendantAdded:Connect(function(descendant)
    if descendant:IsA("TextLabel") then
        descendant:GetPropertyChangedSignal("Text"):Connect(function()
            handleMessage(descendant.Text)
        end)
        handleMessage(descendant.Text)
    end
end)

local player = game:GetService("Players").LocalPlayer
if player and player:FindFirstChild("PlayerGui") then
    player.PlayerGui.DescendantAdded:Connect(function(descendant)
        if descendant:IsA("TextLabel") then
            descendant:GetPropertyChangedSignal("Text"):Connect(function()
                handleMessage(descendant.Text)
            end)
            handleMessage(descendant.Text)
        end
    end)
end

print("[Notifier] 🚀 Steal An Egg spawn detector loaded!")
