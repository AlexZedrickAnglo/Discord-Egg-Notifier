// ──────────────────────────────────────────────────────────────
// deploy-commands.js — Register slash commands with Discord API
// Run once:  node deploy-commands.js
// ──────────────────────────────────────────────────────────────
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const commands = [];
const cmdDir   = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(cmdDir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(cmdDir, file));
  commands.push(cmd.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`⏳ Registering ${commands.length} slash command(s)…`);

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands },
    );

    console.log('✅ Slash commands registered successfully.');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();
