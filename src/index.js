require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { startReminder } = require('./reminder');
const { handleButton, userStates } = require('./handlers/buttonHandler');
const { handleModal } = require('./handlers/modalHandler');
const { handleSelect } = require('./handlers/selectHandler');
const { getGuildSettings, addTodo } = require('./database');
const { sendTodoList } = require('./utils/pagination');
const {
    ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    UserSelectMenuBuilder,
} = require('discord.js');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
});

// Load commands
client.commands = new Collection();
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands'))
    .filter(f => f !== 'deploy.js' && f.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(__dirname, 'commands', file));
    if (command.data) {
        client.commands.set(command.data.name, command);
    }
}

client.once(Events.ClientReady, (c) => {
    console.log(`✅ Logged in as ${c.user.tag}`);
    console.log(`📋 Serving ${c.guilds.cache.size} guilds`);
    startReminder(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        // Slash commands
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (command) await command.execute(interaction);
            return;
        }

        // Buttons
        if (interaction.isButton()) {
            // Handle special add-flow buttons
            if (interaction.customId === 'add_confirm') {
                return handleAddConfirm(interaction);
            }
            if (interaction.customId === 'add_without_date') {
                return handleAddWithoutDate(interaction);
            }
            if (interaction.customId === 'cancel_add') {
                return interaction.update({ content: '❌ キャンセルしました', components: [], embeds: [] });
            }
            if (interaction.customId === 'add_assignee_btn') {
                return handleShowAssigneeSelect(interaction);
            }
            if (interaction.customId.startsWith('settings_reminder_ch')) {
                return handleShowChannelSelect(interaction, 'reminder');
            }
            if (interaction.customId.startsWith('settings_todo_ch')) {
                return handleShowChannelSelect(interaction, 'todo');
            }
            if (interaction.customId === 'settings_add_category') {
                return handleShowCategoryModal(interaction);
            }
            await handleButton(interaction);
            return;
        }

        // Modals
        if (interaction.isModalSubmit()) {
            await handleModal(interaction);
            return;
        }

        // Select menus (string and channel and user)
        if (interaction.isStringSelectMenu()) {
            await handleSelect(interaction);
            return;
        }
        if (interaction.isChannelSelectMenu()) {
            await handleSelect(interaction);
            return;
        }
        if (interaction.isUserSelectMenu()) {
            await handleSelect(interaction);
            return;
        }
    } catch (error) {
        console.error('Interaction error:', error);
        const content = '⚠️ エラーが発生しました。もう一度お試しください。';
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content, ephemeral: true });
            } else {
                await interaction.reply({ content, ephemeral: true });
            }
        } catch {
            // Already handled
        }
    }
});

// ── Special interaction handlers ──

async function handleAddConfirm(interaction) {
    const stateKey = `${interaction.user.id}_${interaction.guild.id}`;
    const state = userStates.get(stateKey);
    if (!state) {
        return interaction.update({ content: '⚠️ セッションが期限切れです。もう一度 /todo から追加してください。', components: [] });
    }

    addTodo(interaction.guild.id, state);
    userStates.delete(stateKey);

    const parts = [`✅ タスクを追加しました: **${state.name}**`];
    if (state.due_date) {
        const d = new Date(state.due_date);
        parts.push(`📅 期限: <t:${Math.floor(d.getTime() / 1000)}:F>`);
    }
    if (state.assignee_id) parts.push(`👤 担当者: <@${state.assignee_id}>`);

    await interaction.update({ content: parts.join('\n'), components: [], embeds: [] });
}

async function handleAddWithoutDate(interaction) {
    const stateKey = `${interaction.user.id}_${interaction.guild.id}`;
    const state = userStates.get(stateKey);

    // Find the name from the message content
    const message = interaction.message.content;
    const nameMatch = message.match(/タスク名「(.+?)」/);
    const name = nameMatch ? nameMatch[1] : 'タスク';

    addTodo(interaction.guild.id, {
        name,
        priority: 0,
        created_by: interaction.user.id,
    });

    if (state) userStates.delete(stateKey);
    await interaction.update({ content: `✅ タスクを追加しました: **${name}**（期限なし）`, components: [] });
}

async function handleShowAssigneeSelect(interaction) {
    const select = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId('add_assignee')
            .setPlaceholder('👤 担当者を選択')
    );
    await interaction.reply({ components: [select], ephemeral: true });
}

async function handleShowChannelSelect(interaction, type) {
    const customId = type === 'reminder' ? 'select_reminder_ch' : 'select_todo_ch';
    const label = type === 'reminder' ? '⏰ リマインダーチャンネルを選択' : '📋 ToDoチャンネルを選択';

    const select = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(label)
            .addChannelTypes(ChannelType.GuildText)
    );
    await interaction.reply({ components: [select], ephemeral: true });
}

async function handleShowCategoryModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('modal_add_category')
        .setTitle('📁 カテゴリを追加');

    const nameInput = new TextInputBuilder()
        .setCustomId('category_name')
        .setLabel('カテゴリ名')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50);

    const emojiInput = new TextInputBuilder()
        .setCustomId('category_emoji')
        .setLabel('絵文字（省略可）')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
        .setPlaceholder('📁');

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(emojiInput),
    );

    await interaction.showModal(modal);
}

// Login
client.login(process.env.DISCORD_TOKEN);
