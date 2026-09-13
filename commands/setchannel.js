// ──────────────────────────────────────────────────────────────
// commands/setchannel.js — /setchannel slash command
// ──────────────────────────────────────────────────────────────
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Sets the target channel for bot notifications.')
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('The text channel to send notifications to.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, { setNotifyChannel }) {
    const channel = interaction.options.getChannel('channel');
    setNotifyChannel(channel.id);

    await interaction.reply({
      content: `✅ Notification channel set to <#${channel.id}>.`,
      flags: 64, // ephemeral
    });
  },
};
