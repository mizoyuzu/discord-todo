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
        console.log(`Refreshing ${commands.length} application (/) commands...`);

        const data = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
        process.exit(0);
    } catch (error) {
        console.error('Error deploying commands:', error);
        process.exit(1);
    }
}

deploy();
