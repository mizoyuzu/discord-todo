require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { startReminder } = require('./reminder');
const { handleButton, userStates } = require('./handlers/buttonHandler');
const { handleModal } = require('./handlers/modalHandler');
const { handleSelect } = require('./handlers/selectHandler');
const { getGuildSettings, addTodo, getCategories } = require('./database');
const { sendTodoList } = require('./utils/pagination');
const { buildConfirmationEmbed, buildCreatedEmbed } = require('./utils/embeds');
const { pendingCreations } = require('./utils/state');
const { handleNaturalLanguageCreate } = require('./commands/create');
const {
    ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    UserSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
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
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
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
    console.log(`Logged in as ${c.user.tag}`);
    console.log(`Serving ${c.guilds.cache.size} guilds`);
    startReminder(client);
});

// ── @mention handler: natural language task creation ──
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.mentions.has(client.user)) return;

    let text = message.content
        .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
        .trim();

    if (!text) {
        return message.reply('タスクの内容を書いてください');
    }

    try {
        let replyMsg = await message.reply('解析中...');

        const fakeInteraction = {
            user: message.author,
            guild: message.guild,
            channelId: message.channelId,
            replied: true,
            deferred: true,
            editReply: async (payload) => {
                if (typeof payload === 'string') payload = { content: payload };
                return replyMsg.edit(payload);
            },
            followUp: async (payload) => {
                return message.channel.send(payload);
            },
        };

        await handleNaturalLanguageCreate(fakeInteraction, text);
    } catch (error) {
        console.error('Mention handler error:', error);
        message.reply('エラーが発生しました。もう一度お試しください。').catch(() => {});
    }
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
            if (interaction.customId === 'add_confirm') {
                return handleAddConfirm(interaction);
            }
            if (interaction.customId === 'add_without_date') {
                return handleAddWithoutDate(interaction);
            }
            if (interaction.customId === 'add_assignee_btn') {
                return handleShowAssigneeSelect(interaction);
            }
            if (interaction.customId === 'add_role_btn') {
                return handleShowRoleSelect(interaction);
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

        // Select menus
        if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isUserSelectMenu()) {
            await handleSelect(interaction);
            return;
        }
    } catch (error) {
        console.error('Interaction error:', error);
        const content = 'エラーが発生しました。もう一度お試しください。';
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content, flags: [MessageFlags.Ephemeral] });
            } else {
                await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
            }
        } catch {
            // Already handled
        }
    }
});

// ── Special interaction handlers (dashboard add flow) ──

async function handleAddConfirm(interaction) {
    const guildId = interaction.guild.id;
    const stateKey = `${interaction.user.id}_${guildId}`;
    const state = userStates.get(stateKey);
    if (!state) {
        return interaction.update({ content: 'セッションが期限切れです。もう一度 /todo から追加してください。', components: [] });
    }

    const todoData = {
        name: state.name,
        priority: state.priority ?? 0,
        due_date: state.due_date,
        assignee_id: state.assignee_id,
        assignee_type: state.assignee_type || 'user',
        category_id: state.category_id,
        category_name: null,
        category_emoji: null,
        recurrence: state.recurrence,
        reminder_at: state.reminder_at || null,
        created_by: state.created_by,
        timestamp: Date.now(),
        channelId: interaction.channelId,
    };

    if (todoData.category_id) {
        const cats = getCategories(guildId);
        const cat = cats.find(c => c.id === todoData.category_id);
        if (cat) {
            todoData.category_name = cat.name;
            todoData.category_emoji = cat.emoji;
        }
    }

    pendingCreations.set(stateKey, todoData);
    userStates.delete(stateKey);

    const embed = buildConfirmationEmbed(todoData, interaction.user.id);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_create').setLabel('作成する').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('edit_create').setLabel('編集する').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cancel_create').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({ content: null, embeds: [embed], components: [buttons] });
}

async function handleAddWithoutDate(interaction) {
    const guildId = interaction.guild.id;
    const stateKey = `${interaction.user.id}_${guildId}`;

    const message = interaction.message.content;
    const nameMatch = message.match(/タスク名「(.+?)」/);
    const name = nameMatch ? nameMatch[1] : 'タスク';

    const todoData = {
        name,
        priority: 0,
        due_date: null,
        assignee_id: null,
        assignee_type: 'user',
        category_id: null,
        category_name: null,
        category_emoji: null,
        recurrence: null,
        reminder_at: null,
        created_by: interaction.user.id,
        timestamp: Date.now(),
        channelId: interaction.channelId,
    };
    pendingCreations.set(stateKey, todoData);

    const embed = buildConfirmationEmbed(todoData, interaction.user.id);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_create').setLabel('作成する').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('edit_create').setLabel('編集する').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cancel_create').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({ content: null, embeds: [embed], components: [buttons] });
}

async function handleShowAssigneeSelect(interaction) {
    const select = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId('add_assignee')
            .setPlaceholder('担当者を選択')
    );
    await interaction.reply({ components: [select], flags: [MessageFlags.Ephemeral] });
}

async function handleShowRoleSelect(interaction) {
    const select = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId('add_role')
            .setPlaceholder('ロールを選択')
    );
    await interaction.reply({ components: [select], flags: [MessageFlags.Ephemeral] });
}

async function handleShowChannelSelect(interaction, type) {
    const customId = type === 'reminder' ? 'select_reminder_ch' : 'select_todo_ch';
    const label = type === 'reminder' ? 'リマインダーチャンネルを選択' : 'ToDoチャンネルを選択';

    const select = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(label)
            .addChannelTypes(ChannelType.GuildText)
    );
    await interaction.reply({ components: [select], flags: [MessageFlags.Ephemeral] });
}

async function handleShowCategoryModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('modal_add_category')
        .setTitle('カテゴリを追加');

    const nameInput = new TextInputBuilder()
        .setCustomId('category_name')
        .setLabel('カテゴリ名')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50);

    const emojiInput = new TextInputBuilder()
        .setCustomId('category_emoji')
        .setLabel('絵文字')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10);

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(emojiInput),
    );

    await interaction.showModal(modal);
}

client.login(process.env.DISCORD_TOKEN);
