const { GoogleGenerativeAI } = require('@google/generative-ai');

let model;

function initGemini() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-lite',
        generationConfig: {
            maxOutputTokens: 50,
            temperature: 0,
        },
    });
}

/**
 * Parse natural language date/time string into ISO 8601 format.
 * @param {string} input - Natural language date string (e.g. "明日の15時", "来週月曜", "3日後")
 * @param {string} timezone - Timezone string (default: 'Asia/Tokyo')
 * @returns {Promise<string|null>} ISO 8601 date string or null on failure
 */
async function parseDateWithGemini(input, timezone = 'Asia/Tokyo') {
    if (!model) initGemini();
    if (!input || input.trim() === '') return null;

    const now = new Date().toLocaleString('ja-JP', { timeZone: timezone });

    const prompt = `現在日時: ${now}
入力: "${input}"
この入力を解釈してISO8601形式(YYYY-MM-DDTHH:mm:ss)で出力してください。日時のみ出力し、他は何も出力しないでください。時刻が指定されていない場合は23:59:59としてください。`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const result = await model.generateContent(prompt, { signal: controller.signal });
        clearTimeout(timeout);

        const text = result.response.text().trim();

        // Validate ISO 8601 format
        const match = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        if (match) {
            return match[0];
        }
        return null;
    } catch (error) {
        console.error('Gemini date parse error:', error.message);
        return null;
    }
}

module.exports = { parseDateWithGemini, initGemini };
