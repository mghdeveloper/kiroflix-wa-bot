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
2️⃣ Convert it to the MOST COMMON OFFICIAL TITLE in English.
   - If the anime is primarily known by a Japanese title (e.g., "Jigokuraku"), use that.
3️⃣ Extract season/part (if any)
4️⃣ Extract episode number
5️⃣ Detect if subtitle is requested + language (English,Frensh...)

IMPORTANT RULES:
- If you are NOT sure what anime it is → return {"notFound": true}
- NEVER guess.
- Return ONLY JSON.

FORMAT:
{
  "title":"official anime title in English or Romaji",
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
      "https://creators.kiroflix.site/backend/anime_search.php",
      { params: { q: title } }
    );

    logStep("SEARCH RESULT COUNT", data.results?.length);
    return data.results || [];

  } catch (err) {
    logError("ANIME SEARCH", err);
    return [];
  }
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
      "https://creators.kiroflix.site/backend/episodes_proxy.php",
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
  try {
    const { data } = await axios.get(
      "https://kiroflix.cu.ma/generate/generate_episode.php",
      {
        params: { episode_id: episodeId },
        timeout: 40000 // 40 seconds
      }
    );

    if (!data?.success) return null;

    return {
      player: `https://kiroflix.cu.ma/generate/player/?episode_id=${episodeId}`,
      master: data.master,
      subtitle: data.subtitle
    };

  } catch (err) {
    console.error("❌ Stream generation error:", err.message);
    return null;
  }
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
async function logUserUsage({
  userId,
  username,
  message,
  reply,
  country = "Unknown"
}) {
  try {
    await axios.post(
      "https://creators.kiroflix.site/backend/log_usage.php",
      {
        user_id: userId,
        username,
        message,
        reply,
        country,
        date: new Date().toISOString()
      }
    );
  } catch (err) {
    console.error("❌ Failed to log usage:", err.message);
  }
}
async function generateSubtitle(chatId, episodeId, lang = "English", sock) {
  // Send initial progress
  const progressMsg = await sock.sendMessage(chatId, {
    text: `🎯 Generating ${lang} subtitle... 0%`
  });

  try {
    // 1️⃣ Fetch base VTT
    const { data: vttText } = await axios.get(
      `https://creators.kiroflix.site/backend/vttreader.php`,
      { params: { episode_id: episodeId } }
    );
    const lines = vttText.split(/\r?\n/);

    // 2️⃣ Split into chunks
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < lines.length; i += chunkSize) {
      chunks.push([i, Math.min(i + chunkSize - 1, lines.length - 1)]);
    }

    const results = new Array(chunks.length);
    let completedChunks = 0;

    // 3️⃣ Generate subtitle chunks in parallel
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

        // Update progress
        completedChunks++;
        const percent = Math.floor((completedChunks / chunks.length) * 100);

        // WhatsApp: update previous message with new text
        await sock.sendMessage(chatId, {
          text: `🎯 Generating ${lang} subtitle... ${percent}%`
        });
      })
    );

    // 4️⃣ Combine and save
    const finalSubtitle = results.join("\n");
    const filename = `${lang.toLowerCase()}.vtt`;

    await axios.post(`https://kiroflix.cu.ma/generate/save_subtitle.php`, {
      episode_id: episodeId,
      filename,
      content: finalSubtitle
    });

    await axios.post(`https://creators.kiroflix.site/backend/store_subtitle.php`, {
      episode_id: episodeId,
      language: lang,
      subtitle_url: `https://kiroflix.cu.ma/generate/episodes/${episodeId}/${filename}`
    });

    // ✅ Notify user
    await sock.sendMessage(chatId, {
      text: `✅ ${lang} subtitle ready! https://kiroflix.cu.ma/generate/episodes/${episodeId}/${filename}`
    });

    return `https://kiroflix.cu.ma/generate/episodes/${episodeId}/${filename}`;
  } catch (err) {
    console.error("❌ Subtitle generation failed:", err.message);
    await sock.sendMessage(chatId, {
      text: `❌ Failed to generate ${lang} subtitle`
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

  sock.ev.on("creds.update", saveCreds);

  // 📩 MAIN MESSAGE HANDLER
  sock.ev.on("messages.upsert", async ({ messages }) => {
  const msg = messages[0];
  if (!msg.message) return;

  // ✅ Ignore bot's own messages (FIX LOOP)
  if (msg.key.fromMe) return;

  const from = msg.key.remoteJid;

  // ❌ Ignore groups
  if (from.endsWith("@g.us")) return;

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    "";

  if (!text) return;

    try {
      await sock.sendMessage(from, { text: "🍿 Finding your episode..." });

      const intent = await parseIntent(text);
      if (!intent) {
        await sock.sendMessage(from, { text: "❌ Could not understand request" });
        return;
      }

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

      // 🎯 find requested episode
let episode = episodes.find(
  e => Number(e.number) === Number(intent.episode)
);

let notReleasedMessage = "";

// ❌ If requested episode not found
if (!episode && intent.episode) {
  // get latest episode
  const latestEpisode = episodes.reduce((max, ep) =>
    Number(ep.number) > Number(max.number) ? ep : max
  );

  episode = latestEpisode;

  notReleasedMessage =
`⚠️ Episode ${intent.episode} is not released yet.
Here is the latest available episode 👇

`;
}

      const stream = await generateStream(episode.id);
      if (!stream) {
        await sock.sendMessage(from, { text: "❌ Could not generate stream" });
        return;
      }

      const caption =
`${notReleasedMessage}🎬 ${anime.title}
📺 Episode ${episode.number}: ${episode.title}
▶️ ${stream.player}`;

      if (anime.poster) {
        await sock.sendMessage(from, {
          image: { url: anime.poster },
          caption
        });
      } else {
        await sock.sendMessage(from, { text: caption });
      }

      // log usage
      await logUserUsage({
        userId: from,
        username: from,
        message: text,
        reply: caption
      });

      // subtitles
      if (intent.subtitle) {
        const lang = intent.subtitleLang || "English";
        const subs = await fetchAvailableSubtitles(episode.id);
        const existing = subs.find(s => s.lang.toLowerCase() === lang.toLowerCase());

        if (existing) {
          await sock.sendMessage(from, {
            text: `🎯 Subtitle already available: ${existing.lang}`
          });
        } else {
          await generateSubtitle(from, episode.id, lang, sock);
        }
      }

    } catch (err) {
      logError("MAIN HANDLER", err);
      await sock.sendMessage(from, { text: "⚠️ Something went wrong" });
    }
  });
}

startBot();


