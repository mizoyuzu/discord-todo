const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000;

async function callOpenRouter(messages, maxTokens = 256) {
  const apiKey = process.env.OPEN_ROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPEN_ROUTER_API_KEY environment variable is not set');
  }

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Longer backoff for free tier: 3s, 6s, 12s
      const delayMs = 3000 * Math.pow(2, attempt - 1);
      console.log(`[OpenRouter] Retry ${attempt}/${MAX_RETRIES} after ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/discord-todo-bot',
          'X-Title': 'Discord ToDo Bot',
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          max_tokens: maxTokens,
          temperature: 0,
          provider: {
            allow_fallbacks: true,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`OpenRouter API returned status ${response.status}`);
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenRouter API error ${response.status}: ${body}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('No content in OpenRouter response');
      }

      return content.trim();
    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        lastError = new Error('OpenRouter API request timed out');
        continue;
      }

      if (lastError && (err.message || '').includes('status')) {
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

function extractJSON(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }
  return JSON.parse(text.trim());
}

function getCurrentTimeString(timezone) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: timezone || 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type) => parts.find(p => p.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  } catch {
    return new Date().toISOString().replace('Z', '');
  }
}

async function parseDateWithLLM(input, timezone) {
  const currentTime = getCurrentTimeString(timezone);
  const tz = timezone || 'Asia/Tokyo';

  const messages = [
    {
      role: 'system',
      content: 'You are a date parser. Given the current date/time and a Japanese natural language date expression, output ONLY an ISO 8601 date string (YYYY-MM-DDTHH:mm:ss). No other text. If time not specified, use 23:59:59.',
    },
    {
      role: 'user',
      content: `Current date/time: ${currentTime} (${tz})\nDate expression: ${input}`,
    },
  ];

  const result = await callOpenRouter(messages, 64);
  const match = result.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (!match) {
    throw new Error(`Failed to parse date from LLM response: ${result}`);
  }
  return match[1];
}

async function parseNaturalLanguageTodo(input, guildMembers, categories, timezone) {
  const fallback = {
    name: input,
    due_date: null,
    assignee_id: null,
    priority: null,
    recurrence: null,
    category_id: null,
  };

  try {
    const currentTime = getCurrentTimeString(timezone);
    const tz = timezone || 'Asia/Tokyo';

    const memberList = (guildMembers || []).map(m => `- ID: "${m.id}", Display: "${m.displayName}", Username: "${m.username}"`).join('\n');
    const categoryList = (categories || []).map(c => `- ID: ${c.id}, Name: "${c.name}", Emoji: "${c.emoji || ''}"`).join('\n');

    const systemPrompt = `You are a task parser for a Japanese-language Discord ToDo bot.
Extract structured task information from the user's natural language input.

Current date/time: ${currentTime} (${tz})

Available Discord members:
${memberList || '(none)'}

Available categories:
${categoryList || '(none)'}

Return ONLY a JSON object with these fields:
- "name": string - the task name/description (content only, strip metadata like dates, assignees, priority markers)
- "due_date": string or null - ISO 8601 format (YYYY-MM-DDTHH:mm:ss). If time not specified, use 23:59:59.
- "assignee_id": string or null - the Discord user ID from the member list above that best matches any mentioned person
- "priority": number or null - 0=low, 1=mid, 2=high, 3=urgent. Infer from keywords like 至急/緊急(urgent=3), 重要/高(high=2), 中/普通(mid=1), 低(low=0)
- "recurrence": string or null - one of "daily", "weekly", "monthly" if the task repeats
- "category_id": number or null - the category ID from the list above that best matches any category hints

Output ONLY valid JSON. No markdown, no explanation.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ];

    const result = await callOpenRouter(messages, 512);
    const parsed = extractJSON(result);

    return {
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : input,
      due_date: typeof parsed.due_date === 'string' ? parsed.due_date : null,
      assignee_id: typeof parsed.assignee_id === 'string' ? parsed.assignee_id : null,
      priority: typeof parsed.priority === 'number' && parsed.priority >= 0 && parsed.priority <= 3 ? parsed.priority : null,
      recurrence: ['daily', 'weekly', 'monthly'].includes(parsed.recurrence) ? parsed.recurrence : null,
      category_id: typeof parsed.category_id === 'number' ? parsed.category_id : null,
    };
  } catch (err) {
    console.error('parseNaturalLanguageTodo failed:', err.message);
    return fallback;
  }
}

module.exports = {
  parseDateWithLLM,
  parseNaturalLanguageTodo,
};
