// === FILE: src/utils/embeds.js ===
const { EmbedBuilder } = require('discord.js');
const { jstToUnix } = require('./timezone');

const PRIORITY_LABELS = ['低', '中', '高', '緊急'];
const PRIORITY_COLORS = [0x2ecc71, 0xf1c40f, 0xe67e22, 0xe74c3c];

const RECURRENCE_LABELS = { daily: '毎日', weekly: '毎週', monthly: '毎月' };

function buildTodoListEmbed(todos, guildName, page, totalPages, totalCount, filters = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`${guildName} — ToDoリスト`)
        .setColor(0x5865f2)
        .setFooter({ text: `ページ ${page}/${totalPages} | 全 ${totalCount} 件` })
        .setTimestamp();

    if (todos.length === 0) {
        embed.setDescription('タスクはありません');
        return embed;
    }

    // Filter indication
    const filterParts = [];
    if (filters.category) filterParts.push(`カテゴリ: ${filters.category}`);
    if (filters.assignee) filterParts.push(`担当者: ${filters.assignee}`);
    if (filters.priority !== undefined && filters.priority !== null) filterParts.push(`重要度: ${PRIORITY_LABELS[filters.priority]}`);
    if (filterParts.length > 0) {
        embed.setDescription(`フィルタ: ${filterParts.join(' | ')}`);
    }

    const lines = todos.map((todo) => {
        const num = `\`#${todo.id}\``;
        const priority = PRIORITY_LABELS[todo.priority] || PRIORITY_LABELS[0];
        let line = `${num} [${priority}] **${todo.name}**`;

        const details = [];
        if (todo.due_date) {
            const ts = jstToUnix(todo.due_date);
            const isOverdue = ts < Math.floor(Date.now() / 1000);
            details.push(isOverdue ? `期限超過 <t:${ts}:R>` : `<t:${ts}:R>`);
        }
        if (todo.assignee_id) details.push(`<@${todo.assignee_id}>`);
        if (todo.category_name) details.push(`${todo.category_name}`);
        if (todo.recurrence) {
            details.push(`${RECURRENCE_LABELS[todo.recurrence] || todo.recurrence}`);
        }

        if (details.length > 0) {
            line += `\n  ${details.join(' | ')}`;
        }

        return line;
    });

    embed.addFields({ name: '\u200b', value: lines.join('\n\n') });
    return embed;
}

function buildRecapEmbed(todayTodos, overdueTodos) {
    const embed = new EmbedBuilder()
        .setTitle('今日のリマインダー')
        .setColor(0xffa500)
        .setTimestamp();

    if (overdueTodos.length > 0) {
        const lines = overdueTodos.map(t => {
            const due = t.due_date ? `<t:${jstToUnix(t.due_date)}:R>` : '';
            const assignee = t.assignee_id ? `<@${t.assignee_id}>` : '';
            const parts = [`#${t.id} ${t.name}`, due, assignee].filter(Boolean);
            return parts.join(' | ');
        });
        embed.addFields({ name: `期限超過 (${overdueTodos.length}件)`, value: lines.join('\n') });
    }

    if (todayTodos.length > 0) {
        const lines = todayTodos.map(t => {
            const due = t.due_date ? `<t:${jstToUnix(t.due_date)}:R>` : '';
            const assignee = t.assignee_id ? `<@${t.assignee_id}>` : '';
            const parts = [`#${t.id} ${t.name}`, due, assignee].filter(Boolean);
            return parts.join(' | ');
        });
        embed.addFields({ name: `今日の期限 (${todayTodos.length}件)`, value: lines.join('\n') });
    }

    if (overdueTodos.length === 0 && todayTodos.length === 0) {
        embed.setDescription('今日のタスクはありません');
    }

    return embed;
}

function buildSettingsEmbed(settings, categories) {
    const fieldLabels = {
        name: '名前',
        priority: '重要度',
        due_date: '期限',
        assignee: '担当者',
        category: 'カテゴリ',
        recurrence: '繰り返し',
    };

    const enabled = settings.enabled_fields.map(f => `[ON] ${fieldLabels[f] || f}`);
    const allFields = Object.keys(fieldLabels);
    const disabled = allFields.filter(f => !settings.enabled_fields.includes(f)).map(f => `[OFF] ${fieldLabels[f] || f}`);

    const embed = new EmbedBuilder()
        .setTitle('サーバー設定')
        .setColor(0x5865f2)
        .addFields(
            { name: '有効なフィールド', value: [...enabled, ...disabled].join('\n'), inline: true },
            { name: 'リマインダー', value: settings.reminder_channel_id ? `<#${settings.reminder_channel_id}>` : '未設定', inline: true },
            { name: 'ToDoチャンネル', value: settings.todo_channel_id ? `<#${settings.todo_channel_id}>` : '未設定', inline: true },
        );

    if (categories.length > 0) {
        embed.addFields({
            name: `カテゴリ (${categories.length})`,
            value: categories.map(c => c.name).join(' | '),
        });
    } else {
        embed.addFields({ name: 'カテゴリ', value: 'なし' });
    }

    return embed;
}

function buildConfirmationEmbed(data, creatorId) {
    const priorityVal = data.priority ?? 0;
    const embed = new EmbedBuilder()
        .setTitle('タスク作成の確認')
        .setColor(PRIORITY_COLORS[priorityVal] || 0x5865f2)
        .setTimestamp();

    embed.addFields({ name: 'タスク名', value: data.name, inline: false });
    embed.addFields({ name: '重要度', value: PRIORITY_LABELS[priorityVal] || PRIORITY_LABELS[0], inline: true });

    if (data.due_date) {
        const ts = jstToUnix(data.due_date);
        embed.addFields({ name: '期限', value: `<t:${ts}:F> (<t:${ts}:R>)`, inline: true });
    } else {
        embed.addFields({ name: '期限', value: 'なし', inline: true });
    }

    if (data.assignee_id) {
        embed.addFields({ name: '担当者', value: `<@${data.assignee_id}>`, inline: true });
    }

    if (data.category_name) {
        embed.addFields({ name: 'カテゴリ', value: data.category_name, inline: true });
    }

    if (data.recurrence) {
        embed.addFields({ name: '繰り返し', value: RECURRENCE_LABELS[data.recurrence] || data.recurrence, inline: true });
    }

    if (data.reminder_at) {
        const ts = jstToUnix(data.reminder_at);
        embed.addFields({ name: 'リマインダー', value: `<t:${ts}:F>`, inline: true });
    }

    embed.setFooter({ text: `作成者: ${creatorId}` });

    return embed;
}

function buildCreatedEmbed(todo, creatorId) {
    const priorityVal = todo.priority ?? 0;
    const embed = new EmbedBuilder()
        .setTitle('新しいタスクが作成されました')
        .setColor(PRIORITY_COLORS[priorityVal] || 0x5865f2)
        .setDescription('完了にするにはボタンを押してください')
        .setTimestamp();

    embed.addFields({ name: 'タスク名', value: todo.name, inline: false });
    embed.addFields({ name: '重要度', value: PRIORITY_LABELS[priorityVal] || PRIORITY_LABELS[0], inline: true });

    if (todo.due_date) {
        const ts = jstToUnix(todo.due_date);
        embed.addFields({ name: '期限', value: `<t:${ts}:F> (<t:${ts}:R>)`, inline: true });
    }

    if (todo.assignee_id) {
        embed.addFields({ name: '担当者', value: `<@${todo.assignee_id}>`, inline: true });
    }

    if (todo.category_name) {
        embed.addFields({ name: 'カテゴリ', value: todo.category_name, inline: true });
    }

    if (todo.recurrence) {
        embed.addFields({ name: '繰り返し', value: RECURRENCE_LABELS[todo.recurrence] || todo.recurrence, inline: true });
    }

    if (todo.reminder_at) {
        const ts = jstToUnix(todo.reminder_at);
        embed.addFields({ name: 'リマインダー', value: `<t:${ts}:F>`, inline: true });
    }

    embed.addFields({ name: '作成者', value: `<@${creatorId}>`, inline: true });

    return embed;
}

function buildReminderNotificationEmbed(todo) {
    const priorityVal = todo.priority ?? 0;
    const embed = new EmbedBuilder()
        .setTitle('リマインダー')
        .setColor(PRIORITY_COLORS[priorityVal] || 0xffa500)
        .setTimestamp();

    const parts = [`#${todo.id} ${todo.name}`];
    if (todo.due_date) {
        const ts = jstToUnix(todo.due_date);
        parts.push(`期限: <t:${ts}:F>`);
    }
    if (todo.assignee_id) {
        parts.push(`担当: <@${todo.assignee_id}>`);
    }

    embed.setDescription(parts.join(' | '));
    return embed;
}

module.exports = {
    PRIORITY_LABELS,
    PRIORITY_COLORS,
    RECURRENCE_LABELS,
    buildTodoListEmbed,
    buildRecapEmbed,
    buildSettingsEmbed,
    buildConfirmationEmbed,
    buildCreatedEmbed,
    buildReminderNotificationEmbed,
};
