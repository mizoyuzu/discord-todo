// === FILE: src/handlers/modalHandler.js ===
const { getGuildSettings, addTodo, getTodoById, updateTodo, getCategories } = require('../database');
const { parseDateWithLLM } = require('../llm');
const { sendTodoList } = require('../utils/pagination');
const { ActionRowBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { userStates } = require('./buttonHandler');
const { PRIORITY_LABELS, buildConfirmationEmbed, buildCreatedEmbed } = require('../utils/embeds');
const { pendingCreations } = require('../utils/state');

async function handleModal(interaction) {
    const { customId } = interaction;

    if (customId === 'modal_add_todo') return handleAddTodoModal(interaction);
    if (customId === 'modal_edit_create') return handleEditCreateModal(interaction);
    if (customId.startsWith('modal_edit_')) return handleEditTodoModal(interaction);
    if (customId === 'modal_add_category') return handleAddCategoryModal(interaction);
    if (customId === 'modal_set_channel') return handleSetChannelModal(interaction);
}

// === Dashboard add modal → now goes through confirmation flow ===

async function handleAddTodoModal(interaction) {
    const guildId = interaction.guild.id;
    const settings = getGuildSettings(guildId);
    const name = interaction.fields.getTextInputValue('todo_name');
    const timezone = settings.timezone || 'Asia/Tokyo';

    let dueDate = null;
    try {
        const dueInput = interaction.fields.getTextInputValue('todo_due');
        if (dueInput && dueInput.trim()) {
            await interaction.deferReply();
            dueDate = await parseDateWithLLM(dueInput, timezone);
            if (!dueDate) {
                return interaction.editReply({
                    content: `⚠️ 日時を解析できませんでした: "${dueInput}"\nタスク名「${name}」は期限なしで追加しますか？`,
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('add_without_date').setLabel('期限なしで追加').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('cancel_create').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),
                    )],
                });
            }
        }
    } catch {
        // Field not present, continue without due date
    }

    // Store in pendingCreations and show confirmation
    const stateKey = `${interaction.user.id}_${guildId}`;
    const todoData = {
        name,
        priority: 0,
        due_date: dueDate,
        assignee_id: null,
        category_id: null,
        category_name: null,
        category_emoji: null,
        recurrence: null,
        created_by: interaction.user.id,
        timestamp: Date.now(),
        channelId: interaction.channelId,
    };

    // Check if we need additional fields via select menus
    const needsPriority = settings.enabled_fields.includes('priority');
    const needsAssignee = settings.enabled_fields.includes('assignee');
    const needsCategory = settings.enabled_fields.includes('category');
    const needsRecurrence = settings.enabled_fields.includes('recurrence');
    const needsMore = needsPriority || needsAssignee || needsCategory || needsRecurrence;

    if (needsMore) {
        // Store in userStates for the multi-step dashboard add flow
        userStates.set(stateKey, { ...todoData, step: 'additional' });

        const components = buildAdditionalFieldComponents(settings, guildId);
        const content = `📝 **${name}** の追加情報を設定してください（任意）\nスキップする場合は「このまま追加」を押してください`;
        const payload = { content, components };

        if (interaction.deferred) return interaction.editReply(payload);
        return interaction.reply(payload);
    }

    // No additional fields needed → show confirmation directly
    pendingCreations.set(stateKey, todoData);

    const embed = buildConfirmationEmbed(todoData, interaction.user.id);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_create').setLabel('作成する').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('edit_create').setLabel('編集する').setEmoji('✏️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cancel_create').setLabel('キャンセル').setEmoji('❌').setStyle(ButtonStyle.Secondary),
    );

    const payload = { embeds: [embed], components: [buttons] };
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

// === Edit create modal (from confirmation flow edit button) ===

async function handleEditCreateModal(interaction) {
    const guildId = interaction.guild.id;
    const stateKey = `${interaction.user.id}_${guildId}`;
    const data = pendingCreations.get(stateKey);

    if (!data) {
        return interaction.reply({ content: '⚠️ セッションが期限切れです。もう一度コマンドを実行してください。', flags: [MessageFlags.Ephemeral] });
    }

    const settings = getGuildSettings(guildId);
    const timezone = settings.timezone || 'Asia/Tokyo';

    // Read fields from modal
    const newName = interaction.fields.getTextInputValue('create_name');
    let newDue = null;
    try {
        const dueInput = interaction.fields.getTextInputValue('create_due');
        if (dueInput && dueInput.trim()) {
            await interaction.deferUpdate();
            newDue = await parseDateWithLLM(dueInput, timezone);
        }
    } catch {
        // Field not filled
    }

    let newPriority = data.priority;
    try {
        const pInput = interaction.fields.getTextInputValue('create_priority');
        if (pInput && pInput.trim()) {
            const p = parseInt(pInput);
            if (p >= 0 && p <= 3) newPriority = p;
        }
    } catch { /* */ }

    let newAssignee = data.assignee_id;
    try {
        const aInput = interaction.fields.getTextInputValue('create_assignee');
        if (aInput && aInput.trim()) {
            // Accept user ID or mention format
            const idMatch = aInput.match(/(\d{17,20})/);
            newAssignee = idMatch ? idMatch[1] : null;
        } else {
            newAssignee = null;
        }
    } catch { /* */ }

    let newRecurrence = data.recurrence;
    try {
        const rInput = interaction.fields.getTextInputValue('create_recurrence');
        if (rInput && rInput.trim()) {
            const valid = ['daily', 'weekly', 'monthly'];
            newRecurrence = valid.includes(rInput.trim().toLowerCase()) ? rInput.trim().toLowerCase() : null;
        } else {
            newRecurrence = null;
        }
    } catch { /* */ }

    // Update pending data
    data.name = newName;
    data.due_date = newDue !== null ? newDue : (newDue === null && !interaction.deferred ? data.due_date : null);
    data.priority = newPriority;
    data.assignee_id = newAssignee;
    data.recurrence = newRecurrence;
    data.timestamp = Date.now();

    // Handle due_date: if the modal had a due input but we haven't deferred yet,
    // keep old date. If deferred (meaning we parsed), use the result.
    // Simplify: if user typed something for due and we parsed it, use it.
    // If user left it empty, clear it. If user typed something unparseable, keep old.
    try {
        const dueInput = interaction.fields.getTextInputValue('create_due');
        if (!dueInput || !dueInput.trim()) {
            data.due_date = null;
        } else if (newDue) {
            data.due_date = newDue;
        }
        // else: keep data.due_date as-is (parse failed, keep old)
    } catch {
        // field not present, keep as-is
    }

    pendingCreations.set(stateKey, data);

    // Show updated confirmation
    const embed = buildConfirmationEmbed(data, interaction.user.id);
    embed.setAuthor({ name: '✏️ 編集済み' });

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_create').setLabel('作成する').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('edit_create').setLabel('編集する').setEmoji('✏️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cancel_create').setLabel('キャンセル').setEmoji('❌').setStyle(ButtonStyle.Secondary),
    );

    const payload = { embeds: [embed], components: [buttons] };
    if (interaction.deferred) {
        return interaction.editReply(payload);
    }
    return interaction.update(payload);
}

// === Edit existing todo modal ===

async function handleEditTodoModal(interaction) {
    const todoId = parseInt(interaction.customId.replace('modal_edit_', ''));
    const guildId = interaction.guild.id;
    const todo = getTodoById(todoId, guildId);
    if (!todo) {
        return interaction.reply({ content: '⚠️ タスクが見つかりません。', flags: [MessageFlags.Ephemeral] });
    }

    const newName = interaction.fields.getTextInputValue('edit_name');
    const updates = { name: newName };

    try {
        const dueInput = interaction.fields.getTextInputValue('edit_due');
        if (dueInput && dueInput.trim()) {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const settings = getGuildSettings(guildId);
            const parsed = await parseDateWithLLM(dueInput, settings.timezone || 'Asia/Tokyo');
            if (parsed) updates.due_date = parsed;
        }
    } catch {
        // Field not present
    }

    updateTodo(todoId, guildId, updates);

    const content = `✅ タスク #${todoId} を更新しました: **${newName}**`;
    if (interaction.deferred) return interaction.editReply({ content });
    return interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
}

// === Add category modal ===

async function handleAddCategoryModal(interaction) {
    const { addCategory } = require('../database');
    const guildId = interaction.guild.id;
    const name = interaction.fields.getTextInputValue('category_name');
    const emoji = interaction.fields.getTextInputValue('category_emoji') || '📁';

    const result = addCategory(guildId, name, emoji);
    if (!result) {
        return interaction.reply({ content: `⚠️ カテゴリ「${name}」は既に存在します。`, flags: [MessageFlags.Ephemeral] });
    }

    // Refresh settings view
    const settings = getGuildSettings(guildId);
    const categories = getCategories(guildId);
    const { buildSettingsEmbed } = require('../utils/embeds');
    const { buildSettingsComponents } = require('../commands/settings');
    const embed = buildSettingsEmbed(settings, categories);
    const components = buildSettingsComponents(settings, categories);

    return interaction.reply({ content: `✅ カテゴリ「${emoji} ${name}」を追加しました`, embeds: [embed], components, flags: [MessageFlags.Ephemeral] });
}

module.exports = { handleModal, buildAdditionalFieldComponents };
