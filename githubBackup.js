const fs = require("fs");
const path = require("path");
const { Octokit } = require("@octokit/rest");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = "mghdeveloper";
const REPO_NAME = "kiroflix-wa-bot";
const BRANCH = "main";

const octokit = new Octokit({
  auth: GITHUB_TOKEN
});

async function uploadFile(localPath, repoPath) {
  const content = fs.readFileSync(localPath, { encoding: "base64" });

  try {
    // check if file exists
    let sha;
    try {
      const { data } = await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: repoPath,
        ref: BRANCH
      });

      sha = data.sha;
    } catch {}

    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: repoPath,
      message: `Backup auth file ${repoPath}`,
      content,
      branch: BRANCH,
      sha
    });

    console.log("✅ Uploaded:", repoPath);

  } catch (err) {
    console.error("❌ Upload failed:", repoPath, err.message);
  }
}

async function uploadFolder(localFolder, repoFolder) {
  const files = fs.readdirSync(localFolder);

  for (const file of files) {
    const localPath = path.join(localFolder, file);
    const repoPath = `${repoFolder}/${file}`;

    const stat = fs.statSync(localPath);

    if (stat.isDirectory()) {
      await uploadFolder(localPath, repoPath);
    } else {
      await uploadFile(localPath, repoPath);
    }
  }
}

async function backupAuthToGithub() {
  console.log("☁️ Backing up auth session to GitHub...");
  await uploadFolder("./auth", "auth");
  console.log("🎉 Auth backup complete");
}

module.exports = { backupAuthToGithub };
