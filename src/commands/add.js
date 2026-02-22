const { SlashCommandBuilder } = require('discord.js');
const { addTodo, getGuildSettings } = require('../database');

const command = new SlashCommandBuilder()
    .setName('add')
    .setDescription('どこからでもタスクをすばやく追加します')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('タスクの名前')
            .setRequired(true)
    )
    .addIntegerOption(option =>
        option.setName('priority')
            .setDescription('重要度')
            .setRequired(false)
            .addChoices(
                { name: '🟢 低', value: 0 },
                { name: '🟡 中', value: 1 },
                { name: '🟠 高', value: 2 },
                { name: '🔴 緊急', value: 3 },
            )
    )
    .addUserOption(option =>
        option.setName('assignee')
            .setDescription('担当者')
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName('due')
            .setDescription('期限（自然言語OK: "明日", "来週月曜", "3日後"）')
            .setRequired(false)
    );

async function execute(interaction) {
    const name = interaction.options.getString('name');
    const priority = interaction.options.getInteger('priority') ?? 0;
    const assignee = interaction.options.getUser('assignee');
    const dueInput = interaction.options.getString('due');

    let dueDate = null;
    if (dueInput) {
        await interaction.deferReply({ ephemeral: true });
        const { parseDateWithGemini } = require('../gemini');
        dueDate = await parseDateWithGemini(dueInput);
        if (!dueDate) {
            return interaction.editReply({
                content: `⚠️ 日時を解析できませんでした: "${dueInput}"\nYYYY-MM-DD形式で再入力するか、別の表現をお試しください。`,
            });
        }
    }

    addTodo(interaction.guild.id, {
        name,
        priority,
        due_date: dueDate,
        assignee_id: assignee?.id ?? null,
        created_by: interaction.user.id,
    });

    const parts = [`✅ タスクを追加しました: **${name}**`];
    if (dueDate) {
        const d = new Date(dueDate);
        parts.push(`📅 期限: <t:${Math.floor(d.getTime() / 1000)}:F>`);
    }
    if (assignee) parts.push(`👤 担当者: ${assignee}`);

    const payload = { content: parts.join('\n'), ephemeral: true };
    if (interaction.deferred) {
        return interaction.editReply(payload);
    }
    return interaction.reply(payload);
}

module.exports = { data: command, execute };
