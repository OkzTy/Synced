/**
 * Discord Service — OAuth Login + Rich Presence + Linking
 */
const { BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");

const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Instead of a custom synced:// protocol (which Discord rejects),
 * use a localhost redirect. The BrowserWindow intercepts the
 * redirect before it actually reaches the network.
 * Make sure "http://localhost/discord-callback" is in your
 * Discord Developer Portal > OAuth2 > Redirects.
 */
const REDIRECT_URI = "http://localhost/discord-callback";
const SCOPES = ["identify", "email"];

function loadConfigSync() {
	const configPath = path.join(__dirname, "../../config.json");
	try {
		if (fs.existsSync(configPath)) {
			const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			if (cfg.discord) return cfg.discord;
		}
	} catch (e) {
		console.warn("[DiscordService] Failed to load config.json:", e.message);
	}
	return { clientId: "", clientSecret: "", botToken: "" };
}

async function loadConfigAsync() {
	try {
		const LicenseService = require("./license-service");
		const dbConfig = await LicenseService.getDiscordConfig();
		if (dbConfig && dbConfig.clientId) {
			return dbConfig;
		}
	} catch (e) {
		console.warn("[DiscordService] Failed to load config from DB:", e.message);
	}
	return loadConfigSync();
}

// ── Discord RPC ────────────────────────────────────────────────────────────
let rpcClient = null;
let rpcConnected = false;
let currentPresence = null;

const ASSETS = {
	logo: "synced_logo",
	logo_text: "Synced",
};

async function connectRichPresence() {
	const config = await loadConfigAsync();
	if (!config.clientId) {
		console.warn("[DiscordRPC] No clientId configured, skipping RPC.");
		return;
	}
	if (rpcConnected) return;
	try {
		const { Client } = require("discord-rpc");
		rpcClient = new Client({ transport: "ipc" });
		rpcClient.on("ready", () => {
			rpcConnected = true;
			console.log("[DiscordRPC] Connected.");
			setPresence({
				details: "Using Synced",
				state: "Dual-PC Command Center",
				largeImageKey: ASSETS.logo,
				largeImageText: ASSETS.logo_text,
				instance: true,
			});
		});
		rpcClient.on("disconnected", () => { rpcConnected = false; });
		await rpcClient.login({ clientId: config.clientId });
	} catch (e) {
		rpcConnected = false;
		console.warn("[DiscordRPC] Failed to connect:", e.message);
	}
}

function setPresence(presence) {
	currentPresence = presence;
	if (!rpcClient || !rpcConnected) return;
	try {
		rpcClient.setActivity({ ...presence, startTimestamp: presence.startTimestamp || Date.now() });
	} catch (e) { console.warn("[DiscordRPC] setActivity failed:", e.message); }
}

function disconnectRichPresence() {
	if (rpcClient) { try { rpcClient.destroy(); } catch (e) {} rpcClient = null; rpcConnected = false; }
}

function updatePresenceForPage(page, extra = {}) {
	const presets = {
		dashboard: { details: "Managing Dashboard", state: extra.hostname ? `Monitoring ${extra.hostname}` : "Monitoring systems", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_dashboard", smallImageText: "Dashboard" },
		dma: { details: "DMA Cheating", state: "Using DMA tools & firmware", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_dma", smallImageText: "DMA" },
		external: { details: "External Cheating", state: "Using external process tools", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_external", smallImageText: "External" },
		internal: { details: "Internal Cheating", state: "Using injection & hooking tools", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_internal", smallImageText: "Internal" },
		scripts: { details: "Scripting", state: "Browsing cheat scripts", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_scripts", smallImageText: "Scripts" },
		ai: { details: "AI Assistant", state: "Chatting with AI", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_ai", smallImageText: "AI" },
		processes: { details: "Viewing Processes", state: extra.hostname ? `${extra.hostname} processes` : "System processes", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_processes", smallImageText: "Processes" },
		terminal: { details: "Using Terminal", state: extra.hostname ? `${extra.hostname} terminal` : "Running commands", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_terminal", smallImageText: "Terminal" },
		files: { details: "Browsing Files", state: extra.hostname ? `${extra.hostname} files` : "File manager", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_files", smallImageText: "Files" },
		settings: { details: "Configuring Settings", state: "Tweaking preferences", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_settings", smallImageText: "Settings" },
		profile: { details: "Viewing Profile", state: extra.username ? `${extra.username}'s profile` : "Account settings", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_profile", smallImageText: "Profile" },
		admin: { details: "Admin Panel", state: "Managing users & licenses", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text, smallImageKey: "synced_admin", smallImageText: "Admin" },
	};
	const preset = presets[page] || { details: "Using Synced", state: "Dual-PC Command Center", largeImageKey: ASSETS.logo, largeImageText: ASSETS.logo_text };
	setPresence({ ...preset, startTimestamp: Date.now(), instance: true });
}

// ── OAuth Login / Linking ──────────────────────────────────────────────────

/**
 * Open Discord OAuth window and return user info.
 * @param {boolean} linkingOnly - If true, only returns user info without logging in (for linking).
 */
function openDiscordOAuth() {
	return new Promise(async (resolve) => {
		const config = await loadConfigAsync();
		if (!config.clientId || !config.clientSecret) {
			return resolve({ success: false, error: "Discord not configured. Add Discord Config in Admin Panel first." });
		}

		const state = crypto.randomBytes(16).toString("hex");
		const authUrl = `${DISCORD_API_BASE}/oauth2/authorize` +
			`?client_id=${config.clientId}` +
			`&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
			`&response_type=code` +
			`&scope=${encodeURIComponent(SCOPES.join(" "))}` +
			`&state=${state}`;

		let resolved = false;
		const { BrowserWindow: ElectronBrowserWindow } = require("electron");
		const parentWindow = ElectronBrowserWindow.getAllWindows().find(w => w.title !== "Discord Login");

		const authWindow = new BrowserWindow({
			width: 500,
			height: 750,
			resizable: false,
			frame: true,
			title: "Discord Login",
			parent: parentWindow || undefined,
			modal: !!parentWindow,
			webPreferences: { nodeIntegration: false, contextIsolation: true },
		});

		function handleCallback(url) {
			if (resolved) return;
			// Accept both localhost callback and any variant
			if (!url.startsWith(REDIRECT_URI) && !url.startsWith("http://localhost/discord-callback") && !url.startsWith("http://localhost")) return;
			resolved = true;
			try {
				const parsedUrl = new URL(url);
				const code = parsedUrl.searchParams.get("code");
				const returnedState = parsedUrl.searchParams.get("state") || "";
				if (!code) {
					resolve({ success: false, error: parsedUrl.searchParams.get("error") || "No code returned." });
					return closeWindow();
				}
				if (returnedState !== state) {
					resolve({ success: false, error: "State mismatch." });
					return closeWindow();
				}
				exchangeCode(code, config)
					.then(async (tokenRes) => {
						if (!tokenRes.access_token) {
							const errMsg = tokenRes._error || tokenRes.error_description || "Failed to get token.";
							resolve({ success: false, error: "Discord token error: " + errMsg });
							return closeWindow();
						}
						const userInfo = await fetchDiscordUser(tokenRes.access_token);
						resolve({
							success: true,
							discordId: userInfo.id,
							username: userInfo.username,
							avatar: userInfo.avatar
								? `https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}.png`
								: null,
							email: userInfo.email || "",
							globalName: userInfo.global_name,
						});
					})
					.catch((e) => resolve({ success: false, error: e.message }))
					.finally(() => closeWindow());
			} catch (e) { resolve({ success: false, error: e.message }); closeWindow(); }
		}

		function closeWindow() { try { if (!authWindow.isDestroyed()) authWindow.close(); } catch (e) {} }

		// Only intercept the callback URL — let all other Discord redirects (login, consent) proceed normally
		authWindow.webContents.on("will-redirect", (event, url) => {
			if (url.startsWith("http://localhost/discord-callback") || url.startsWith("http://localhost")) {
				event.preventDefault();
				handleCallback(url);
			}
		});
		authWindow.webContents.on("will-navigate", (event, url) => {
			if (url.startsWith("http://localhost/discord-callback") || url.startsWith("http://localhost")) {
				event.preventDefault();
				handleCallback(url);
			}
		});
		authWindow.webContents.on("did-redirect-navigation", (event, url) => {
			if (url.startsWith("http://localhost/discord-callback") || url.startsWith("http://localhost")) {
				handleCallback(url);
			}
		});
		authWindow.on("closed", () => { if (!resolved) { resolved = true; resolve({ success: false, error: "Cancelled." }); } });
		authWindow.loadURL(authUrl);
	});
}

async function exchangeCode(code, config) {
	const body = new URLSearchParams({
		client_id: config.clientId, client_secret: config.clientSecret,
		grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI,
	}).toString();

	return new Promise((resolve, reject) => {
		const postData = body;
		const req = https.request({
			hostname: "discord.com",
			path: "/api/v10/oauth2/token",
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"Content-Length": Buffer.byteLength(postData),
			},
		}, (res) => {
			let data = "";
			res.on("data", (chunk) => data += chunk);
			res.on("end", () => {
				console.log("[DiscordService] Token response status:", res.statusCode, "body:", data.substring(0, 300));
				try {
					const json = JSON.parse(data);
					if (!json.access_token) {
						// Pass Discord's actual error back so the user sees a useful message
						const errMsg = json.error_description || json.error || "Failed to get token";
						resolve({ access_token: null, _error: errMsg, _status: res.statusCode });
					} else {
						resolve(json);
					}
				} catch (e) {
					console.error("[DiscordService] Failed to parse token response:", data);
					resolve({ access_token: null, _error: "Discord returned non-JSON: " + data.substring(0, 200), _status: res.statusCode });
				}
			});
		});
		req.on("error", (e) => {
			console.error("[DiscordService] Token exchange HTTP error:", e.message);
			resolve({ access_token: null, _error: "HTTP error: " + e.message });
		});
		req.write(postData);
		req.end();
	});
}

async function fetchDiscordUser(accessToken) {
	const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!response.ok) throw new Error(`Failed to fetch Discord user: ${response.status}`);
	return response.json();
}

module.exports = {
	DiscordService: { login: () => openDiscordOAuth() },
	// Rich Presence
	connectRichPresence, setPresence, updatePresenceForPage, disconnectRichPresence,
	// OAuth
	openDiscordOAuth,
};
