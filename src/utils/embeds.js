const { EmbedBuilder } = require('discord.js');

const PRIORITY_LABELS = ['🟢 低', '🟡 中', '🟠 高', '🔴 緊急'];
const PRIORITY_COLORS = [0x2ecc71, 0xf1c40f, 0xe67e22, 0xe74c3c];

function buildTodoListEmbed(todos, guildName, page, totalPages, totalCount, filters = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`📋 ${guildName} — ToDo リスト`)
        .setColor(0x5865f2)
        .setFooter({ text: `ページ ${page}/${totalPages} | 全 ${totalCount} 件` })
        .setTimestamp();

    if (todos.length === 0) {
        embed.setDescription('🎉 タスクはありません！');
        return embed;
    }

    // Filter indication
    const filterParts = [];
    if (filters.category) filterParts.push(`カテゴリ: ${filters.category}`);
    if (filters.assignee) filterParts.push(`担当者: ${filters.assignee}`);
    if (filters.priority !== undefined && filters.priority !== null) filterParts.push(`重要度: ${PRIORITY_LABELS[filters.priority]}`);
    if (filterParts.length > 0) {
        embed.setDescription(`🔍 フィルタ: ${filterParts.join(' | ')}`);
    }

    const lines = todos.map((todo, i) => {
        const num = `\`#${todo.id}\``;
        const priority = PRIORITY_LABELS[todo.priority] || PRIORITY_LABELS[0];
        let line = `${num} ${priority} **${todo.name}**`;

        const details = [];
        if (todo.due_date) {
            const d = new Date(todo.due_date);
            const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
            const now = new Date();
            const isOverdue = d < now;
            details.push(isOverdue ? `⚠️ ${dateStr}` : `📅 ${dateStr}`);
        }
        if (todo.assignee_id) details.push(`👤 <@${todo.assignee_id}>`);
        if (todo.category_name) details.push(`${todo.category_emoji || '📁'} ${todo.category_name}`);
        if (todo.recurrence) {
            const recLabels = { daily: '毎日', weekly: '毎週', monthly: '毎月' };
            details.push(`🔄 ${recLabels[todo.recurrence] || todo.recurrence}`);
        }

        if (details.length > 0) {
            line += `\n  ${details.join(' | ')}`;
        }

        return line;
    });

    embed.addFields({ name: '​', value: lines.join('\n\n') });
    return embed;
}

function buildTodoDetailEmbed(todo, client) {
    const embed = new EmbedBuilder()
        .setTitle(`📝 タスク #${todo.id}`)
        .setColor(PRIORITY_COLORS[todo.priority] || 0x5865f2)
        .addFields(
            { name: '名前', value: todo.name, inline: false },
            { name: '重要度', value: PRIORITY_LABELS[todo.priority] || PRIORITY_LABELS[0], inline: true },
            { name: 'ステータス', value: todo.completed ? '✅ 完了' : '⏳ 未完了', inline: true },
        );

    if (todo.due_date) {
        const d = new Date(todo.due_date);
        embed.addFields({ name: '期限', value: `<t:${Math.floor(d.getTime() / 1000)}:F>`, inline: true });
    }
    if (todo.assignee_id) {
        embed.addFields({ name: '担当者', value: `<@${todo.assignee_id}>`, inline: true });
    }
    if (todo.category_name) {
        embed.addFields({ name: 'カテゴリ', value: `${todo.category_emoji || '📁'} ${todo.category_name}`, inline: true });
    }
    if (todo.recurrence) {
        const recLabels = { daily: '毎日', weekly: '毎週', monthly: '毎月' };
        embed.addFields({ name: '繰り返し', value: `🔄 ${recLabels[todo.recurrence] || todo.recurrence}`, inline: true });
    }
    embed.addFields({ name: '作成者', value: `<@${todo.created_by}>`, inline: true });
    embed.setFooter({ text: `作成日: ${new Date(todo.created_at).toLocaleDateString('ja-JP')}` });

    return embed;
}

function buildReminderEmbed(todayTodos, overdueTodos, client) {
    const embed = new EmbedBuilder()
        .setTitle('⏰ 今日のリマインダー')
        .setColor(0xffa500)
        .setTimestamp();

    if (overdueTodos.length > 0) {
        const lines = overdueTodos.map(t => {
            const d = new Date(t.due_date);
            const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
            const assignee = t.assignee_id ? ` 👤 <@${t.assignee_id}>` : '';
            return `⚠️ \`#${t.id}\` **${t.name}** — 期限: ${dateStr}${assignee}`;
        });
        embed.addFields({ name: `🚨 期限超過 (${overdueTodos.length}件)`, value: lines.join('\n') });
    }

    if (todayTodos.length > 0) {
        const lines = todayTodos.map(t => {
            const assignee = t.assignee_id ? ` 👤 <@${t.assignee_id}>` : '';
            return `📌 \`#${t.id}\` **${t.name}**${assignee}`;
        });
        embed.addFields({ name: `📅 今日の期限 (${todayTodos.length}件)`, value: lines.join('\n') });
    }

    if (overdueTodos.length === 0 && todayTodos.length === 0) {
        embed.setDescription('🎉 今日のタスクはありません！');
    }

    return embed;
}

function buildSettingsEmbed(settings, categories) {
    const fieldLabels = {
        name: '📝 名前',
        priority: '⚡ 重要度',
        due_date: '📅 期限',
        assignee: '👤 担当者',
        category: '📁 カテゴリ',
        recurrence: '🔄 繰り返し',
    };

    const enabled = settings.enabled_fields.map(f => `✅ ${fieldLabels[f] || f}`);
    const allFields = Object.keys(fieldLabels);
    const disabled = allFields.filter(f => !settings.enabled_fields.includes(f)).map(f => `❌ ${fieldLabels[f] || f}`);

    const embed = new EmbedBuilder()
        .setTitle('⚙️ サーバー設定')
        .setColor(0x5865f2)
        .addFields(
            { name: '有効なフィールド', value: [...enabled, ...disabled].join('\n'), inline: true },
            { name: 'リマインダー', value: settings.reminder_channel_id ? `<#${settings.reminder_channel_id}>` : '未設定', inline: true },
            { name: 'ToDoチャンネル', value: settings.todo_channel_id ? `<#${settings.todo_channel_id}>` : '未設定', inline: true },
        );

    if (categories.length > 0) {
        embed.addFields({
            name: `カテゴリ (${categories.length})`,
            value: categories.map(c => `${c.emoji} ${c.name}`).join(' | '),
        });
    } else {
        embed.addFields({ name: 'カテゴリ', value: 'なし（設定から追加できます）' });
    }

    return embed;
}

module.exports = {
    PRIORITY_LABELS,
    PRIORITY_COLORS,
    buildTodoListEmbed,
    buildTodoDetailEmbed,
    buildReminderEmbed,
    buildSettingsEmbed,
};
