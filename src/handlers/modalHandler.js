const { getGuildSettings, addTodo, getTodoById, updateTodo, getCategories } = require('../database');
const { parseDateWithGemini } = require('../gemini');
const { sendTodoList } = require('../utils/pagination');
const { ActionRowBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { userStates } = require('./buttonHandler');
const { PRIORITY_LABELS } = require('../utils/embeds');

async function handleModal(interaction) {
    const { customId } = interaction;

    if (customId === 'modal_add_todo') return handleAddTodoModal(interaction);
    if (customId.startsWith('modal_edit_')) return handleEditTodoModal(interaction);
    if (customId === 'modal_add_category') return handleAddCategoryModal(interaction);
    if (customId === 'modal_set_channel') return handleSetChannelModal(interaction);
}

async function handleAddTodoModal(interaction) {
    const guildId = interaction.guild.id;
    const settings = getGuildSettings(guildId);
    const name = interaction.fields.getTextInputValue('todo_name');

    let dueDate = null;
    try {
        const dueInput = interaction.fields.getTextInputValue('todo_due');
        if (dueInput && dueInput.trim()) {
            await interaction.deferReply({ ephemeral: true });
            dueDate = await parseDateWithGemini(dueInput, settings.timezone || 'Asia/Tokyo');
            if (!dueDate) {
                return interaction.editReply({
                    content: `⚠️ 日時を解析できませんでした: "${dueInput}"\nタスク名「${name}」は期限なしで追加しますか？`,
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('add_without_date').setLabel('期限なしで追加').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('cancel_add').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),
                    )],
                });
            }
        }
    } catch {
        // Field not present, continue without due date
    }

    // Save initial data in state for multi-step flow
    const todoData = {
        name,
        priority: 0,
        due_date: dueDate,
        assignee_id: null,
        category_id: null,
        recurrence: null,
        created_by: interaction.user.id,
    };

    // Check if we need additional fields
    const needsPriority = settings.enabled_fields.includes('priority');
    const needsAssignee = settings.enabled_fields.includes('assignee');
    const needsCategory = settings.enabled_fields.includes('category');
    const needsRecurrence = settings.enabled_fields.includes('recurrence');
    const needsMore = needsPriority || needsAssignee || needsCategory || needsRecurrence;

    if (!needsMore) {
        // No additional fields needed, add directly
        addTodo(guildId, todoData);
        const content = `✅ タスクを追加しました: **${name}**` + (dueDate ? `\n📅 期限: <t:${Math.floor(new Date(dueDate).getTime() / 1000)}:F>` : '');
        if (interaction.deferred) return interaction.editReply({ content });
        return interaction.reply({ content, ephemeral: true });
    }

    // Store state and show additional options
    const stateKey = `${interaction.user.id}_${guildId}`;
    userStates.set(stateKey, { ...todoData, timestamp: Date.now(), step: 'additional' });

    const components = buildAdditionalFieldComponents(settings, guildId);

    const content = `📝 **${name}** の追加情報を設定してください（任意）\nスキップする場合は「このまま追加」を押してください`;
    const payload = { content, components, ephemeral: true };

    if (interaction.deferred) return interaction.editReply(payload);
    return interaction.reply(payload);
}

function buildAdditionalFieldComponents(settings, guildId) {
    const rows = [];

    if (settings.enabled_fields.includes('priority')) {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('add_priority')
                .setPlaceholder('⚡ 重要度を選択')
                .addOptions(
                    PRIORITY_LABELS.map((label, i) => ({ label, value: `${i}` }))
                )
        ));
    }

    if (settings.enabled_fields.includes('category')) {
        const categories = getCategories(guildId);
        if (categories.length > 0) {
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('add_category')
                    .setPlaceholder('📁 カテゴリを選択')
                    .addOptions(categories.map(c => ({
                        label: c.name,
                        value: `${c.id}`,
                        emoji: c.emoji || '📁',
                    })))
            ));
        }
    }

    if (settings.enabled_fields.includes('recurrence')) {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('add_recurrence')
                .setPlaceholder('🔄 繰り返しを選択')
                .addOptions([
                    { label: 'なし', value: 'none', emoji: '❌' },
                    { label: '毎日', value: 'daily', emoji: '📅' },
                    { label: '毎週', value: 'weekly', emoji: '📆' },
                    { label: '毎月', value: 'monthly', emoji: '🗓️' },
                ])
        ));
    }

    // Confirm button (always add, limited to 5 rows)
    if (rows.length < 5) {
        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('add_confirm').setLabel('このまま追加').setEmoji('✅').setStyle(ButtonStyle.Success),
        );

        if (settings.enabled_fields.includes('assignee')) {
            confirmRow.addComponents(
                new ButtonBuilder().setCustomId('add_assignee_btn').setLabel('担当者を設定').setEmoji('👤').setStyle(ButtonStyle.Primary),
            );
        }

        rows.push(confirmRow);
    }

    return rows.slice(0, 5);
}

async function handleEditTodoModal(interaction) {
    const todoId = parseInt(interaction.customId.replace('modal_edit_', ''));
    const guildId = interaction.guild.id;
    const todo = getTodoById(todoId, guildId);
    if (!todo) {
        return interaction.reply({ content: '⚠️ タスクが見つかりません。', ephemeral: true });
    }

    const newName = interaction.fields.getTextInputValue('edit_name');
    const updates = { name: newName };

    try {
        const dueInput = interaction.fields.getTextInputValue('edit_due');
        if (dueInput && dueInput.trim()) {
            await interaction.deferReply({ ephemeral: true });
            const settings = getGuildSettings(guildId);
            const parsed = await parseDateWithGemini(dueInput, settings.timezone || 'Asia/Tokyo');
            if (parsed) updates.due_date = parsed;
        }
    } catch {
        // Field not present
    }

    updateTodo(todoId, guildId, updates);

    const content = `✅ タスク #${todoId} を更新しました: **${newName}**`;
    if (interaction.deferred) return interaction.editReply({ content });
    return interaction.reply({ content, ephemeral: true });
}

async function handleAddCategoryModal(interaction) {
    const { addCategory } = require('../database');
    const guildId = interaction.guild.id;
    const name = interaction.fields.getTextInputValue('category_name');
    const emoji = interaction.fields.getTextInputValue('category_emoji') || '📁';

    const result = addCategory(guildId, name, emoji);
    if (!result) {
        return interaction.reply({ content: `⚠️ カテゴリ「${name}」は既に存在します。`, ephemeral: true });
    }

    // Refresh settings view
    const settings = getGuildSettings(guildId);
    const categories = getCategories(guildId);
    const { buildSettingsEmbed } = require('../utils/embeds');
    const { buildSettingsComponents } = require('../commands/settings');
    const embed = buildSettingsEmbed(settings, categories);
    const components = buildSettingsComponents(settings, categories);

    return interaction.reply({ content: `✅ カテゴリ「${emoji} ${name}」を追加しました`, embeds: [embed], components, ephemeral: true });
}

module.exports = { handleModal };
