sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {

if (type !== "notify") return;
    
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
    const userId = msg.key.participant || msg.key.remoteJid;
    if (isGroup) {
  try {
    await handleGroupProtection(sock, msg);
    // Log the message
      await logGroupMessage(from, msg);

      // Update analytics
      await updateGroupAnalytics(from, msg);
  } catch(e) {
    console.error("Anti-spam error:", e);
  }

  groupActivity[from] = Date.now();

}
    if (isGroup && isUserBanned(from, userId)) {

  console.log(`🚫 Ignoring banned user ${userId}`);

  return;
}
    // 🚫 Skip banned users

    

    

    // 📝 Extract text
    let text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";
    if (!text) return;
    text = text.trim();
     // update last activity time

if (isGroup && text.toLowerCase().startsWith(".salutation edit")) {

  console.log("📢 Salutation edit command received");

  const sender = msg.key.participant || msg.key.remoteJid;

  try {

    const admins = await getGroupAdmins(sock, from);

    if (!admins.includes(sender)) {
      await sock.sendMessage(from,{
        text:"❌ Only admins can edit the farewell message."
      });
      return;
    }

    let template = "";
    let imageBase64 = null;

    const message = msg.message;

    // Detect caption text
    if (message?.conversation) {
      template = message.conversation.replace(".salutation edit","").trim();
    }

    if (message?.extendedTextMessage?.text) {
      template = message.extendedTextMessage.text.replace(".salutation edit","").trim();
    }

    if (message?.imageMessage?.caption) {
      template = message.imageMessage.caption.replace(".salutation edit","").trim();
    }

    console.log("✏️ Template parsed:", template);

    // Download image if exists
    if (message?.imageMessage) {

      console.log("🖼 Image detected in salutation edit");

      const stream = await downloadContentFromMessage(
        message.imageMessage,
        "image"
      );

      let buffer = Buffer.from([]);

      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      console.log("📦 Image buffer size:", buffer.length);

      imageBase64 = buffer.toString("base64");

    }

    // Prompt help if nothing provided
    if (!template && !imageBase64) {

      await sock.sendMessage(from,{
text:`✏️ *Salutation Editor*

Use {user} where the member mention should appear.

Example:

👋 Goodbye {user}

We hope you enjoyed your stay.
You are always welcome back!`
      });

      return;
    }

    console.log("📡 Sending request to API...");

    const res = await axios.post(
      "https://kiroflix.site/backend/update_salutation.php",
      {
        group_id: from,
        admin_id: sender,
        salutation_text: template || "",
        image_base64: imageBase64
      }
    );

    console.log("📡 API response:", res.data);

    if (!res.data.success) {

      console.error("❌ API error:", res.data);

      await sock.sendMessage(from,{
        text:"❌ Failed to update farewell message."
      });

      return;
    }

    // Update cache
    goodbyeCache[from] = {
      text: template || "",
      image: imageBase64
    };

    console.log("✅ Salutation cache updated");

    await sock.sendMessage(from,{
      text:"✅ Farewell message updated."
    });

  } catch (err) {

    console.error("🚨 Salutation edit error:", err);

    await sock.sendMessage(from,{
      text:"❌ Error updating farewell message."
    });

  }

  return;
}
    // ---------------------- Guess Anime Listener ----------------------
if (isGroup && guessAnimeGames[from]) {
  const game = guessAnimeGames[from];
  const round = game.rounds[game.currentRound];
  const user = msg.key.participant || msg.key.remoteJid;

  if (!round) return;

  const guessText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
  if (!guessText || guessText.length > 60) return;

  // Store answer
  game.userReplies[user] = guessText;

  // If first correct answer, reveal round
  if (!game.correctAnswered && normalizeText(guessText).includes(normalizeText(round.answer))) {
    game.correctAnswered = true;

    if (game.timer) clearTimeout(game.timer);

    // Show round results
    setTimeout(() => revealRoundAnswer(sock, from), 1000);
  }
}
// -------------------- Guess Character Listener --------------------
if (isGroup && guessCharacterGames[from]) {
  const game = guessCharacterGames[from];
  const round = game.rounds[game.currentRound];
  const user = msg.key.participant || msg.key.remoteJid;

  if (!round) return;

  const guessText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
  if (!guessText || guessText.length > 60) return;

  // Store answer
  game.userReplies[user] = guessText;

  // If first correct answer, reveal round
  if (!game.correctAnswered && normalizeText(guessText).includes(normalizeText(round.answer))) {
    game.correctAnswered = true;

    if (game.timer) clearTimeout(game.timer);

    // Show round results
    setTimeout(() => revealCharacterRound(sock, from), 1000);
  }
}
    
   
const lower = text.trim().toLowerCase();

// -------------------- COMMAND CHECK BEFORE HANDLER --------------------

if (isGroup && text.startsWith(".")) {

  // Extract command name
  const cmd = text.split(" ")[0].toLowerCase();

  // Commands not available yet
  const upcomingCommands = [
    ".mute",
    ".reset",
    ".watchparty"
  ];

  if (upcomingCommands.includes(cmd)) {

    const participant = msg.key.participant || from;
    const groupAdmins = await getGroupAdmins(sock, from);
    const isAdmin = groupAdmins.includes(participant);

    if (isAdmin) {

      await sock.sendMessage(from,{
        text:`⚠️ The command *${cmd}* isn't available yet.\nNext updates will add it!`,
        mentions:[participant]
      });

      return;
    }

  }

}
   // 🎮 Check if group game is running
// 🎮 Check if group game is running
// 🎮 Check if group game is running
if (isGroup && activeGames[from]) {
  const game = activeGames[from];
  const user = msg.key.participant || msg.key.remoteJid;

  // Only process replies to the current question
  const repliedTo = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
  if (repliedTo && repliedTo === game.currentQuestionMessageId) {
    // ❌ Prevent multiple answers
    if (!game.userReplies[user]) {
      const textAnswer = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      if (textAnswer.length <= 60) {
        game.userReplies[user] = textAnswer
          .replace(/[^\w\s]/g, "")
          .toLowerCase()
          .trim();
      }
    }
  }

  // ❌ If it’s not a reply to the game, do NOT block other checks
  // → The rest of your code (anti-spam, commands, etc.) continues as usual
}
// 📥 User replied to wallpaper
const quotedId =
  msg.message?.extendedTextMessage?.contextInfo?.stanzaId ||
  msg.message?.imageMessage?.contextInfo?.stanzaId;

if (quotedId && wallpaperReplyCache[quotedId]) {

  const wallpaper = wallpaperReplyCache[quotedId];
  const links = generateWallpaperLinks(wallpaper.page);

  if (!links) {
    await sock.sendMessage(from,{
      text:"❌ Failed to generate wallpaper."
    });
    return;
  }

  const userText = text.toLowerCase();

  let selectedLink = null;
  let type = "";

  if (userText.includes("desktop")) {
    selectedLink = links.desktop;
    type = "🖥 Desktop";
  }

  else if (userText.includes("mobile") || userText.includes("phone")) {
    selectedLink = links.mobile;
    type = "📱 Mobile";
  }

  else if (userText.includes("tablet")) {
    selectedLink = links.tablet;
    type = "📲 Tablet";
  }

  else {
    await sock.sendMessage(from,{
      text:
`📥 Choose wallpaper type:

Reply with:
• *desktop*
• *mobile*
• *tablet*`
    });
    return;
  }

  try {

    await sock.sendMessage(from,{
  image: { url: selectedLink },
  caption:
`🖼 *${wallpaper.title}*

${type} Wallpaper`
},{
  quoted: msg
});

  } catch(err) {

    await sock.sendMessage(from,{
      text:"❌ Failed to send wallpaper."
    });

  }

  return;
}
    // ✅ Group menu command restricted to admins
// -------------------- MESSAGE HANDLER --------------------
if (isGroup) {
  // 1️⃣ Menu
  if (text === ".menu") {
    await sendGroupMenu(sock, from, msg.key.participant || from);
    return;
  }

  // 2️⃣ Toggle commands like ".games on/off"
  const handled = await handleGroupToggle(sock, from, msg.key.participant || from, text);
  if (handled) return;
}
// -------------------- ADMIN CONFIRM FAREWELL --------------------
if (isGroup && text.toLowerCase() === "yes") {

  const pending = pendingFarewellConfirm[from];

  if (!pending) return;

  const sender = msg.key.participant || msg.key.remoteJid;
  const admins = await getGroupAdmins(sock, from);

  if (!admins.includes(sender)) return;

  const user = pending.user;

  const template =
    goodbyeCache[from] ||
    "👋 Goodbye {user}\n\nYou are no longer a member of this group.";

  const username = user.split("@")[0];

  const message = template.replace("{user}", `@${username}`);

  await sock.sendMessage(user, {
    text: message
  });

  delete pendingFarewellConfirm[from];

  await sock.sendMessage(from,{
    text:"✅ Farewell message sent privately."
  });

  return;
}
if (isGroup && msg.message?.imageMessage) {

  const caption = msg.message.imageMessage.caption || "";

  if (!caption.toLowerCase().startsWith(".makesticker")) return;

  const sender = msg.key.participant || msg.key.remoteJid;

  if (groupCommandsCache[from]?.stickersmaker === "off") {
    await sock.sendMessage(from, {
      text: "❌ Stickers feature is disabled in this group."
    });
    return; // STOP PROCESSING
  }

  console.log("📥 Sticker command received");

  const mediaMessage = msg.message.imageMessage;

  console.log("🖼 Media mimetype:", mediaMessage.mimetype);

  const waitMsg = await sock.sendMessage(from, {
    text: "⏳ Converting your image to sticker..."
  });

  try {

    const stream = await downloadContentFromMessage(mediaMessage, "image");

    let buffer = Buffer.from([]);

    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    console.log("📦 Image buffer size:", buffer.length);

    const { join } = require("path");
    const fs = require("fs");

    const tempFile = join(__dirname, `sticker_${Date.now()}.webp`);

    await imageToWebp(buffer, tempFile);

    await sock.sendMessage(from, {
      sticker: { url: tempFile }
    });

    await sock.sendMessage(from, { delete: waitMsg.key });

    fs.unlink(tempFile, () => {});

    console.log("🎉 Sticker sent successfully");

    return; // ✅ STOP MESSAGE FLOW AFTER SUCCESS

  } catch (err) {

    console.error("❌ Sticker conversion failed:", err);

    await sock.sendMessage(from, {
      text: "❌ Failed to convert image to sticker."
    });

    await sock.sendMessage(from, { delete: waitMsg.key });

    return; // ✅ STOP MESSAGE FLOW AFTER ERROR
  }
}
// ============================
// LEADERBOARD
// ============================

if (lower === ".leaderboard") {
  console.log(`📊 Leaderboard requested by ${msg.sender} in group ${from}`);

  let leaderboard;
  try {
    leaderboard = await getLeaderboard(from);
    console.log("✅ Leaderboard fetched:", leaderboard);
  } catch (err) {
    console.error("❌ Error fetching leaderboard:", err);
    await sock.sendMessage(from, { text: "❌ Failed to fetch leaderboard." });
    return;
  }

  if (!leaderboard || leaderboard.length === 0) {
    await sock.sendMessage(from, { text: "🏆 No scores yet." });
    console.log("⚠️ No leaderboard data returned");
    return;
  }

  // Filter out invalid users and group IDs
  const validLeaderboard = leaderboard.filter(u => {
    if (!u.user_id || !u.user_id.includes("@")) {
      console.log("⚠️ Skipping invalid user:", u);
      return false;
    }
    if (u.user_id.endsWith("@g.us")) {
      console.log("⚠️ Skipping group ID:", u.user_id);
      return false;
    }
    return true;
  });

  if (validLeaderboard.length === 0) {
    await sock.sendMessage(from, { text: "⚠️ No valid users in leaderboard." });
    console.log("⚠️ No valid users left after filtering");
    return;
  }

  let msgText = "🏆 *GROUP LEADERBOARD*\n\n";
  const mentions = [];

  validLeaderboard.forEach((u, i) => {
    const rank = resolveRank(from, i + 1, Number(u.score || 0));

    const medal =
      i === 0 ? "🥇" :
      i === 1 ? "🥈" :
      i === 2 ? "🥉" : "🔹";

    const username = u.user_id.split("@")[0];

    mentions.push(u.user_id);

    msgText += `${medal} ${i + 1}. @${username}
💎 Points: ${u.score}
🏅 Rank: ${rank || "Unranked"}

`;

    console.log(`👤 Processing user:`, u);
    console.log(`🏆 Resolved rank:`, rank || "Unranked");
  });

  console.log("📝 Final message:\n", msgText);
  console.log("📌 Mentions:", mentions);

  try {
    const sentMsg = await sock.sendMessage(from, {
      text: msgText,
      mentions
    });

    console.log("✅ Message sent successfully");
    console.log("📨 Message ID:", sentMsg.key.id);
  } catch (err) {
    console.error("❌ Failed to send leaderboard message:", err);
  }
}


// ============================
// ADD RANK
// ============================

if (text.startsWith(".rank add")) {

  const sender = msg.key.participant || msg.key.remoteJid;
  const admins = await getGroupAdmins(sock, from);

  if (!admins.includes(sender)) {
    await sock.sendMessage(from,{ text:"❌ Only admins can add ranks." });
    return;
  }

  const match = text.match(/{{(.+?)}}\s+(position|points)\s+(\d+)/i);

  if (!match) {
    await sock.sendMessage(from,{
      text:"❌ Format:\n.rank add {{Rank Name}} <position|points> <value>"
    });
    return;
  }

  const name = match[1].trim();
  const type = match[2].toLowerCase();
  const value = parseInt(match[3]);

  const res = await axios.post(
    "https://kiroflix.site/backend/add_rank.php",
    {
      group_id: from,
      rank_name: name,
      rank_type: type,
      position: type === "position" ? value : null,
      min_points: type === "points" ? value : null,
      creator_id: sender
    }
  );

  if (res.data.success) {

    await fetchRanks();

    await sock.sendMessage(from,{
      text:`✅ Rank added: ${name}`
    });

  } else {

    await sock.sendMessage(from,{
      text:`❌ Failed: ${res.data.error || "Unknown error"}`
    });

  }

  return;
}



// ============================
// DELETE RANK (BY ID)
// ============================

if (text.startsWith(".rank delete")) {

  const parts = text.split(" ");
  const id = parseInt(parts[2]);

  if (!id) {
    await sock.sendMessage(from,{
      text:"❌ Usage:\n.rank delete <rank_id>"
    });
    return;
  }

  const res = await axios.post(
    "https://kiroflix.site/backend/delete_rank.php",
    { id }
  );

  if (res.data.success) {

    await fetchRanks();

    await sock.sendMessage(from,{
      text:`🗑 Rank deleted (ID ${id})`
    });

  } else {

    await sock.sendMessage(from,{
      text:`❌ Failed: ${res.data.error || "Unknown error"}`
    });

  }

  return;
}



// ============================
// RANK LIST
// ============================

if (text === ".ranklist") {

  const ranks = rankCache[from] || [];

  if (!ranks.length) {
    await sock.sendMessage(from,{ text:"📜 No ranks configured." });
    return;
  }

  let msg = "📜 *Group Ranks*\n\n";

  ranks.forEach(r => {

    if (r.rank_type === "position") {
      msg += `🆔 ${r.id} | 🥇 Position ${r.position} → ${r.rank_name}\n`;
    }

    if (r.rank_type === "points") {
      msg += `🆔 ${r.id} | 💎 ${r.min_points}+ points → ${r.rank_name}\n`;
    }

  });

  await sock.sendMessage(from,{ text:msg });

  return;
}
if (isGroup && text.toLowerCase().startsWith(".profile")) {

  let mentionedUser = msg.mentionedJid && msg.mentionedJid[0]
    ? msg.mentionedJid[0]
    : msg.key.participant || msg.key.remoteJid;

  // Fetch metadata first (needed for owner detection)
  let metadata;
  try {
    metadata = await sock.groupMetadata(from);
  } catch (err) {
    console.log("❌ Failed to fetch metadata:", err);
    return;
  }

  const ownerId =
    metadata.owner ||
    metadata.participants.find(p => p.admin === "superadmin")?.id;

  const isSuperAdmin = mentionedUser === ownerId;
  const isUltimateOwnerOn = groupCommandsCache[from]?.ultimateowner === "on";

  // ===============================
  // 🚀 RUN API CALLS IN PARALLEL
  // ===============================
  let profileData, rankData, platformProfile;

  try {

    [profileData, rankData, platformProfile] = await Promise.all([
      getUserProfile(from, mentionedUser),
      getUserRank(from, mentionedUser),
      getPlatformProfile(mentionedUser)
    ]);

  } catch (err) {

    console.log("❌ Parallel fetch error:", err);

    await sock.sendMessage(from,{
      text:"❌ Failed to fetch profile."
    },{quoted:msg});

    return;
  }

  if (!profileData || !rankData) {
    await sock.sendMessage(from,{
      text:"❌ Failed to fetch profile."
    },{quoted:msg});
    return;
  }

  const userStats = profileData.user;
  const totalMessages = userStats.messages || 0;
  const types = userStats.types || {};

  const username = mentionedUser.split("@")[0];

  // 💖 Waifu
  let waifuText = userStats.waifu
    ? `💖 ${userStats.waifu.character_name} (${userStats.waifu.anime || "Unknown"})`
    : "💌 No waifu selected";

  // 📊 Message types
  let typeText = "";
  if(Object.keys(types).length > 0){
    for(const [type,count] of Object.entries(types)){
      typeText += `• ${type.toUpperCase()}: ${count}\n`;
    }
  } else {
    typeText = "• No messages yet\n";
  }

  // ===============================
  // 🌐 PLATFORM SECTION
  // ===============================
  let platformSection = "";

  if (platformProfile.linked) {

    const p = platformProfile.data;

    platformSection =
`🌐 *Kiroflix Profile*

👤 Username: ${p.username}
📅 Joined: ${p.joinDate}
⏱ Total Watch Time: ${p.watched.hours}h (${p.watched.minutes}m)
🎬 Total Ratings: ${p.ratings.length}

`;

  } else {

    platformSection =
`🌐 *Kiroflix Profile*

❌ Not linked
🔗 Link your account here:
https://kiroflix.cu.ma/settings/
Use your token via DM: .linkaccount YOUR_TOKEN

`;

  }

  // ===============================
  // Rank / Points
  // ===============================
  let position = rankData.position || "Unranked";
  let points = rankData.points || 0;
  let rankName = resolveRank(from, position, points);

  let progressText = "";
  let progressBar = "";

  if (isUltimateOwnerOn && isSuperAdmin) {

    position = "♾️";
    points = "∞";
    rankName = "👑 Ultimate Owner";
    progressText = "🚀 Highest authority level";

  } else {

    const nextRank = getNextRank(from, points);

    if(nextRank){

      const need = nextRank.min_points - points;
      const percent = Math.floor((points / nextRank.min_points) * 100);
      const filled = Math.floor(percent / 10);

      progressBar = "▰".repeat(filled) + "▱".repeat(10 - filled);

      progressText =
`📈 Next Rank: ${nextRank.rank_name}
${progressBar} ${percent}%
Need: ${need} points`;

    } else {

      progressText = "🏆 You reached the highest rank!";

    }

  }

  // ===============================
  // FINAL MESSAGE
  // ===============================
  const message =
`🏅 *Profile Card*

👤 User: @${username}
${waifuText}

🗂 Total Messages: ${totalMessages}
📊 Message Types:
${typeText}

${platformSection}💎 Points: ${points}
🏆 Position: ${position}
🎖 Rank: ${rankName}

${progressText}`;

  await sock.sendMessage(from,{
    text: message,
    mentions:[mentionedUser]
  },{quoted:msg});
return;


}
 // 💖 WAIFU CLAIM
// 💖 Claim waifu
if (isGroup && text.toLowerCase().startsWith(".waifu ")) {

  if (groupCommandsCache[from]?.waifu === "off") return await sock.sendMessage(from,{ text:"❌ Waifu system is disabled." });

  const user = msg.key.participant || msg.key.remoteJid;
  const characterName = text.slice(7).trim();
  if (!characterName) return await sock.sendMessage(from,{ text:"Usage:\n .waifu <character name>" });

  const character = await searchAnimeCharacter(characterName);
  if (!character) return await sock.sendMessage(from,{ text:"❌ Character not found." });

  // Fetch current claims from backend if not cached
  if (!waifuClaims[from]) await fetchWaifus(from);

  const key = character.name.toLowerCase().replace(/\s+/g, "");

  if (waifuClaims[from][key]) {
    const owner = waifuClaims[from][key];
    return await sock.sendMessage(from,{
      text: `💔 *${character.name}* is already claimed by @${owner.split("@")[0]}`,
      mentions:[owner]
    });
  }

  // 🔹 Add claim to backend
  try {
    const res = await axios.post("https://kiroflix.site/backend/add_waifu.php", {
      group_id: from,
      user_id: user,
      character_name: character.name,
      character_image: character.image,
      anime: character.anime
    });

    if (!res.data.success) throw new Error(res.data.error || "Backend error");

    // Update cache
    waifuClaims[from][key] = user;

    await sock.sendMessage(from, {
      image: { url: character.image },
      caption: `💖 *@${user.split("@")[0]} claimed ${character.name}!*  

Anime: ${character.anime}

No one else can claim this waifu now.`,
      mentions: [user]
    });
  } catch (err) {
    console.error("❌ Failed to add waifu:", err.message);
    await sock.sendMessage(from,{ text:"❌ Failed to claim waifu." });
  }

  return;
}
// -------------------- BAN COMMAND --------------------
if (isGroup && text.toLowerCase().startsWith(".ban")) {
  await handleBanCommand(sock, msg, text);
  return; // Stop further processing after handling .ban
}
// -------------------- UNBAN COMMAND --------------------
if (isGroup && text.toLowerCase().startsWith(".unban")) {
  const sender = msg.key.participant || msg.key.remoteJid;

  // Only admins can use
  const admins = await getGroupAdmins(sock, from);
  if (!admins.includes(sender)) {
    await sock.sendMessage(from, {
      text: "❌ Only group admins can use this command.",
      mentions: [sender]
    });
    return;
  }

  // Extract mentioned users
  const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentions.length === 0) {
    await sock.sendMessage(from, {
      text: "❌ You must mention a user to unban. Example:\n.kiroflix .unban @user",
      mentions: [sender]
    });
    return;
  }

  for (const userId of mentions) {
    try {
      // Remove locally
      if (bannedUsers[from]?.includes(userId)) {
        bannedUsers[from] = bannedUsers[from].filter(u => u !== userId);
      }

      // Remove from backend
      await fetch(`${BACKEND_URL}removeBannedUser.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: from, user_id: userId })
      });

      // Notify with mention
      await sock.sendMessage(from, {
        text: `✅ @${userId.split("@")[0]} has been unbanned in this group.`,
        mentions: [userId]
      });

    } catch (err) {
      console.error("❌ Failed to unban user:", userId, err);
      await sock.sendMessage(from, {
        text: `⚠️ Failed to unban @${userId.split("@")[0]}. Try again later.`,
        mentions: [userId]
      });
    }
  }

  return;
}
// -------------------- KICK COMMAND --------------------
if (isGroup && text.toLowerCase().startsWith(".kick ")) {
  const sender = msg.key.participant || msg.key.remoteJid;

  // 1️⃣ Only admins can use
  const admins = await getGroupAdmins(sock, from);
  if (!admins.includes(sender)) {
    await sock.sendMessage(from, {
      text: "❌ Only group admins can use this command.",
      mentions: [sender]
    });
    return;
  }

  // 2️⃣ Extract mentioned user(s)
  const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentions.length === 0) {
    await sock.sendMessage(from, {
      text: "❌ You must mention a user to kick. Example:\n .kick @user",
      mentions: [sender]
    });
    return;
  }

  // 3️⃣ Attempt to kick each mentioned user
  for (const userId of mentions) {
    try {
      // Attempt kick
      await sock.groupParticipantsUpdate(from, [userId], "remove");

      // Find participant name if available, otherwise fallback to ID
      const metadata = await sock.groupMetadata(from);

const userName =
metadata.participants?.find(p => p.id === userId)?.name ||
userId.split("@")[0];

      // ✅ Success message
      await sock.sendMessage(from, { text: `🚫 ${userName} has been kicked from the group.` });
    } catch (err) {
      // Only send this if the bot truly cannot kick (bot is not admin, or user is admin)
      console.error(`Kick error for ${userId}:`, err);

      await sock.sendMessage(from, {
        text: `⚠️ Cannot remove ${userId.split("@")[0]}. Make sure the bot is an admin!`
      });
    }
  }
  return;
}
    // ✅ Group commands
    if (isGroup) {
      if (isGroup && text.startsWith(".badword add")) {

const sender = msg.key.participant || msg.key.remoteJid;

const admins = await getGroupAdmins(sock, from);

if (!admins.includes(sender)) {
await sock.sendMessage(from,{text:"❌ Only admins"});
return;
}

let words = text.replace(".badword add","").trim();

if (!words) return;

words = words.split(",").map(w => w.trim().toLowerCase());

if (!badWordsDB.groups[from])
badWordsDB.groups[from] = [];

words.forEach(w => {

if (!badWordsDB.groups[from].includes(w))
badWordsDB.groups[from].push(w);

});

saveBadWords();

await axios.post(
"https://kiroflix.site/backend/add_badwords.php",
{
group_id: from,
words: words,
admin_id: sender   // ⭐ FIX: send admin id
}
);

await sock.sendMessage(from,{
text:`✅ Added bad words:\n${words.join(", ")}`
});

return;

}
if(isGroup && text.startsWith(".badword remove")){

const sender = msg.key.participant || msg.key.remoteJid;

const admins = await getGroupAdmins(sock,from);

if(!admins.includes(sender)){
await sock.sendMessage(from,{text:"❌ Only admins"});
return;
}

let words = text.replace(".badword remove","").trim();

words = words.split(",").map(w=>w.trim().toLowerCase());

if(!badWordsDB.groups[from]) return;

badWordsDB.groups[from] =
badWordsDB.groups[from].filter(w=>!words.includes(w));

saveBadWords();

await axios.post(
"https://kiroflix.site/backend/remove_badwords.php",
{
group_id:from,
words
}
);

await sock.sendMessage(from,{
text:`❌ Removed:\n${words.join(", ")}`
});

return;

}
if(isGroup && text === ".badword list"){

const words = badWordsDB.groups[from] || [];

if(!words.length){

await sock.sendMessage(from,{
text:"🚫 No bad words configured"
});

return;

}

await sock.sendMessage(from,{
text:`🚫 Bad Words List\n\n${words.join("\n")}`
});

return;

}
      
      if (isGroup && text.toLowerCase() === ".stats") {

  const stats = await getGroupStats(from);

  if (!stats) {
    await sock.sendMessage(from,{
      text:"📊 Unable to load statistics."
    });
    return;
  }

  const total = stats.total_messages || 0;
  const users = stats.active_users || 0;

  const msgText =
`📊 *Group Usage Stats*

👥 Active Users: ${users}
💬 Total Messages: ${total}

Use *.active* to see most active users.`;

  await sock.sendMessage(from,{ text: msgText });

  return;
}
if (isGroup && text.toLowerCase() === ".active") {

  const stats = await getGroupStats(from);

  if (!stats || !stats.top_users?.length) {

    await sock.sendMessage(from,{
      text:"🔥 No activity recorded yet."
    });

    return;
  }

  let textMsg = "🔥 *Most Active Users*\n\n";
  let mentions = [];

  stats.top_users.forEach((u,index)=>{

    mentions.push(u.id);

    textMsg += `${index+1}. @${u.id.split("@")[0]} — ${u.messages} msgs\n`;

  });

  await sock.sendMessage(from,{
    text: textMsg,
    mentions
  });

  return;
}
      if (isGroup && text.startsWith(".welcome edit")) {

  const sender = msg.key.participant || msg.key.remoteJid;
  const admins = await getGroupAdmins(sock, from);

  if (!admins.includes(sender)) {
    await sock.sendMessage(from, { text: "❌ Only admins can edit welcome message" });
    return;
  }

  const template = text.replace(".welcome edit", "").trim();

  if (!template) {
    await sock.sendMessage(from, {
      text: `📝 Welcome Editor

Use {user} where the member mention should appear.

Example:

✨ Welcome to the group ✨

Member: {user}

Rules:
1. Respect everyone
2. No spam
3. Stay on topic`
    });
    return;
  }

  await axios.post(
    "https://kiroflix.site/backend/update_welcome.php",
    {
      group_id: from,
      admin_id: sender,
      welcome_text: template
    }
  );

  welcomeCache[from] = template;

  await sock.sendMessage(from, {
    text: "✅ Welcome message updated."
  });

  // ⚠️ Stop further processing after sending confirmation
  return;
}
      if (isGroup && text.toLowerCase() === ".guessanime") {

  const user = msg.key.participant || msg.key.remoteJid;

  const admins = await getGroupAdmins(sock, from);
  const isAdmin = admins.includes(user);

  if (!isAdmin) {
    await sock.sendMessage(from,{
      text:"❌ Only group admins can start Guess The Anime."
    });
    return;
  }

  if (groupCommandsCache[from]?.bot === "off") {
    await sock.sendMessage(from,{
      text:"❌ Bot is disabled in this group."
    });
    return;
  }

  if (groupCommandsCache[from]?.games !== "on") {
    await sock.sendMessage(from,{
      text:"❌ Games are disabled in this group."
    });
    return;
  }

  if (activeGames[from] || guessAnimeGames[from]) {
    await sock.sendMessage(from,{
      text:"⚠️ A game is already running."
    });
    return;
  }

  await sock.sendMessage(from,{
    text:"🎮 Admin started Guess The Anime!"
  });

  startGuessAnimeGame(sock, from);
  return;
}
if (isGroup && text.toLowerCase() === ".guesscharacter") {

  const user = msg.key.participant || msg.key.remoteJid;

  const admins = await getGroupAdmins(sock, from);
  const isAdmin = admins.includes(user);

  if (!isAdmin) {
    await sock.sendMessage(from,{
      text:"❌ Only group admins can start Guess The Character."
    });
    return;
  }

  if (groupCommandsCache[from]?.bot === "off") {
    await sock.sendMessage(from,{
      text:"❌ Bot is disabled in this group."
    });
    return;
  }

  if (groupCommandsCache[from]?.games !== "on") {
    await sock.sendMessage(from,{
      text:"❌ Games are disabled in this group."
    });
    return;
  }

  if (activeGames[from] || guessCharacterGames[from]) {
    await sock.sendMessage(from,{
      text:"⚠️ A game is already running."
    });
    return;
  }

  await sock.sendMessage(from,{
    text:"🎮 Admin started Guess The Character!"
  });

  startGuessCharacterGame(sock, from);
  return;
}
      // 🎮 Manual quiz start by admin
if (isGroup && text.toLowerCase() === ".quiz start") {

  const user = msg.key.participant || msg.key.remoteJid;

  const admins = await getGroupAdmins(sock, from);
  const isAdmin = admins.includes(user);

  if (!isAdmin) {
    await sock.sendMessage(from,{
      text:"❌ Only group admins can start the quiz."
    });
    return;
  }

  if (groupCommandsCache[from]?.bot === "off") {
    await sock.sendMessage(from,{
      text:"❌ Bot is disabled in this group."
    });
    return;
  }

  if (groupCommandsCache[from]?.games !== "on") {
    await sock.sendMessage(from,{
      text:"❌ Games are disabled in this group."
    });
    return;
  }

  if (activeGames[from]) {
    await sock.sendMessage(from,{
      text:"⚠️ A quiz game is already running."
    });
    return;
  }

  // ⏳ 2 hour cooldown
  const cooldown = 7200000; // 2 hours
  const last = lastGameTime[from] || 0;
  const remaining = cooldown - (Date.now() - last);

  if (remaining > 0) {

    const minutes = Math.ceil(remaining / 60000);

    await sock.sendMessage(from,{
      text:`⏳ You must wait *${minutes} minutes* before starting another quiz.`
    });

    return;
  }

  await sock.sendMessage(from,{
    text:"🎮 Admin started a quiz!"
  });

  startAnimeGame(sock, from);

  return;
}
      // 🛑 Admin force stop quiz
if (isGroup && text.toLowerCase() === ".quiz stop") {

  const user = msg.key.participant || msg.key.remoteJid;
  const admins = await getGroupAdmins(sock, from);

  if (!admins.includes(user)) {
    await sock.sendMessage(from,{
      text:"❌ Only admins can stop the quiz."
    });
    return;
  }

  if (!activeGames[from]) {
    await sock.sendMessage(from,{
      text:"⚠️ No quiz is currently running."
    });
    return;
  }

  await sock.sendMessage(from,{
    text:"🛑 Quiz stopped by admin."
  });

  await endGame(sock, from);

  return;
}
// ===============================
// 📩 DUEL HANDLER
// ===============================

if (isGroup) {
  const sender = msg.key.participant || msg.key.remoteJid;
  const textLower = text.toLowerCase();

  // -----------------------------
  // START DUEL
  // -----------------------------
  if (textLower.startsWith(".duel")) {
    const parts = text.split(" ");
    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
    if (!mentioned?.length) return;

    const opponent = mentioned[0];
    const challenger = sender;
    const bet = parseInt(parts[2]) || 10;

    if (duelCooldown[challenger] && Date.now() - duelCooldown[challenger] < 60000) {
      return sock.sendMessage(from, { text: "⏳ Wait before starting another duel..." });
    }

    duelCooldown[challenger] = Date.now();
    await startDuel(sock, from, challenger, opponent, bet);
  }

  // -----------------------------
  // ACCEPT DUEL
  // -----------------------------
  if (duelGames[from] && textLower === "accept") {
    const g = duelGames[from];
    if (sender !== g.opponent) return;
    await sock.sendMessage(from, { text: "⚔️ Duel accepted! Preparing match..." });
    setTimeout(() => startMatch(sock, from), 1500);
  }

  // -----------------------------
  // PLAY CARD
  // -----------------------------
  if (duelGames[from] && textLower.startsWith("play")) {
  const g = duelGames[from];           // <<< define g here
  if (!g) return;

  const parts = text.split(" ");
  const index = parseInt(parts[1]) - 1;
  const mode = parts[2]?.toLowerCase() === "defense" ? "defense" : "attack";
  const targetIndex = parts[3] ? parseInt(parts[3]) : undefined;

  if (isNaN(index) || index < 0 || index >= g.hands[sender].length) return;
  await play(sock, from, sender, index, mode, targetIndex);
}
}
if (isGroup && text.toLowerCase().startsWith(".")) {
  const parts = text.trim().split(" ");
  const cmd = parts[0].slice(1).toLowerCase(); // removes dot
  const sub = parts[1]?.toLowerCase() || "";

  if (sub === "explain") {
    // valid .command explain
    const commandData = toggledCommands[cmd] || nonToggledCommands[cmd];
    if (!commandData) {
      await sock.sendMessage(from, {
        text: `❌ ".${cmd}" is not a valid command.`
      });
      return;
    }

    // Build explanation
    const response = 
`📘 *Command Info*

🔹 Command: .${cmd}
📂 Category: ${commandData.category || "OTHER"}
📝 ${commandData.description || "No description available."}
⚙️ Usage: ${commandData.usage || "N/A"}
${commandData.adminOnly ? "👑 Admin only" : ""}
${commandData.adminPromote ? "⚡ Requires promotion" : ""}`;

    await sock.sendMessage(from, { text: response });
    return;
  }
}
if (isGroup && text === ".settings") {

  const metadata = await sock.groupMetadata(from);

  const adminIds = metadata.participants
    .filter(p => p.admin === "admin" || p.admin === "superadmin")
    .map(p => p.id);

  if (!adminIds.includes(msg.key.participant || from)) return;

  const cache = groupCommandsCache[from] || {};

  let msgText = `⚙️ *Group Settings*\n\n`;

  for (const cmd in toggledCommands) {

    let status = cache[cmd] || "on";

    msgText += `• .${cmd} → ${status === "on" ? "✅ ON" : "❌ OFF"}\n`;
  }

  await sock.sendMessage(from, { text: msgText });
  return;
}
// -------------------- GROUP NOTEPAD --------------------
if (isGroup && text.toLowerCase().startsWith(".note")) {
  const sender = msg.key.participant || msg.key.remoteJid;
  const admins = await getGroupAdmins(sock, from);

  if (!admins.includes(sender)) {
    await sock.sendMessage(from, {
      text: "❌ Only admins can manage group notes.",
      mentions: [sender]
    });
    return;
  }

  const args = text.split(" ").slice(1); // Remove ".note"
  const subCommand = args[0]?.toLowerCase();

  if (!subCommand) {
    await sock.sendMessage(from, {
      text: "❌ Usage:\n.note add <text>\n.note list\n.note delete <id>",
      mentions: [sender]
    });
    return;
  }

  try {
    // -------------------- ADD NOTE --------------------
    if (subCommand === "add") {
      const noteText = args.slice(1).join(" ");
      if (!noteText) {
        await sock.sendMessage(from, { text: "❌ Please provide note text." });
        return;
      }

      const res = await fetch(`${BACKEND_URL}addNote.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: from,
          admin_id: sender,
          text: noteText
        })
      });

      const data = await res.json();
      if (data.success) {
        await sock.sendMessage(from, { text: `✅ Note added successfully (ID: ${data.note_id}).` });
      } else {
        await sock.sendMessage(from, { text: `⚠️ Failed to add note.` });
      }
      return;
    }

    // -------------------- LIST NOTES --------------------
    // -------------------- LIST NOTES --------------------
if (subCommand === "list") {
  const res = await fetch(`${BACKEND_URL}getNotes.php?group_id=${encodeURIComponent(from)}`);
  const data = await res.json();

  if (!data.success || !data.notes.length) {
    await sock.sendMessage(from, { text: "📝 No notes found for this group." });
    return;
  }

  const groupMeta = await sock.groupMetadata(from);
  const groupName = groupMeta.subject;

  let message = `╭───〔 📝 *${groupName} Notepad* 〕───╮\n\n`;
  let mentions = [];

  for (const note of data.notes) {

    let noteText = note.text.replace(/@(\d{5,15})/g, (_, id) => {
      const jid = `${id}@s.whatsapp.net`;
      mentions.push(jid);
      return `@${id}`;
    });

    message += `✦ *Note ID:* ${note.id}\n`;
    message += `📅 *Date:* ${note.date}\n`;
    message += `📝 ${noteText}\n`;
    message += `──────────────────\n`;
  }

  message += `╰───────────────╯`;

  await sock.sendMessage(from, {
    text: message,
    mentions
  });

  return;
}

    // -------------------- DELETE NOTE --------------------
    if (subCommand === "delete") {
      const noteId = args[1];
      if (!noteId) {
        await sock.sendMessage(from, { text: "❌ Please provide note ID to delete." });
        return;
      }

      const res = await fetch(`${BACKEND_URL}deleteNote.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: from, note_id: noteId })
      });

      const data = await res.json();
      if (data.success) {
        await sock.sendMessage(from, { text: `✅ Note ID ${noteId} deleted.` });
      } else {
        await sock.sendMessage(from, { text: `⚠️ Failed to delete note.` });
      }
      return;
    }

  } catch (err) {
    console.error("❌ Group notepad error:", err);
    await sock.sendMessage(from, { text: "⚠️ Error managing group notes." });
  }
}
      
      
    } else {
      // ✅ Private chat max length
      if (text.length > MAX_MESSAGE_LENGTH) {
        await sock.sendMessage(from, {
          text: "⚠️ Message too long.\nPlease send a shorter request (max 300 characters).\n\nExample:\nNaruto episode 5\nSolo Leveling chapter 120"
        });
        return;
      }
    }
    if (!isGroup && text.toLowerCase().startsWith(".linkaccount")) {
    
      const args = text.split(" ");
      const token = args[1];
    
      if (!token) {
        await sock.sendMessage(from, {
          text: "❌ Usage:\n.linkaccount <your_token>\n\nGet your token from Kiroflix settings https://kiroflix.cu.ma/settings/."
        });
        return;
      }
    
      try {
    
        const res = await axios.post(
          "http://kiroflix.cu.ma/api/bot_sync.php",
          {
            token: token,
            whatsapp_id: userId // ex: 2126xxxx@s.whatsapp.net
          }
        );
    
        if (res.data.success) {
          await sock.sendMessage(from, {
            text: "✅ Your Kiroflix account has been successfully linked to this WhatsApp!"
          });
        } else {
          await sock.sendMessage(from, {
            text: "❌ Invalid or expired token."
          });
        }
    
      } catch (err) {
        console.error("Link error:", err.message);
    
        await sock.sendMessage(from, {
          text: "❌ Failed to connect to Kiroflix. Try again later."
        });
      }
    
      return;
    }
   

    // ✅ Handle the message
    await handleMessage(sock, {
      ...msg,
      key: { ...msg.key, remoteJid: from },
      message: { conversation: text },
      quoted: msg
    });

} catch(err) {
console.log("Message error:",err.message);
}
  });

  console.log("🤖 Kiroflix Bot is running...");
}

(async () => {

  await ensureAuthFolder();

  startBot();

})();
