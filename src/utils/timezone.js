// Centralized timezone utility — always Asia/Tokyo

const TZ = 'Asia/Tokyo';

/**
 * Get current date/time as ISO-like string in JST: YYYY-MM-DDTHH:mm:ss
 */
function nowJST() {
    return formatDateJST(new Date());
}

/**
 * Format a Date object to YYYY-MM-DDTHH:mm:ss in JST
 */
function formatDateJST(date) {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type) => parts.find(p => p.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Get today's date string in JST: YYYY-MM-DD
 */
function todayJST() {
    return nowJST().slice(0, 10);
}

/**
 * Parse a JST datetime string (YYYY-MM-DDTHH:mm:ss) into a Unix timestamp (seconds).
 * This correctly interprets the string as JST (+09:00).
 */
function jstToUnix(dateStr) {
    if (!dateStr) return null;
    // If already has timezone info, parse directly
    if (dateStr.includes('Z') || dateStr.includes('+') || dateStr.includes('-', 10)) {
        return Math.floor(new Date(dateStr).getTime() / 1000);
    }
    // Treat as JST by appending +09:00
    return Math.floor(new Date(dateStr + '+09:00').getTime() / 1000);
}

/**
 * Format a JST datetime string for display in Japanese locale.
 * Returns e.g. "2025/02/23"
 */
function formatDateDisplayJST(dateStr) {
    if (!dateStr) return '';
    const ts = jstToUnix(dateStr);
    if (!ts) return dateStr;
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('ja-JP', { timeZone: TZ });
}

module.exports = { TZ, nowJST, formatDateJST, todayJST, jstToUnix, formatDateDisplayJST };

/**
 * Format a Discord mention for a user or role.
 * @param {string} id - Discord user or role ID
 * @param {string} type - 'user' or 'role'
 */
function formatMention(id, type) {
    if (!id) return '';
    return type === 'role' ? `<@&${id}>` : `<@${id}>`;
}

module.exports.formatMention = formatMention;
