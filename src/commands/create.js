const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { parseNaturalLanguageTodo } = require('../llm');
const { getCategories } = require('../database');
const { buildConfirmationEmbed } = require('../utils/embeds');
const { pendingCreations } = require('../utils/state');

const command = new SlashCommandBuilder()
    .setName('create')
    .setDescription('自然言語でタスクを作成します')
    .addStringOption(option =>
        option.setName('text')
            .setDescription('タスクの内容')
            .setRequired(true)
    );

async function execute(interaction) {
    await interaction.deferReply();
    await handleNaturalLanguageCreate(interaction, interaction.options.getString('text'));
}

/**
 * Shared NL create logic – used by /create command AND @mention handler
 */
async function handleNaturalLanguageCreate(interaction, text) {
    const guildId = interaction.guild.id;
    const categories = getCategories(guildId);

    // Fetch guild members and roles for assignee resolution
    let members = [];
    let roles = [];
    try {
        const fetched = await interaction.guild.members.fetch({ limit: 100 });
        members = fetched
            .filter(m => !m.user.bot)
            .map(m => ({
                id: m.id,
                displayName: m.displayName,
                username: m.user.username,
            }));
    } catch (e) {
        console.error('[Create] Failed to fetch members:', e.message);
    }
    try {
        roles = interaction.guild.roles.cache
            .filter(r => r.name !== '@everyone' && !r.managed)
            .map(r => ({ id: r.id, name: r.name }));
    } catch (e) {
        console.error('[Create] Failed to fetch roles:', e.message);
    }

    // Parse input via LLM
    const parsed = await parseNaturalLanguageTodo(text, members, categories, roles);

    // Resolve category name/emoji for display
    let categoryName = null;
    let categoryEmoji = null;
    if (parsed.category_id) {
        const found = categories.find(c => c.id === parsed.category_id);
        if (found) {
            categoryName = found.name;
            categoryEmoji = found.emoji;
        }
    }

    // Store pending creation
    const stateKey = `${interaction.user.id}_${guildId}`;
    const todoData = {
        name: parsed.name,
        priority: parsed.priority ?? 0,
        due_date: parsed.due_date || null,
        assignee_id: parsed.assignee_id || null,
        assignee_type: parsed.assignee_type || 'user',
        category_id: parsed.category_id || null,
        category_name: categoryName,
        category_emoji: categoryEmoji,
        recurrence: parsed.recurrence || null,
        reminder_at: parsed.reminder_at || null,
        created_by: interaction.user.id,
        timestamp: Date.now(),
        channelId: interaction.channelId,
    };
    pendingCreations.set(stateKey, todoData);

    // Build confirmation embed
    const embed = buildConfirmationEmbed(todoData, interaction.user.id);
    const aiWorked = parsed.due_date || parsed.assignee_id || parsed.priority !== null || parsed.reminder_at || parsed.name !== text;
    if (aiWorked) {
        embed.setAuthor({ name: 'AI解析結果' });
    } else {
        embed.setAuthor({ name: 'AI解析が利用できませんでした。編集してください' });
    }

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_create').setLabel('作成する').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('edit_create').setLabel('編集する').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cancel_create').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [buttons] });
}

module.exports = { data: command, execute, handleNaturalLanguageCreate };
