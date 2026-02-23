const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { parseNaturalLanguageTodo } = require('../llm');
const { getGuildSettings, getCategories } = require('../database');
const { buildConfirmationEmbed } = require('../utils/embeds');
const { pendingCreations } = require('../utils/state');

const command = new SlashCommandBuilder()
    .setName('create')
    .setDescription('自然言語でタスクを作成します')
    .addStringOption(option =>
        option.setName('text')
            .setDescription('タスクの内容を自由に入力（例: 「プリンターインク確認を来週の月曜に、重要度は高」）')
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
    const settings = getGuildSettings(guildId);
    const categories = getCategories(guildId);
    const timezone = settings.timezone || 'Asia/Tokyo';

    // Fetch guild members for assignee resolution
    let members = [];
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

    // Parse input via LLM
    const parsed = await parseNaturalLanguageTodo(text, members, categories, timezone);

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
        category_id: parsed.category_id || null,
        category_name: categoryName,
        category_emoji: categoryEmoji,
        recurrence: parsed.recurrence || null,
        created_by: interaction.user.id,
        timestamp: Date.now(),
        channelId: interaction.channelId,
    };
    pendingCreations.set(stateKey, todoData);

    // Build confirmation embed
    const embed = buildConfirmationEmbed(todoData, interaction.user.id);
    embed.setAuthor({ name: '🤖 AI解析結果' });

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_create').setLabel('作成する').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('edit_create').setLabel('編集する').setEmoji('✏️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cancel_create').setLabel('キャンセル').setEmoji('❌').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [buttons] });
}

module.exports = { data: command, execute, handleNaturalLanguageCreate };
