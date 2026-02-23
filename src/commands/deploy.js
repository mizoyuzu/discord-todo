const { REST, Routes } = require('discord.js');
require('dotenv').config();

const fs = require('fs');
const path = require('path');

async function deploy() {
    const commands = [];
    const commandFiles = fs.readdirSync(__dirname).filter(f => f !== 'deploy.js' && f.endsWith('.js'));

    for (const file of commandFiles) {
        const command = require(path.join(__dirname, file));
        if (command.data) {
            commands.push(command.data.toJSON());
            console.log(`Loaded command: ${command.data.name}`);
        }
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        const guildId = process.env.DISCORD_GUILD_ID;
        
        if (guildId) {
            // Guild commands update instantly
            console.log(`Refreshing ${commands.length} guild (/) commands for guild ${guildId}...`);
            const data = await rest.put(
                Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
                { body: commands },
            );
            console.log(`Successfully reloaded ${data.length} guild (/) commands.`);
        } else {
            // Global commands can take up to 1 hour to propagate
            console.log(`Refreshing ${commands.length} global (/) commands...`);
            const data = await rest.put(
                Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
                { body: commands },
            );
            console.log(`Successfully reloaded ${data.length} global (/) commands.`);
        }
    } catch (error) {
        console.error('Error deploying commands:', error);
    }
}

deploy();
