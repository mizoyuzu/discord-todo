const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Models to try in order. Free tier models get rate-limited intermittently.
const MODELS = [
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'google/gemma-3-12b-it:free',
    'google/gemma-3-4b-it:free',
];

// Some models (Gemma via Google AI Studio) don't support system messages
const NO_SYSTEM_MSG_MODELS = new Set([
    'google/gemma-3-12b-it:free',
    'google/gemma-3-4b-it:free',
]);

const TIMEOUT_MS = 30000;

/**
 * Call OpenRouter API with multi-model fallback.
 * Tries each model once; on 429 or 5xx, moves to the next model immediately.
 */
async function callOpenRouter(messages, maxTokens = 256) {
    const apiKey = process.env.OPEN_ROUTER_API_KEY;
    if (!apiKey) {
        throw new Error('OPEN_ROUTER_API_KEY is not set');
    }

    let lastError;

    for (const model of MODELS) {
        // If model doesn't support system messages, merge into user message
        let msgs = messages;
        if (NO_SYSTEM_MSG_MODELS.has(model) && messages.length >= 2 && messages[0].role === 'system') {
            msgs = [
                {
                    role: 'user',
                    content: messages[0].content + '\n\n' + messages.slice(1).map(m => m.content).join('\n'),
                },
            ];
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            console.log(`[LLM] Trying ${model}...`);
            const response = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://github.com/discord-todo-bot',
                    'X-Title': 'Discord ToDo Bot',
                },
                body: JSON.stringify({
                    model,
                    messages: msgs,
                    max_tokens: maxTokens,
                    temperature: 0,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (response.status === 429 || response.status >= 500) {
                console.log(`[LLM] ${model} returned ${response.status}, trying next...`);
                lastError = new Error(`${model}: status ${response.status}`);
                continue;
            }

            if (response.status === 400) {
                // Bad request (e.g. system msg not supported) - try next
                const body = await response.text().catch(() => '');
                console.log(`[LLM] ${model} returned 400, trying next...`);
                lastError = new Error(`${model}: 400 ${body.substring(0, 100)}`);
                continue;
            }

            if (!response.ok) {
                const body = await response.text().catch(() => '');
                lastError = new Error(`${model}: ${response.status} ${body.substring(0, 100)}`);
                continue;
            }

            const data = await response.json();
            const content = data?.choices?.[0]?.message?.content;
            if (!content) {
                lastError = new Error(`${model}: empty response`);
                continue;
            }

            console.log(`[LLM] ${model} responded OK`);
            return content.trim();
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                console.log(`[LLM] ${model} timed out, trying next...`);
                lastError = new Error(`${model}: timeout`);
                continue;
            }
            lastError = err;
            continue;
        }
    }

    throw lastError || new Error('All models failed');
}

function extractJSON(text) {
    // Try to find JSON in markdown code blocks first
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        return JSON.parse(fenceMatch[1].trim());
    }
    // Try to find a JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(text.trim());
}

const { nowJST, TZ } = require('./utils/timezone');

function getCurrentTimeString() {
    return nowJST();
}

function getDayOfWeek(dateStr) {
    const days = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
    const d = new Date(dateStr);
    return days[d.getDay()] || '';
}

async function parseDateWithLLM(input) {
    if (!input || !input.trim()) return null;

    const currentTime = getCurrentTimeString();
    const tz = TZ;
    const dow = getDayOfWeek(currentTime);

    const messages = [
        {
            role: 'system',
            content: 'You are a date parser. Given the current date/time and a Japanese natural language date expression, output ONLY an ISO 8601 date string (YYYY-MM-DDTHH:mm:ss). No other text. If time not specified, use 23:59:59.',
        },
        {
            role: 'user',
            content: `Current date/time: ${currentTime} (${tz}, ${dow})\nDate expression: ${input}`,
        },
    ];

    try {
        const result = await callOpenRouter(messages, 512);
        const match = result.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
        if (match) return match[1];
        console.error('[DateParser] No date found in LLM response:', result);
        return null;
    } catch (err) {
        console.error('[DateParser] All models failed:', err.message);
        return null;
    }
}

async function parseNaturalLanguageTodo(input, guildMembers, categories, guildRoles) {
    const fallback = {
        name: input,
        due_date: null,
        assignee_id: null,
        assignee_type: 'user',
        priority: null,
        recurrence: null,
        category_id: null,
        reminder_at: null,
    };

    try {
        const currentTime = getCurrentTimeString();
        const tz = TZ;
        const dow = getDayOfWeek(currentTime);

        const memberList = (guildMembers || []).map(m =>
            `- ID: "${m.id}", Display: "${m.displayName}", Username: "${m.username}"`
        ).join('\n');
        const roleList = (guildRoles || []).map(r =>
            `- ID: "${r.id}", Name: "${r.name}"`
        ).join('\n');
        const categoryList = (categories || []).map(c =>
            `- ID: ${c.id}, Name: "${c.name}"`
        ).join('\n');

        const systemPrompt = `You are a task parser for a Japanese-language Discord ToDo bot.
Extract structured task info from user input.

Current: ${currentTime} (${tz}, ${dow})

Members:
${memberList || '(none)'}

Roles:
${roleList || '(none)'}

Categories:
${categoryList || '(none)'}

Return ONLY a JSON object:
{"name":"task name only","due_date":"YYYY-MM-DDTHH:mm:ss or null","assignee_id":"member or role ID or null","assignee_type":"user or role","priority":0-3 or null,"recurrence":"daily|weekly|monthly or null","category_id":number or null,"reminder_at":"YYYY-MM-DDTHH:mm:ss or null"}

assignee: If user specifies a person name, match to Members and set assignee_type="user". If user specifies a role name, match to Roles and set assignee_type="role". Default assignee_type="user".
Priority: 緊急/至急=3, 重要/高=2, 中=1, 低=0. Time default=23:59:59.
reminder_at: when to send a reminder notification. If user says "リマインド" or "通知" with a time, extract it. Otherwise null.
Output ONLY JSON.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: input },
        ];

        const result = await callOpenRouter(messages, 2048);
        const parsed = extractJSON(result);

        return {
            name: typeof parsed.name === 'string' && parsed.name ? parsed.name : input,
            due_date: typeof parsed.due_date === 'string' ? parsed.due_date : null,
            assignee_id: typeof parsed.assignee_id === 'string' ? parsed.assignee_id : null,
            assignee_type: parsed.assignee_type === 'role' ? 'role' : 'user',
            priority: typeof parsed.priority === 'number' && parsed.priority >= 0 && parsed.priority <= 3 ? parsed.priority : null,
            recurrence: ['daily', 'weekly', 'monthly'].includes(parsed.recurrence) ? parsed.recurrence : null,
            category_id: typeof parsed.category_id === 'number' ? parsed.category_id : null,
            reminder_at: typeof parsed.reminder_at === 'string' ? parsed.reminder_at : null,
        };
    } catch (err) {
        console.error('[NLParser] All models failed:', err.message);
        return fallback;
    }
}

module.exports = {
    parseDateWithLLM,
    parseNaturalLanguageTodo,
};
