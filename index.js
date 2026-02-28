require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const axios = require("axios");
const P = require("pino");
const express = require("express");
const qrcode = require("qrcode"); // instead of qrcode-terminal
const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeDataURL = null; // store latest QR code

app.get("/", async (_, res) => {
  // If bot is logged in, just show a message
  if (!qrCodeDataURL) {
    res.send(`
      <h2>Kiroflix WhatsApp Bot</h2>
      <p>Bot is connected ✅</p>
    `);
  } else {
    res.send(`
      <h2>Kiroflix WhatsApp Bot</h2>
      <p>Scan this QR code to login:</p>
      <img src="${qrCodeDataURL}" alt="WhatsApp QR" />
    `);
  }
});

app.listen(PORT, () => console.log("[SERVER] Running on", PORT));
// Track users that are currently being processed
const userLocks = new Map();
// -------------------- CONFIG --------------------
const GEMINI_KEY = process.env.GEMINI_KEY;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent";

// -------------------- LOGGER --------------------
function logStep(step, data = "") {
  console.log(`\n===== ${step} =====`);
  if (data) console.log(data);
}

function logError(context, err) {
  console.error(`\n❌ ERROR in ${context}`);
  console.error(err.message);
}

// -------------------- AI --------------------
async function askAI(prompt) {
  try {
    const { data } = await axios.post(
      `${GEMINI_URL}?key=${GEMINI_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] }
    );

    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err) {
    logError("AI CALL", err);
    return "";
  }
}
// -------------------- INTENT --------------------
async function parseIntent(text) {
  try {
    logStep("USER MESSAGE", text);

   const prompt = `
You are an anime title parser.

GOAL:
1️⃣ Detect the anime title from ANY language (Arabic, French, Japanese romaji, etc.)
2️⃣ Convert it to the MOST COMMON OFFICIAL TITLE in English or Romaji.
3️⃣ Extract season/part (if any)
4️⃣ Extract episode number

IMPORTANT BEHAVIOR:
✅ If the user ONLY sends an anime title with NO episode number:
→ set episode = 1

✅ If the title is a MOVIE anime:
→ set episode = 1

- If you are NOT sure what anime it is → return {"notFound": true}
- NEVER guess.
- Return ONLY JSON.

FORMAT:
{
  "title":"official anime title",
  "season":null,
  "episode":number,
  "subtitle":false,
  "subtitleLang":null,
  "notFound":false
}

User: ${text}
`;
    let res = await askAI(prompt);
    res = res.replace(/```json|```/gi, "").trim();
    const json = res.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("No JSON from AI");

    const parsed = JSON.parse(json);
    logStep("PARSED INTENT", parsed);

    return parsed;

  } catch (err) {
    logError("INTENT PARSE", err);

    // fallback regex for episode & subtitle
    const ep = text.match(/ep(?:isode)?\s*(\d+)/i)?.[1];
    const season = text.match(/season\s*(\d+)/i)?.[1] || null;
    const title = text
      .replace(/ep(?:isode)?\s*\d+/i, "")
      .replace(/season\s*\d+/i, "")
      .replace(/subtitle/i, "")
      .trim();

    const subtitleMatch = text.match(/subtitle(?: in)?\s*([a-zA-Z]+)/i);
    const subtitleLang = subtitleMatch ? subtitleMatch[1] : null;

    if (title && ep) {
      const fallback = { title, season, episode: Number(ep), subtitle: !!subtitleLang, subtitleLang };
      logStep("FALLBACK INTENT", fallback);
      return fallback;
    }

    return null;
  }
}

// -------------------- SEARCH --------------------
async function searchAnime(title) {
  try {
    logStep("SEARCH TITLE", title);

    const { data } = await axios.get(
      "https://kiroflix.site/backend/anime_search.php",
      { params: { q: title } }
    );

    logStep("SEARCH RESULT COUNT", data.results?.length);
    return data.results || [];

  } catch (err) {
    logError("ANIME SEARCH", err);
    return [];
  }
}
async function generalReply(userText) {
  const prompt = `
You are a friendly, helpful WhatsApp anime assistant.

User may:
- greet the bot ("hi", "hello")
- thank the bot ("thanks", "thank you")
- ask how the bot works
- chat casually

Your job:
1️⃣ Reply in a friendly, natural tone and include imojies.
2️⃣ Mention all features the bot now supports:
   - Sending anime episodes
   - Subtitle generation for episodes
   - Manhwa/manga chapter reading
3️⃣ Give suggestions if user says thanks or shows interest
4️⃣ Keep it short (1-3 sentences max)
5️⃣ Avoid repeating the same generic line

User message: "${userText}"

Respond ONLY as natural WhatsApp text, like a human.
`;

  const res = await askAI(prompt);
  return res || "👋 Hi! Send an anime or manhwa to start watching or reading 🍿";
}
// -------------------- AI MATCH --------------------
async function chooseBestAnime(intent, results) {
  try {
    const minimal = results.map(a => ({
      id: a.id,
      title: a.title
    }));

    logStep("AI MATCH INPUT", minimal);

    const prompt = `
User searching: "${intent.title}"${intent.season ? " season " + intent.season : ""}
Return ONLY the id of the best match from this list:
${JSON.stringify(minimal)}
`;

    const res = await askAI(prompt);
    const id = res.match(/\d+/)?.[0];

    if (!id) {
      logStep("AI MATCH FALLBACK", "Using first result");
      return results[0];
    }

    const anime = results.find(a => a.id === id);
    logStep("AI MATCH RESULT", anime);

    return anime || results[0];

  } catch (err) {
    logError("AI MATCH", err);
    return results[0];
  }
}
// -------------------- EPISODES --------------------
async function getEpisodes(id) {
  try {
    logStep("FETCH EPISODES FOR", id);

    const { data } = await axios.get(
      "https://kiroflix.site/backend/episodes_proxy.php",
      { params: { id } }
    );

    logStep("EPISODES COUNT", data.episodes?.length);
    return data.episodes || [];

  } catch (err) {
    logError("EPISODES FETCH", err);
    return [];
  }
}

// -------------------- STREAM GENERATOR --------------------
async function generateStream(episodeId) {
  const maxRetries = 3;
  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🎬 Generating stream (Attempt ${attempt}/${maxRetries})`);

      const { data } = await axios.get(
        "https://kiroflix.cu.ma/generate/generate_episode.php",
        {
          params: { episode_id: episodeId },
          timeout: 40000
        }
      );

      if (data?.success) {
        console.log("✅ Stream generated successfully");

        return {
          player: `https://kiroflix.cu.ma/generate/player/?episode_id=${episodeId}`,
          master: data.master,
          subtitle: data.subtitle
        };
      }

      console.log("⚠️ API responded but not successful");

    } catch (err) {
      console.error(
        `❌ Attempt ${attempt} failed:`,
        err.response?.status || err.message
      );
    }

    // Wait before retry (except last attempt)
    if (attempt < maxRetries) {
      console.log("⏳ Retrying in 2 seconds...");
      await delay(2000);
    }
  }

  console.error("🚨 All stream generation attempts failed");
  return null;
}
async function fetchAvailableSubtitles(episodeId) {
  try {
    const { data } = await axios.get(`https://kiroflix.cu.ma/generate/getsubs.php`, {
      params: { episode_id: episodeId }
    });
    return data || [];
  } catch (err) {
    console.error("❌ Failed to fetch subtitles:", err.message);
    return [];
  }
}
async function parseManhwaIntent(text) {
  try {
    const prompt = `
You are a manhwa title parser.

GOAL:
1️⃣ Detect the manhwa title (any language)
2️⃣ Convert to official common English title
3️⃣ Extract chapter number

RULES:
- If chapter not provided → set chapter = 1
- If not sure → return {"notFound": true}
- Return ONLY JSON

FORMAT:
{
  "title": "official manhwa title",
  "chapter": number,
  "notFound": false
}

User: ${text}
`;

    let res = await askAI(prompt);
    res = res.replace(/```json|```/gi, "").trim();
    const json = res.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("No JSON");

    return JSON.parse(json);
  } catch (err) {
    logError("MANHWA INTENT", err);
    return null;
  }
}
async function searchManhwa(title) {
  try {
    const { data } = await axios.get(
      "https://kiroflix.site/backend/manga_search.php",
      { params: { q: title } }
    );

    return data.results || [];
  } catch (err) {
    logError("MANHWA SEARCH", err);
    return [];
  }
}
async function chooseBestManhwa(intent, results) {
  try {
    const minimal = results.map(r => ({
      id: r.id,
      title: r.url
    }));

    const prompt = `
User searching: "${intent.title}"
Return ONLY the id of best match:
${JSON.stringify(minimal)}
`;

    const res = await askAI(prompt);
    const id = res.match(/[a-z0-9\-]+/)?.[0];

    return results.find(r => r.id === id) || results[0];
  } catch (err) {
    return results[0];
  }
}
async function getManhwaDetails(id) {
  try {
    const { data } = await axios.get(
      "https://kiroflix.site/backend/manga-details.php",
      { params: { id } }
    );

    return data.data;
  } catch (err) {
    logError("MANHWA DETAILS", err);
    return null;
  }
}
async function getChapterImages(chapterPath) {
  try {
    const { data } = await axios.get(
      "https://kiroflix.site/backend/fetch_chapter.php",
      { params: { chapter: chapterPath } }
    );

    return data.images || [];
  } catch (err) {
    logError("FETCH CHAPTER IMAGES", err);
    return [];
  }
}
async function handleManhwaRequest(text, from, sock) {
  const intent = await parseManhwaIntent(text);
  if (!intent || intent.notFound) {
    await sock.sendMessage(from, { text: "❌ Could not detect manhwa title" });
    return;
  }

  await sock.sendMessage(from, { text: "📚 Searching manhwa..." });

  const results = await searchManhwa(intent.title);
  if (!results.length) {
    await sock.sendMessage(from, { text: "❌ Manhwa not found" });
    return;
  }

  const manhwa = await chooseBestManhwa(intent, results);
  const details = await getManhwaDetails(manhwa.id);
  if (!details) {
    await sock.sendMessage(from, { text: "❌ Failed to load details" });
    return;
  }

  let chapter = details.chapters.find(c =>
    c.title.toLowerCase().includes(`chapter ${intent.chapter}`)
  );
  if (!chapter) chapter = details.chapters[0];

  const chapterPath = chapter.url.split("asuracomic.net/")[1];
  const images = await getChapterImages(chapterPath);
  if (!images.length) {
    await sock.sendMessage(from, { text: "❌ Chapter images unavailable" });
    return;
  }

  // Info card
  const caption = `
📖 *${details.title}*
⭐ Rating: ${details.rating}
📌 Status: ${details.status}
📚 Chapter: ${chapter.title}
🖊 Author: ${details.author}

🔥 ${details.synopsis.substring(0, 200)}...
`;

  if (details.poster) {
    await sock.sendMessage(from, { image: { url: details.poster }, caption });
  } else {
    await sock.sendMessage(from, { text: caption });
  }

  // Send images **one by one with a small delay**
  for (let i = 0; i < images.length; i++) {
    await sock.sendMessage(from, {
      image: { url: images[i] },
      caption: `Page ${i + 1}/${images.length}`
    });

    // Small delay to avoid flooding
    await new Promise(res => setTimeout(res, 300));
  }

  await sock.sendMessage(from, { text: "✅ End of chapter" });
}
async function detectMessageType(text) {
  try {
    const prompt = `
You are a message classifier for an anime & manhwa bot.

Classify the user message into ONE of these types:

1️⃣ "casual" → greeting, small talk, asking how bot works
2️⃣ "anime" → requesting anime episode/movie
3️⃣ "manhwa" → requesting manhwa/manga chapter
4️⃣ "unknown"

Return ONLY JSON:

{
  "type": "casual" | "anime" | "manhwa" | "unknown"
}

User: ${text}
`;

    let res = await askAI(prompt);
    res = res.replace(/```json|```/gi, "").trim();
    const json = res.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("No JSON");

    return JSON.parse(json);
  } catch (err) {
    logError("MESSAGE TYPE", err);
    return { type: "unknown" };
  }
}
async function logWAUsage({
  userJid,
  username,
  userMessage,
  aiReply,
  country = "Unknown"
}) {
  try {
    await axios.post(
      "https://kiroflix.site/backend/log_wa_usage.php",
      {
        user_jid: userJid,
        username,
        user_message: userMessage,
        ai_reply: aiReply,
        country,
        date: new Date().toISOString()
      }
    );
  } catch (err) {
    console.error("❌ Failed to log WA usage:", err.message);
  }
}
async function generateSubtitle(chatId, episodeId, lang = "English", sock) {
  // 1️⃣ Send progress message
  const progressMsg = await sock.sendMessage(chatId, {
    text: `🎯 Generating ${lang} subtitle... 0%`
  });

  const progressKey = progressMsg.key;

  try {
    // 2️⃣ Fetch base VTT (same endpoint)
    const { data: vttText } = await axios.get(
      `https://kiroflix.site/backend/vttreader.php`,
      { params: { episode_id: episodeId } }
    );

    if (!vttText) {
      await sock.sendMessage(chatId, {
        text: "⚠️ No base subtitle available for this episode"
      });
      return null;
    }

    const lines = vttText.split(/\r?\n/);

    // 3️⃣ Split into chunks
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < lines.length; i += chunkSize) {
      chunks.push([i, Math.min(i + chunkSize - 1, lines.length - 1)]);
    }

    const results = new Array(chunks.length);
    let completedChunks = 0;

    // 4️⃣ Translate chunks (same endpoint)
    await Promise.all(
      chunks.map(async ([start, end], index) => {
        try {
          const { data: translated } = await axios.post(
            `https://kiroflix.cu.ma/generate/translate_chunk.php`,
            {
              lang,
              episode_id: episodeId,
              start_line: start,
              end_line: end
            }
          );

          results[index] = translated.trim();

        } catch (err) {
          console.error(`❌ Chunk ${index} failed:`, err.message);
          results[index] = "";
        }

        // 🔄 Update progress (edit message)
        completedChunks++;
        const percent = Math.floor((completedChunks / chunks.length) * 100);

        await sock.sendMessage(chatId, {
          text: `🎯 Generating ${lang} subtitle... ${percent}%`,
          edit: progressKey
        });
      })
    );

    // 5️⃣ Combine subtitles
    const finalSubtitle = results.join("\n");
    const filename = `${lang.toLowerCase()}.vtt`;

    // 6️⃣ Save subtitle (same endpoint)
    await axios.post(`https://kiroflix.cu.ma/generate/save_subtitle.php`, {
      episode_id: episodeId,
      filename,
      content: finalSubtitle
    });

    // 7️⃣ Store in DB (same endpoint)
    const subtitleURL =
      `https://kiroflix.cu.ma/generate/episodes/${episodeId}/${filename}`;

    await axios.post(`https://kiroflix.site/backend/store_subtitle.php`, {
      episode_id: episodeId,
      language: lang,
      subtitle_url: subtitleURL
    });

    // ✅ Final update
    await sock.sendMessage(chatId, {
      text: `✅ ${lang} subtitle ready!\n${subtitleURL}`,
      edit: progressKey
    });

    return subtitleURL;

  } catch (err) {
    console.error("❌ Subtitle generation failed:", err.message);

    await sock.sendMessage(chatId, {
      text: `❌ Failed to generate ${lang} subtitle`,
      edit: progressKey
    });

    return null;
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state,
    browser: ["Kiroflix Bot", "Chrome", "1.0"]
  });

  sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
  if (qr) {
    // Convert QR to data URL for browser
    qrCodeDataURL = await qrcode.toDataURL(qr);
    console.log("📲 QR code updated. Scan from your browser!");
  }

  if (connection === "open") {
    console.log("✅ WhatsApp connected");
    qrCodeDataURL = null; // clear QR after login
  }

  if (connection === "close") {
    const shouldReconnect =
      lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
    if (shouldReconnect) startBot();
  }
});
  async function handleAnimeRequest(intent, originalText, from, thinkingKey) {
  try {
    // 🔄 Update thinking message
    await sock.sendMessage(from, {
      text: "🍿 Finding your episode...",
      edit: thinkingKey
    });

    // 🔎 Search anime
    const results = await searchAnime(intent.title);
    if (!results.length) {
      await sock.sendMessage(from, { text: "❌ Anime not found" });
      return;
    }

    const anime = await chooseBestAnime(intent, results);
    const episodes = await getEpisodes(anime.id);

    if (!episodes.length) {
      await sock.sendMessage(from, { text: "❌ Episodes unavailable" });
      return;
    }

    // 🎯 Find requested episode
    let episode = episodes.find(
      e => Number(e.number) === Number(intent.episode)
    );

    let notReleasedMessage = "";

    if (!episode) {
      const latestEpisode = episodes.reduce((max, ep) =>
        Number(ep.number) > Number(max.number) ? ep : max
      );

      episode = latestEpisode;

      notReleasedMessage =
`⚠️ Episode ${intent.episode} is not released yet.
Here is the latest available 👇

`;
    }

    // 🎬 Generate stream
    const stream = await generateStream(episode.id);
    if (!stream) {
      await sock.sendMessage(from, {
        text: "❌ Could not generate stream"
      });
      return;
    }

    const caption =
`${notReleasedMessage}🎬 ${anime.title}
📺 Episode ${episode.number}: ${episode.title}
▶️ ${stream.player}`;

    // 🖼 Send poster + caption
    if (anime.poster) {
      await sock.sendMessage(from, {
        image: { url: anime.poster },
        caption
      });
    } else {
      await sock.sendMessage(from, { text: caption });
    }

    // 🧾 Log usage
    await logWAUsage({
      userJid: from,
      username: from,
      userMessage: originalText,
      aiReply: caption
    });

    // 🎯 Subtitle logic
    if (intent.subtitle) {
      const lang = intent.subtitleLang || "English";

      const subs = await fetchAvailableSubtitles(episode.id);
      const existing = subs.find(
        s => s.lang.toLowerCase() === lang.toLowerCase()
      );

      if (existing) {
        await sock.sendMessage(from, {
          text: `🎯 Subtitle already available: ${existing.lang}`
        });
      } else {
        await generateSubtitle(from, episode.id, lang, sock);
      }
    }

  } catch (err) {
    logError("ANIME HANDLER", err);
    await sock.sendMessage(from, {
      text: "⚠️ Failed to load episode"
    });
  }
}
  async function handleGeneralRequest(text, from, thinkingKey) {
  try {
    const reply = await generalReply(text);

    await sock.sendMessage(from, {
      text: reply,
      edit: thinkingKey
    });

    await logWAUsage({
      userJid: from,
      username: from,
      userMessage: text,
      aiReply: reply
    });

  } catch (err) {
    logError("GENERAL HANDLER", err);
    await sock.sendMessage(from, {
      text: "⚠️ Failed to process your message"
    });
  }
}
  async function handleMessage(msg) {
  const userId = msg.key.remoteJid;

  if (userLocks.get(userId)) {
    console.log(`[LOCK] Skipping message from ${userId}`);
    return;
  }

  userLocks.set(userId, true);

  try {
    const from = userId;

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      "";

    if (!text) return;

    // 🧠 Send thinking message
    const thinkingMsg = await sock.sendMessage(from, {
      text: "🤔 Thinking..."
    });

    const thinkingKey = thinkingMsg.key;

    // 🧠 Detect message type
    const type = await detectMessageType(text);

    // 🎬 ANIME
    if (type.type === "anime") {
      const intent = await parseIntent(text);

      if (!intent || intent.notFound) {
        await sock.sendMessage(from, {
          text: "❌ Could not detect anime",
          edit: thinkingKey
        });
        return;
      }

      await handleAnimeRequest(intent, text, from, thinkingKey);
      return;
    }

    // 📚 MANHWA
    if (type.type === "manhwa") {
      await sock.sendMessage(from, {
        text: "📚 Loading manhwa...",
        edit: thinkingKey
      });

      await handleManhwaRequest(text, from, sock);
      return;
    }

    // 💬 CASUAL / UNKNOWN
    await handleGeneralRequest(text, from, thinkingKey);

  } catch (err) {
    logError("MAIN HANDLER", err);
    await sock.sendMessage(msg.key.remoteJid, {
      text: "⚠️ Something went wrong"
    });
  } finally {
    userLocks.delete(userId);
  }
}
  sock.ev.on("creds.update", saveCreds);

  // 📩 MAIN MESSAGE HANDLER
const COMMANDS = ["/stream"]; // commands you want to detect

sock.ev.on("messages.upsert", async ({ messages, type }) => {
  if (type !== "notify") return; // ✅ ignore duplicates

  const msg = messages[0];
  if (!msg.message) return;
  if (msg.key.fromMe) return;

  const from = msg.key.remoteJid;
  const isGroup = from.endsWith("@g.us");

  // 📝 Extract text safely
  let text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    "";

  if (!text) return;

  text = text.trim();

  // ✅ GROUP LOGIC
  if (isGroup) {
    // Only respond to /stream commands in groups
    if (!text.toLowerCase().startsWith("/stream")) return;

    // Remove "/stream" from text before sending to handler
    text = text.replace(/^\/stream/i, "").trim();
  }

  // ✅ PRIVATE CHAT
  // In private, allow everything (no command needed)

  await handleMessage({
    ...msg,
    key: { ...msg.key, remoteJid: from },
    message: { conversation: text }
  });
});
}

startBot();






