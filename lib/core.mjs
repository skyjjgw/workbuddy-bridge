// vendor/dsh-connect-workbuddy/shim.ts
import { randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";

// vendor/dsh-connect-workbuddy/auth.ts
import { mkdir as mkdir2, readFile, readdir, rm as rm2, stat } from "node:fs/promises";
import { createHash as createHash2 } from "node:crypto";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname2, join as join3 } from "node:path";

// vendor/dsh-connect-workbuddy/host-peers.ts
import { randomBytes } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
var ATOMIC_WRITE = "@deepseek-ai/dsh-atomic-write";
async function loadHostModule(specifier) {
  try {
    return await import(specifier);
  } catch {
    return void 0;
  }
}
var atomicWrite;
function hostAtomicWrite() {
  atomicWrite ??= loadHostModule(ATOMIC_WRITE);
  return atomicWrite;
}
var DSH_HOME_DIR_NAME = ".dsh";
var DSH_HOME_ENV = "DSH_HOME";
function expandHomePath(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}
function fallbackResolveDshHome(configured, env = process.env) {
  const fromEnv = env[DSH_HOME_ENV];
  const chosen = configured ?? (fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), DSH_HOME_DIR_NAME));
  return resolve(expandHomePath(chosen));
}
var WINDOWS_TRANSIENT_RENAME_ERRORS = /* @__PURE__ */ new Set(["EACCES", "EBUSY", "EPERM"]);
var WINDOWS_RENAME_RETRY_INITIAL_MS = 20;
var WINDOWS_RENAME_RETRY_MAX_MS = 200;
var WINDOWS_RENAME_RETRY_LIMIT = 8;
function isTransientWindowsRenameError(error) {
  if (process.platform !== "win32") return false;
  return WINDOWS_TRANSIENT_RENAME_ERRORS.has(error?.code ?? "");
}
async function renameAtomicTemp(temp, filename) {
  let delay = WINDOWS_RENAME_RETRY_INITIAL_MS;
  for (let retries = 0; ; retries += 1) {
    try {
      await rename(temp, filename);
      return;
    } catch (error) {
      if (!isTransientWindowsRenameError(error)) throw error;
      if (retries >= WINDOWS_RENAME_RETRY_LIMIT) throw error;
    }
    await new Promise((resolve2) => setTimeout(resolve2, delay));
    delay = Math.min(delay * 2, WINDOWS_RENAME_RETRY_MAX_MS);
  }
}
async function fallbackWriteFileAtomic(filename, content, options) {
  await mkdir(dirname(filename), {
    recursive: true,
    ...options.dirMode === void 0 ? {} : { mode: options.dirMode }
  });
  const temp = `${filename}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temp, content, { mode: options.mode, flag: "wx" });
    await renameAtomicTemp(temp, filename);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
async function isLockContention(error, lockPath) {
  const code = error?.code;
  if (code === "EEXIST") return true;
  if (code !== "EPERM") return false;
  try {
    await lstat(lockPath);
    return true;
  } catch {
    return false;
  }
}
var LOCK_RETRY_INITIAL_MS = 20;
var LOCK_RETRY_MAX_MS = 200;
var DEFAULT_LOCK_WAIT_MS = 2e3;
async function fallbackWithFileLock(filename, operation, options) {
  const lockPath = `${filename}.lock`;
  const deadline = Date.now() + (options?.waitMs ?? DEFAULT_LOCK_WAIT_MS);
  let delay = LOCK_RETRY_INITIAL_MS;
  let retriedUnconfirmedPermissionError = false;
  for (; ; ) {
    try {
      await writeFile(lockPath, `${process.pid}
`, { mode: 384, flag: "wx" });
      break;
    } catch (error) {
      if (!await isLockContention(error, lockPath)) {
        const code = error?.code;
        if (process.platform !== "win32" || code !== "EPERM" || retriedUnconfirmedPermissionError) throw error;
        retriedUnconfirmedPermissionError = true;
      }
    }
    if (Date.now() >= deadline) throw new Error(`atomic-write: timed out waiting for the writer lock at ${lockPath}`);
    await new Promise((resolve2) => setTimeout(resolve2, delay));
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
}
function resolveDshHome(configured) {
  return fallbackResolveDshHome(configured);
}
async function writeFileAtomic(filename, content, options) {
  const host = await hostAtomicWrite();
  if (host === void 0) return fallbackWriteFileAtomic(filename, content, options);
  return host.writeFileAtomic(filename, content, options);
}
async function withFileLock(filename, operation, options) {
  const host = await hostAtomicWrite();
  if (host === void 0) return fallbackWithFileLock(filename, operation, options);
  return host.withFileLock(filename, operation, options);
}

// vendor/dsh-connect-workbuddy/at-rest.ts
import { execFile, execFileSync } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2, win32 } from "node:path";
var FRAMING_CODE = {
  file: 1,
  field: 2,
  record: 3,
  stream: 4
};
var STANDARD_FORMAT_ID = {
  file: "WBEF1",
  field: "WBEV1",
  record: "WBER1",
  stream: "WBES1"
};
var AAD_DOMAIN = Buffer.from("WB-AAD\0", "ascii");
var SYMMETRIC_SCHEME = "sym-v1";
var WORKBUDDY_APP_EXECUTABLE_ENV = "WORKBUDDY_APP_EXECUTABLE";
var KEY_FETCH_TIMEOUT_MS = 1e4;
var APP_EXECUTABLE_NAME = "WorkBuddy.exe";
var MACOS_APP_BUNDLE_NAMES = ["WorkBuddy.app", "WorkBuddy AI.app"];
function encodeUint32(value) {
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32BE(value);
  return bytes;
}
function encodeLengthPrefixed(value) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([encodeUint32(bytes.length), bytes]);
}
function fieldAad(keyId, suite, scheme = SYMMETRIC_SCHEME) {
  if (!/^[0-9a-f]{16}$/u.test(keyId)) throw new Error(`workbuddy: envelope keyId is malformed`);
  return Buffer.concat([
    AAD_DOMAIN,
    Buffer.from([1]),
    encodeLengthPrefixed(STANDARD_FORMAT_ID["field"]),
    encodeLengthPrefixed(scheme),
    encodeUint32(suite),
    encodeLengthPrefixed(keyId),
    Buffer.from([FRAMING_CODE["field"]]),
    // encodeOptionalUint64(undefined): field framing carries no sequence.
    Buffer.from([0]),
    // final === undefined
    Buffer.from([0])
  ]);
}
function isEncryptedFieldWrapper(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const wrapper = value;
  const keys = Object.keys(wrapper).sort();
  return keys.length === 2 && keys[0] === "$wbEncrypted" && keys[1] === "envelope" && wrapper["$wbEncrypted"] === 1 && typeof wrapper["envelope"] === "string";
}
function deriveAtRestKeyId(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
function deriveAtRestKey(payloadJson) {
  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error("workbuddy: at-rest key payload is not valid JSON");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("workbuddy: at-rest key payload is not an object");
  }
  const secret = payload["atRestSecretKey"];
  if (typeof secret !== "string" || secret === "") {
    throw new Error("workbuddy: at-rest key payload carries no atRestSecretKey");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}
function openEncryptedField(field, key) {
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(field.envelope, "base64").toString("utf8"));
  } catch {
    throw new Error("workbuddy: encrypted field envelope is not valid JSON");
  }
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    throw new Error("workbuddy: encrypted field envelope is not an object");
  }
  const record = envelope;
  const suite = record["suite"];
  const keyId = record["keyId"];
  const nonce = record["nonce"];
  const authTag = record["authTag"];
  const ciphertext = record["ciphertext"];
  if (typeof suite !== "number" || typeof keyId !== "string") {
    throw new Error("workbuddy: encrypted field envelope is missing suite or keyId");
  }
  if (typeof nonce !== "string" || typeof authTag !== "string" || typeof ciphertext !== "string") {
    throw new Error("workbuddy: encrypted field envelope is missing nonce, authTag or ciphertext");
  }
  const expectedKeyId = deriveAtRestKeyId(key);
  if (keyId !== expectedKeyId) {
    throw new Error(`workbuddy: encrypted field belongs to key ${keyId}, not the available key ${expectedKeyId}`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"), { authTagLength: 16 });
  decipher.setAAD(fieldAad(keyId, suite));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}
function macosBundleExecutable(bundle) {
  let plist;
  try {
    plist = readFileSync(join2(bundle, "Contents", "Info.plist"), "utf8");
  } catch {
    return void 0;
  }
  const match = /<key>\s*CFBundleExecutable\s*<\/key>\s*<string>([^<]*)<\/string>/u.exec(plist);
  const name = match?.[1]?.trim();
  if (name === void 0 || name === "" || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    return void 0;
  }
  return join2(bundle, "Contents", "MacOS", name);
}
function windowsRegistryAppExecutable(query = queryRegistry) {
  const keys = [
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
  ];
  for (const root of keys) {
    const listing = query(["query", root, "/s", "/f", "WorkBuddy", "/t", "REG_SZ"]);
    if (listing === void 0) continue;
    const executable = registryExecutableFromQuery(listing);
    if (executable !== void 0) return executable;
    const fromDirectory = registryInstallLocationFromQuery(listing);
    if (fromDirectory !== void 0) return fromDirectory;
  }
  return void 0;
}
function registryExecutableFromQuery(output) {
  for (const rawLine of output.split(/\r?\n/u)) {
    const match = /^\s*DisplayIcon\s+REG_SZ\s+(.*?)\s*$/u.exec(rawLine);
    if (match === null) continue;
    const executable = normalizeRegistryExecutable(match[1]);
    if (executable !== void 0) return executable;
  }
  return void 0;
}
function registryInstallLocationFromQuery(output) {
  for (const rawLine of output.split(/\r?\n/u)) {
    const match = /^\s*InstallLocation\s+REG_SZ\s+(.*?)\s*$/u.exec(rawLine);
    if (match === null) continue;
    const directory = stripRegistryQuotes(match[1]);
    if (directory === void 0 || directory === "") continue;
    return win32.join(directory, APP_EXECUTABLE_NAME);
  }
  return void 0;
}
function normalizeRegistryExecutable(value) {
  const unquoted = stripRegistryQuotes(value);
  if (unquoted === void 0 || unquoted === "") return void 0;
  const withoutIndex = unquoted.replace(/,\s*-?\d+\s*$/u, "");
  if (withoutIndex === "") return void 0;
  if (win32.basename(withoutIndex).toLowerCase() !== APP_EXECUTABLE_NAME.toLowerCase()) return void 0;
  return withoutIndex;
}
function stripRegistryQuotes(value) {
  const trimmed = value.trim();
  if (trimmed === "") return void 0;
  if (!trimmed.startsWith('"')) return trimmed;
  const closing = trimmed.indexOf('"', 1);
  if (closing === -1) return void 0;
  return trimmed.slice(1, closing).trim();
}
function queryRegistry(args) {
  try {
    return execFileSync("reg", [...args], REGISTRY_PROBE_OPTIONS);
  } catch {
    return void 0;
  }
}
var REGISTRY_PROBE_OPTIONS = { encoding: "utf8", windowsHide: true, timeout: 1e4 };
function workbuddyAppExecutableCandidates(platform = process.platform, home = homedir2(), env = process.env, readBundleExecutable = macosBundleExecutable) {
  const candidates = [env[WORKBUDDY_APP_EXECUTABLE_ENV]?.trim()];
  if (platform === "win32") {
    const local = env["LOCALAPPDATA"]?.trim();
    const programFiles = env["ProgramFiles"]?.trim();
    const programFilesX86 = env["ProgramFiles(x86)"]?.trim();
    candidates.push(
      local === void 0 || local === "" ? void 0 : win32.join(local, "Programs", "WorkBuddy", APP_EXECUTABLE_NAME),
      local === void 0 || local === "" ? void 0 : win32.join(local, "WorkBuddy", APP_EXECUTABLE_NAME),
      programFiles === void 0 || programFiles === "" ? void 0 : win32.join(programFiles, "WorkBuddy", APP_EXECUTABLE_NAME),
      programFilesX86 === void 0 || programFilesX86 === "" ? void 0 : win32.join(programFilesX86, "WorkBuddy", APP_EXECUTABLE_NAME)
    );
  } else if (platform === "darwin") {
    for (const name of MACOS_APP_BUNDLE_NAMES) {
      candidates.push(
        readBundleExecutable(join2("/Applications", name)),
        readBundleExecutable(join2(home, "Applications", name))
      );
    }
  }
  return candidates.filter((candidate) => candidate !== void 0 && candidate !== "");
}
var APP_BUNDLE_IDENTIFIER_PREFIXES = ["com.tencent.workbuddy", "com.workbuddy"];
function isWorkbuddyBundle(bundle) {
  let plist;
  try {
    plist = readFileSync(join2(bundle, "Contents", "Info.plist"), "utf8");
  } catch {
    return false;
  }
  const match = /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>([^<]*)<\/string>/u.exec(plist);
  const identifier = match?.[1]?.trim().toLowerCase();
  if (identifier === void 0 || identifier === "") return false;
  return APP_BUNDLE_IDENTIFIER_PREFIXES.some((prefix) => identifier === prefix || identifier.startsWith(`${prefix}.`));
}
function macosNestedAppBundles(parent) {
  let entries;
  try {
    entries = readdirSync(parent);
  } catch {
    return [];
  }
  const bundles = [];
  for (const entry of entries) {
    const nested = join2(parent, entry);
    for (const name of MACOS_APP_BUNDLE_NAMES) {
      const bundle = join2(nested, name);
      try {
        if (!statSync(bundle).isDirectory()) continue;
      } catch {
        continue;
      }
      if (isWorkbuddyBundle(bundle)) bundles.push(bundle);
    }
  }
  return bundles;
}
function findWorkbuddyAppExecutable(platform = process.platform, home = homedir2(), env = process.env, readRegistryAppPath = windowsRegistryAppExecutable) {
  for (const candidate of workbuddyAppExecutableCandidates(platform, home, env)) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
    }
  }
  if (platform === "win32") {
    const fromRegistry = readRegistryAppPath();
    if (fromRegistry !== void 0) {
      try {
        if (existsSync(fromRegistry)) return fromRegistry;
      } catch {
      }
    }
  }
  if (platform === "darwin") {
    for (const parent of ["/Applications", join2(home, "Applications")]) {
      for (const bundle of macosNestedAppBundles(parent)) {
        const executable = macosBundleExecutable(bundle);
        if (executable === void 0) continue;
        try {
          if (existsSync(executable)) return executable;
        } catch {
        }
      }
    }
  }
  return void 0;
}
function fetchAtRestKeyPayload(executable) {
  return new Promise((resolve2, reject) => {
    const source = "try{process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet())}catch(e){process.exitCode=3;process.stderr.write(String(e&&e.message||e))}";
    execFile(
      executable,
      ["-e", source],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        timeout: KEY_FETCH_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`workbuddy: the desktop app did not provide its at-rest key (${stderr.trim() || error.message})`));
          return;
        }
        const payload = stdout.trim();
        if (payload === "") {
          reject(new Error("workbuddy: the desktop app returned an empty at-rest key payload"));
          return;
        }
        resolve2(payload);
      }
    );
  });
}
var cachedKey;
var inflightKey;
function readAtRestKey() {
  if (cachedKey !== void 0) return Promise.resolve(cachedKey);
  inflightKey ??= (async () => {
    const executable = findWorkbuddyAppExecutable();
    if (executable === void 0) return void 0;
    const payload = await fetchAtRestKeyPayload(executable);
    const key = deriveAtRestKey(payload);
    cachedKey = key;
    return key;
  })().finally(() => {
    inflightKey = void 0;
  });
  return inflightKey;
}

// vendor/dsh-connect-workbuddy/upstream.ts
var CN_CHAT_BASE = "https://copilot.tencent.com";
var CN_BILLING_BASE = "https://www.codebuddy.cn";
var GLOBAL_BASE = "https://www.workbuddy.ai";
var MODELS_CATALOG_PATH = "/v2/enterprises/personal/models";
var GLOBAL_CONFIG_PATH = "/v3/config";
var CLIENT_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
var DESKTOP_UA = "WorkBuddy/5.5.2";
var JSON_TIMEOUT_MS = 3e4;
var ERROR_BODY_LIMIT = 4096;
var PROBE_TIMEOUT_MS = 1e4;
var HARD_CREDIT_MARKERS = [
  "insufficient credit",
  "no credit",
  "credit exhausted",
  "credits exhausted",
  "out of credit",
  "quota exceeded",
  "quota exhaust",
  "payment required",
  "credit not enough",
  "not enough credit",
  "credits not enough",
  "\u79EF\u5206\u4E0D\u8DB3",
  "\u989D\u5EA6\u4E0D\u8DB3",
  "\u4F59\u989D\u4E0D\u8DB3",
  "\u79EF\u5206\u7528\u5B8C",
  "\u989D\u5EA6\u7528\u5C3D",
  "\u6CA1\u6709\u79EF\u5206"
];
var CREDITS_EXHAUSTED_CODE = '"code":14018';
var SESSION_DEAD_MARKERS = ["Offline user session not found", "12153"];
var POLICY_REJECT_MARKERS = ["request illegal", '"code":11140'];
var MODEL_BUSY_CODE = '"code":14003';
function isModelBusyBody(body) {
  return body.includes(MODEL_BUSY_CODE);
}
function classifyUpstreamError(status, body) {
  if (status === 402) return "hard_credit";
  const lower = body.toLowerCase();
  for (const marker of HARD_CREDIT_MARKERS) {
    if (lower.includes(marker.toLowerCase()) || body.includes(marker)) return "hard_credit";
  }
  if (body.includes(CREDITS_EXHAUSTED_CODE)) return "hard_credit";
  for (const marker of SESSION_DEAD_MARKERS) {
    if (body.includes(marker)) return "session_dead";
  }
  for (const marker of POLICY_REJECT_MARKERS) {
    if (body.includes(marker)) return "policy_reject";
  }
  if (isModelBusyBody(body)) return "model_busy";
  if (status === 429) return "soft_rate";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return "client";
}
function parseUpstreamErrorDetail(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null) return void 0;
  const raw = parsed;
  let displayMsg;
  const display = raw.displayMsg;
  if (typeof display === "string") {
    displayMsg = display;
  } else if (typeof display === "object" && display !== null) {
    const localized = display;
    const pick = localized.zh ?? localized.en;
    if (typeof pick === "string") displayMsg = pick;
  }
  if (displayMsg === void 0 && typeof raw.msg === "string") displayMsg = raw.msg;
  const detail = {};
  if (typeof raw.code === "number") detail.upstreamCode = raw.code;
  if (typeof raw.requestId === "string") detail.requestId = raw.requestId;
  if (displayMsg !== void 0) detail.displayMsg = displayMsg;
  return detail;
}
function regionOf(domain) {
  const lowered = domain.trim().toLowerCase();
  if (lowered === "workbuddy.ai" || lowered.endsWith(".workbuddy.ai")) return "global";
  if (lowered === "codebuddy.ai" || lowered.endsWith(".codebuddy.ai")) return "global";
  return "cn";
}
function globalBase(domain) {
  const lowered = domain.trim().toLowerCase();
  if (lowered === "codebuddy.ai" || lowered.endsWith(".codebuddy.ai")) return "https://www.codebuddy.ai";
  return GLOBAL_BASE;
}
function chatBase(credential) {
  return regionOf(credential.domain) === "global" ? globalBase(credential.domain) : CN_CHAT_BASE;
}
function billingBase(credential) {
  return regionOf(credential.domain) === "global" ? globalBase(credential.domain) : CN_BILLING_BASE;
}
function originReferer(credential) {
  return regionOf(credential.domain) === "global" ? globalBase(credential.domain) : CN_BILLING_BASE;
}
function commonHeaders(credential) {
  return {
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": originReferer(credential),
    "Referer": `${originReferer(credential)}/`,
    "User-Agent": CLIENT_UA
  };
}
function chatHeaders(credential) {
  const headers = {
    ...commonHeaders(credential),
    "Content-Type": "application/json",
    // 安全红线：chat 请求绝不携带 refresh token。
    ...credential.uid === "" ? { "X-No-User-Id": "1" } : { "X-User-Id": credential.uid },
    ...credential.enterpriseId === void 0 || credential.enterpriseId === "" ? { "X-No-Enterprise-Id": "1" } : { "X-Enterprise-Id": credential.enterpriseId },
    ...credential.domain === "" ? { "X-No-Department-Info": "1" } : { "X-Domain": credential.domain },
    "X-Product": "SaaS"
  };
  return headers;
}
function refreshHeaders(credential) {
  const headers = {
    ...commonHeaders(credential),
    "X-Refresh-Token": credential.refreshToken,
    "X-Auth-Refresh-Source": "workbuddy"
  };
  if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") {
    headers["X-Enterprise-Id"] = credential.enterpriseId;
  }
  return headers;
}
function billingHeaders(credential) {
  const headers = {
    "Authorization": `Bearer ${credential.accessToken}`,
    "Accept": "application/json",
    "Content-Type": "application/json"
  };
  if (credential.uid !== "") headers["X-User-Id"] = credential.uid;
  if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") {
    headers["X-Enterprise-Id"] = credential.enterpriseId;
    headers["X-Tenant-Id"] = credential.enterpriseId;
  }
  if (credential.domain !== "") headers["X-Domain"] = credential.domain;
  return headers;
}
var WORKBUDDY_FALLBACK_SYSTEM_PROMPT = "You are a helpful assistant.";
function ensureSystemHead(obj) {
  const messages = obj["messages"];
  if (!Array.isArray(messages) || messages.length === 0) return;
  const head = messages[0];
  if (typeof head !== "object" || head === null || Array.isArray(head)) return;
  const role = head["role"];
  if (typeof role === "string" && role.trim().toLowerCase() === "system") return;
  messages.unshift({ role: "system", content: WORKBUDDY_FALLBACK_SYSTEM_PROMPT });
}
function prepareChatBody(source) {
  let body;
  try {
    body = JSON.parse(source);
  } catch {
    return source;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return source;
  const obj = body;
  obj["stream"] = true;
  if (Array.isArray(obj["messages"])) {
    for (const value of obj["messages"]) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const message = value;
      if (message["role"] === "developer") message["role"] = "system";
    }
  }
  ensureSystemHead(obj);
  normalizeToolChoice(obj);
  return JSON.stringify(obj);
}
function normalizeToolChoice(obj) {
  const suppress = () => {
    delete obj["tools"];
    delete obj["functions"];
  };
  const present = "tool_choice" in obj;
  if (!present) return;
  const choice = obj["tool_choice"];
  if (typeof choice === "string") {
    if (choice.trim().toLowerCase() === "none") {
      delete obj["tool_choice"];
      suppress();
    }
    return;
  }
  if (typeof choice === "object" && choice !== null && !Array.isArray(choice)) {
    const wrapped = choice;
    const type = typeof wrapped["type"] === "string" ? wrapped["type"].trim().toLowerCase() : "";
    if (type === "none") {
      delete obj["tool_choice"];
      suppress();
    } else if (type === "auto" || type === "required") {
      obj["tool_choice"] = type;
    } else if (type === "function") {
      const fn = typeof wrapped["function"] === "object" && wrapped["function"] !== null ? wrapped["function"] : void 0;
      let name = typeof fn?.["name"] === "string" ? fn["name"] : "";
      if (name === "" && typeof wrapped["name"] === "string") name = wrapped["name"];
      name = name.trim();
      obj["tool_choice"] = name !== "" ? name : "auto";
    } else {
      delete obj["tool_choice"];
    }
    return;
  }
  delete obj["tool_choice"];
}
function declaredTools(bodyJson) {
  let body;
  try {
    body = JSON.parse(bodyJson);
  } catch {
    return void 0;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return void 0;
  const obj = body;
  const tools = obj["tools"];
  if (!Array.isArray(tools)) return void 0;
  const names = /* @__PURE__ */ new Set();
  const requiredParameters = /* @__PURE__ */ new Map();
  for (const value of tools) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const wrapped = value;
    const fn = wrapped["function"];
    if (typeof fn !== "object" || fn === null || Array.isArray(fn)) continue;
    const definition = fn;
    const name = typeof definition["name"] === "string" ? definition["name"] : "";
    if (name === "") continue;
    names.add(name);
    const parameters = definition["parameters"];
    if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) continue;
    const required = parameters["required"];
    if (!Array.isArray(required)) continue;
    const list = required.filter((entry) => typeof entry === "string" && entry !== "");
    if (list.length > 0) requiredParameters.set(name, list);
  }
  if (names.size === 0) return void 0;
  const pinned = typeof obj["tool_choice"] === "string" ? obj["tool_choice"].trim() : "";
  const pinnedToolName = pinned !== "" && !["auto", "required", "none"].includes(pinned.toLowerCase()) ? pinned : void 0;
  return {
    names,
    requiredParameters,
    ...pinnedToolName === void 0 ? {} : { pinnedToolName }
  };
}
function isGatewayAuthRejection(status, text) {
  if (status !== 401 && status !== 403) return false;
  const lower = text.toLowerCase();
  return lower.includes("openresty") || lower.includes("apisix") || lower.includes("authorization required");
}
var CREDENTIAL_REJECTED_CODE = "WORKBUDDY_CREDENTIAL_REJECTED";
var WorkBuddyCredentialRejectedError = class extends Error {
  code = CREDENTIAL_REJECTED_CODE;
  /** HTTP status the upstream answered with (401 or 403). */
  status;
  constructor(status) {
    super(
      `workbuddy: the signed-in credential was rejected by the upstream gateway (http ${status}). The stored token is no longer accepted \u2014 most likely a stale credential file from an earlier sign-in was selected. Re-sign in to the WorkBuddy desktop app, then pick that account in the plugin card. Run \`dsh-connect-workbuddy doctor\` to list every discovered credential.`
    );
    this.name = "WorkBuddyCredentialRejectedError";
    this.status = status;
  }
};
async function readEnvelope(response) {
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (isGatewayAuthRejection(response.status, text)) {
      throw new WorkBuddyCredentialRejectedError(response.status);
    }
    throw new Error(`workbuddy upstream returned non-JSON (http ${response.status}): ${text.slice(0, 160)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`workbuddy upstream returned an unexpected document (http ${response.status})`);
  }
  const document = parsed;
  const envelope = {
    code: typeof document["code"] === "number" ? document["code"] : 0,
    msg: typeof document["msg"] === "string" ? document["msg"] : "",
    data: "data" in document ? document["data"] : void 0
  };
  return envelope;
}
function envelopeError(status, envelope) {
  if (status === 401 || status === 403) return new WorkBuddyCredentialRejectedError(status);
  const kind = classifyUpstreamError(status, envelope.msg);
  return new Error(`workbuddy upstream ${kind} (http ${status}): ${envelope.msg.slice(0, 160)}`);
}
function parseCreditMultiplier(value) {
  if (typeof value !== "string") return void 0;
  const match = /x\s*([0-9]*\.?[0-9]+)/iu.exec(value);
  if (match === null) return void 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
}
var SINGULAR_EFFORT_LADDER = ["low", "medium", "high", "xhigh", "max"];
function isSingularEffortForm(raw) {
  return typeof raw["effort"] === "string" && !Array.isArray(raw["supportedEfforts"]) && typeof raw["defaultEffort"] !== "string" && typeof raw["canDisableThinking"] !== "boolean";
}
function singularEffortLadder(raw) {
  const effort = typeof raw["effort"] === "string" ? raw["effort"] : void 0;
  if (effort === void 0) return void 0;
  return SINGULAR_EFFORT_LADDER.includes(effort) ? [...SINGULAR_EFFORT_LADDER] : [effort];
}
function parseReasoning(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const raw = value;
  const effort = typeof raw["effort"] === "string" ? raw["effort"] : void 0;
  const supportedEfforts = Array.isArray(raw["supportedEfforts"]) ? raw["supportedEfforts"].filter((entry) => typeof entry === "string") : singularEffortLadder(raw);
  const defaultEffort = typeof raw["defaultEffort"] === "string" ? raw["defaultEffort"] : effort;
  const canDisableThinking = typeof raw["canDisableThinking"] === "boolean" ? raw["canDisableThinking"] : isSingularEffortForm(raw) ? true : void 0;
  if (supportedEfforts === void 0 && defaultEffort === void 0 && canDisableThinking === void 0) {
    return void 0;
  }
  return {
    ...supportedEfforts === void 0 || supportedEfforts.length === 0 ? {} : { supportedEfforts },
    ...defaultEffort === void 0 ? {} : { defaultEffort },
    ...canDisableThinking === void 0 ? {} : { canDisableThinking }
  };
}
function parseUpstreamModel(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const raw = value;
  const id = typeof raw["id"] === "string" ? raw["id"] : "";
  if (id === "" || raw["disabled"] === true) return void 0;
  const input = typeof raw["maxInputTokens"] === "number" ? raw["maxInputTokens"] : 0;
  const output = typeof raw["maxOutputTokens"] === "number" ? raw["maxOutputTokens"] : 0;
  if (input <= 0 || output <= 0) return void 0;
  const name = typeof raw["name"] === "string" && raw["name"] !== "" ? raw["name"] : id;
  const descriptionZh = typeof raw["descriptionZh"] === "string" && raw["descriptionZh"] !== "" ? raw["descriptionZh"] : void 0;
  const descriptionEn = typeof raw["descriptionEn"] === "string" && raw["descriptionEn"] !== "" ? raw["descriptionEn"] : void 0;
  const creditMultiplier = parseCreditMultiplier(raw["credits"]);
  const reasoning = parseReasoning(raw["reasoning"]);
  const supportsToolCall = typeof raw["supportsToolCall"] === "boolean" ? raw["supportsToolCall"] : void 0;
  const supportsImages = raw["disabledMultimodal"] === true ? false : typeof raw["supportsImages"] === "boolean" ? raw["supportsImages"] : void 0;
  return {
    id,
    name,
    contextWindow: input,
    maxTokens: output,
    ...creditMultiplier === void 0 ? {} : { creditMultiplier },
    ...supportsImages === void 0 ? {} : { supportsImages },
    ...reasoning === void 0 ? {} : { reasoning },
    ...descriptionZh === void 0 ? {} : { descriptionZh },
    ...descriptionEn === void 0 ? {} : { descriptionEn },
    ...supportsToolCall === void 0 ? {} : { supportsToolCall }
  };
}
function selectCliModels(rawModels, agents) {
  const byId = /* @__PURE__ */ new Map();
  for (const model of Array.isArray(rawModels) ? rawModels : []) {
    const parsed = parseUpstreamModel(model);
    if (parsed !== void 0) byId.set(parsed.id, parsed);
  }
  let cliIds;
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (typeof agent === "object" && agent !== null) {
      const wrapped = agent;
      if (wrapped["name"] === "cli" && Array.isArray(wrapped["models"])) {
        cliIds = wrapped["models"].filter((id) => typeof id === "string");
        break;
      }
    }
  }
  const ids = cliIds !== void 0 && cliIds.length > 0 ? cliIds : [...byId.keys()];
  const models = ids.map((id) => byId.get(id)).filter((model) => model !== void 0);
  if (models.length === 0) throw new Error("workbuddy model catalog resolved to an empty list");
  return models;
}
var WorkBuddyUpstreamClient = class {
  /**
   * Reports a fallback the catalog reader had to take.
   *
   * Injected rather than logged here because this module holds no logger on
   * purpose — it is pure transport + parsing, so it stays importable from
   * tests and the CLI without a cordis context. The host wires its
   * `ctx.logger.warn` in; without a host the event is dropped, which is the
   * same silence the previous single-source reader had.
   */
  constructor(onFallback) {
    this.onFallback = onFallback;
  }
  onFallback;
  /** POST the chat endpoint; a successful answer is the raw SSE response. */
  async chatStream(credential, bodyJson, signal) {
    let response;
    try {
      response = await fetch(`${chatBase(credential)}/v2/chat/completions`, {
        method: "POST",
        headers: { ...chatHeaders(credential), "Authorization": `Bearer ${credential.accessToken}` },
        body: bodyJson,
        ...signal === void 0 ? {} : { signal }
      });
    } catch (error) {
      return { ok: false, status: 0, kind: "server", message: `transport error: ${String(error)}` };
    }
    if (response.ok) return { ok: true, response };
    const text = (await response.text()).slice(0, ERROR_BODY_LIMIT);
    return {
      ok: false,
      status: response.status,
      kind: classifyUpstreamError(response.status, text),
      message: text,
      detail: parseUpstreamErrorDetail(text)
    };
  }
  /**
   * Send one minimal chat request for `bodyJson` and report the RAW answer.
   *
   * Shares {@link chatHeaders} and the chat base with {@link chatStream} on
   * purpose: a probe is only meaningful if it reaches the same endpoint with the
   * same authentication as a real request. The differences are deliberate and
   * narrow — it returns the headers (for `Retry-After`) and the failure body
   * (for classification) instead of a pre-classified error, so the probe module
   * owns the interpretation and the network layer stays a transport.
   *
   * The caller MUST drain {@link WorkBuddyProbeAnswer.response}; an unread body
   * holds the connection open.
   *
   * ALWAYS bounded in time. The pool's batch runner is serial and passes no
   * signal, so without a ceiling here one stalled connection blocks every account
   * behind it — the batch looks hung with no way to tell which member did it.
   * A supplied signal is COMBINED with the timeout rather than replacing it, so
   * the single-model route keeps its cancellation behaviour and still cannot
   * hang forever.
   *
   * The ceiling covers ONLY the wait for a response — it is cleared the moment
   * `fetch` resolves. Holding a timer over the body would put a healthy but slow
   * model on the same clock as a dead endpoint, and the whole point of the
   * period is to answer "did the upstream answer at all". A probe asks for a
   * single token, so the body that follows is one SSE line.
   */
  async probeChat(credential, bodyJson, signal) {
    let response;
    const ceiling = new AbortController();
    const timer = setTimeout(() => {
      ceiling.abort(new Error(`no response within ${PROBE_TIMEOUT_MS}ms`));
    }, PROBE_TIMEOUT_MS);
    try {
      response = await fetch(`${chatBase(credential)}/v2/chat/completions`, {
        method: "POST",
        headers: { ...chatHeaders(credential), "Authorization": `Bearer ${credential.accessToken}` },
        body: bodyJson,
        signal: signal === void 0 ? ceiling.signal : AbortSignal.any([signal, ceiling.signal])
      });
    } catch (error) {
      return { ok: false, status: 0, retryAfter: null, body: `transport error: ${String(error)}` };
    } finally {
      clearTimeout(timer);
    }
    const retryAfter = response.headers.get("retry-after");
    if (response.ok) return { ok: true, status: response.status, retryAfter, response };
    const body = (await response.text()).slice(0, ERROR_BODY_LIMIT);
    return { ok: false, status: response.status, retryAfter, body };
  }
  /** POST the token-refresh endpoint; the caller merges the outcome. */
  async refreshToken(credential) {
    const response = await fetch(`${chatBase(credential)}/v2/plugin/auth/token/refresh`, {
      method: "POST",
      headers: refreshHeaders(credential),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
    });
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
    const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
    const accessToken = typeof data["accessToken"] === "string" ? data["accessToken"] : "";
    if (accessToken === "") throw new Error("workbuddy token refresh returned no accessToken; sign in again in the WorkBuddy app");
    const outcome = { accessToken };
    if (typeof data["refreshToken"] === "string" && data["refreshToken"] !== "") outcome.refreshToken = data["refreshToken"];
    if (typeof data["expiresIn"] === "number" && data["expiresIn"] > 0) outcome.expiresInSec = data["expiresIn"];
    if (typeof data["domain"] === "string" && data["domain"] !== "") outcome.domain = data["domain"];
    return outcome;
  }
  /**
   * Read the model directory for the credential's region.
   *
   * Both regions prefer `/v3/config`, the document the WorkBuddy app itself
   * consumes, so the plugin's roster and the app's agree. They differ in the
   * user agent that requests it, and that difference is load-bearing: `/v3`
   * serves a different roster per client channel. Global asks as the desktop
   * channel (see {@link DESKTOP_UA}); CN asks as the CLI channel
   * ({@link CLIENT_UA}), which is the only CN channel whose `/v3` answer
   * contains the free `hy4-preview-f` (see {@link GLOBAL_CONFIG_PATH}).
   *
   * CN falls back to the legacy {@link MODELS_CATALOG_PATH} when `/v3` fails,
   * returns a non-zero envelope, or resolves to no usable model, so a gateway
   * that stops serving the modern document degrades to the previous roster
   * instead of leaving the region empty. The fallback is silent when unused and
   * reported when it fires, because a roster that silently differs from the
   * app's is exactly the bug this ordering exists to fix.
   *
   * No user-side toggle is involved: the region comes from the credential's
   * `domain`.
   */
  async fetchModels(credential, signal) {
    const timeout = signal ?? AbortSignal.timeout(JSON_TIMEOUT_MS);
    const global = regionOf(credential.domain) === "global";
    if (global) {
      const response = await fetch(`${globalBase(credential.domain)}${GLOBAL_CONFIG_PATH}`, {
        headers: {
          "Authorization": `Bearer ${credential.accessToken}`,
          "Accept": "application/json",
          ...credential.uid === "" ? {} : { "X-User-Id": credential.uid },
          ...credential.domain === "" ? {} : { "X-Domain": credential.domain },
          "X-Product": "SaaS",
          "X-Requested-With": "XMLHttpRequest",
          "Connection": "close",
          "User-Agent": DESKTOP_UA
        },
        signal: timeout
      });
      const envelope = await readEnvelope(response);
      if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
      const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
      return selectCliModels(data["models"], data["agents"]);
    }
    const readCatalog = async (path) => {
      const response = await fetch(`${chatBase(credential)}${path}`, {
        headers: {
          "Authorization": `Bearer ${credential.accessToken}`,
          "Accept": "application/json",
          "Origin": originReferer(credential),
          "Referer": `${originReferer(credential)}/`,
          "User-Agent": CLIENT_UA
        },
        signal: timeout
      });
      const envelope = await readEnvelope(response);
      if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
      const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
      return selectCliModels(data["models"], data["agents"]);
    };
    try {
      return await readCatalog(GLOBAL_CONFIG_PATH);
    } catch (error) {
      this.onFallback?.(
        `CN model catalog ${GLOBAL_CONFIG_PATH} failed; falling back to ${MODELS_CATALOG_PATH}: ` + (error instanceof Error ? error.message : String(error))
      );
      return await readCatalog(MODELS_CATALOG_PATH);
    }
  }
  /** Query today's check-in status without changing account state. */
  async fetchCheckinStatus(credential) {
    const response = await fetch(`${billingBase(credential)}/v2/billing/meter/checkin-activity-status`, {
      method: "POST",
      headers: billingHeaders(credential),
      body: "{}",
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
    });
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
    const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
    const numberField = (key) => typeof data[key] === "number" ? data[key] : 0;
    return {
      active: data["active"] === true,
      todayCheckedIn: data["today_checked_in"] === true,
      streakDays: numberField("streak_days"),
      dailyCredit: numberField("daily_credit"),
      todayCredit: numberField("today_credit"),
      isStreakDay: data["is_streak_day"] === true,
      nextStreakDay: numberField("next_streak_day"),
      streakBonusDays: numberField("streak_bonus_days"),
      streakBonusCredit: numberField("streak_bonus_credit"),
      ...typeof data["claim_button_text"] === "string" && data["claim_button_text"] !== "" ? { claimButtonText: data["claim_button_text"] } : {}
    };
  }
  /** Claim today's check-in reward. The browser route guards this mutation. */
  async claimDailyCheckin(credential) {
    const response = await fetch(`${billingBase(credential)}/v2/billing/meter/daily-checkin`, {
      method: "POST",
      headers: billingHeaders(credential),
      body: "{}",
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
    });
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
    const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
    const numberField = (key) => typeof data[key] === "number" ? data[key] : 0;
    return {
      credit: numberField("credit"),
      streakDays: numberField("streak_days"),
      isStreakDay: data["is_streak_day"] === true
    };
  }
  /**
   * POST the billing endpoint for the remaining credit, keeping every package
   * separate: the card groups monthly-cycle packages itself and lists the
   * nearest-expiring one-off packages, so aggregation here would lose the
   * dates it needs.
   */
  async fetchCredits(credential) {
    const now = /* @__PURE__ */ new Date();
    const format = (date) => [
      date.getFullYear().toString().padStart(4, "0"),
      (date.getMonth() + 1).toString().padStart(2, "0"),
      date.getDate().toString().padStart(2, "0")
    ].join("-") + " " + [
      date.getHours().toString().padStart(2, "0"),
      date.getMinutes().toString().padStart(2, "0"),
      date.getSeconds().toString().padStart(2, "0")
    ].join(":");
    const response = await fetch(`${billingBase(credential)}/v2/billing/meter/get-user-resource`, {
      method: "POST",
      headers: billingHeaders(credential),
      body: JSON.stringify({
        PageNumber: 1,
        PageSize: 100,
        ProductCode: "p_tcaca",
        Status: [0, 3],
        PackageEndTimeRangeBegin: format(now),
        PackageEndTimeRangeEnd: format(new Date(now.getTime() + 365 * 101 * 24 * 3600 * 1e3))
      }),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
    });
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
    const responseWrapper = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
    const data = typeof responseWrapper["Response"] === "object" && responseWrapper["Response"] !== null ? responseWrapper["Response"] : {};
    const inner = typeof data["Data"] === "object" && data["Data"] !== null ? data["Data"] : {};
    const rawAccounts = Array.isArray(inner["Accounts"]) ? inner["Accounts"] : [];
    let total = 0;
    let nearestExpiryMs;
    let expiringSoon = 0;
    const SOON_MS = 3 * 24 * 60 * 60 * 1e3;
    const parseDate = (raw) => {
      if (typeof raw === "number" && raw > 1e12) return raw;
      if (typeof raw === "string" && raw !== "") {
        const parsed = Date.parse(raw);
        if (!Number.isNaN(parsed)) return parsed;
      }
      return void 0;
    };
    const packages = [];
    for (const raw of rawAccounts) {
      if (typeof raw !== "object" || raw === null) continue;
      const account = raw;
      const numberField = (key) => typeof account[key] === "number" ? account[key] : 0;
      const preciseField = (key) => {
        const raw2 = account[`${key}Precise`];
        if (typeof raw2 === "string" && raw2 !== "") {
          const parsed = Number.parseFloat(raw2);
          if (Number.isFinite(parsed)) return parsed;
        }
        if (typeof raw2 === "number" && Number.isFinite(raw2)) return raw2;
        return numberField(key);
      };
      const monthly = numberField("CapacityType") === 4;
      const size = preciseField("CycleCapacitySize") || preciseField("CapacitySize");
      const hasCycle = account["CycleCapacityRemain"] !== void 0 || account["CycleCapacityRemainPrecise"] !== void 0;
      const remain = hasCycle ? preciseField("CycleCapacityRemain") : preciseField("CapacityRemain");
      const cappedRemain = remain < 0 ? 0 : remain;
      const cycleEndMs = parseDate(account["CycleEndTime"]);
      const expiresAtMs = monthly ? void 0 : parseDate(account["ExpiredTime"]) ?? cycleEndMs;
      const refreshAtMs = monthly ? cycleEndMs === void 0 ? void 0 : cycleEndMs + 1e3 : void 0;
      if (!monthly && (cappedRemain <= 0 || expiresAtMs !== void 0 && expiresAtMs <= Date.now())) {
        continue;
      }
      total += cappedRemain;
      const expiryMs = expiresAtMs;
      if (expiryMs !== void 0) {
        if (nearestExpiryMs === void 0 || expiryMs < nearestExpiryMs) nearestExpiryMs = expiryMs;
        if (expiryMs - Date.now() <= SOON_MS) expiringSoon += cappedRemain;
      }
      packages.push({
        packageName: typeof account["PackageName"] === "string" ? account["PackageName"] : "(unnamed)",
        remain: cappedRemain,
        size,
        monthly,
        ...refreshAtMs === void 0 ? {} : { refreshAtMs },
        ...expiresAtMs === void 0 ? {} : { expiresAtMs }
      });
    }
    return {
      total,
      packages,
      expiringSoon,
      ...nearestExpiryMs === void 0 ? {} : { nearestExpiryMs }
    };
  }
};

// vendor/dsh-connect-workbuddy/auth.ts
var ENCRYPTED_CREDENTIAL_CODE = "WORKBUDDY_ENCRYPTED_CREDENTIAL";
var WorkBuddyEncryptedCredentialError = class extends Error {
  code = ENCRYPTED_CREDENTIAL_CODE;
  /** Files that hold an encrypted credential, for the user to recognize. */
  paths;
  constructor(paths) {
    const where = paths.length > 0 ? paths.join(", ") : "the credential file";
    super(
      `workbuddy: your WorkBuddy sign-in is present but encrypted, so it cannot be read (${where}). The WorkBuddy desktop app must be present to hand over its key; install it, or set ${WORKBUDDY_APP_EXECUTABLE_ENV} to its executable if it lives elsewhere. Signing in again will not change this.`
    );
    this.name = "WorkBuddyEncryptedCredentialError";
    this.paths = paths;
  }
};
var WORKBUDDY_AUTH_FILENAME = ".workbuddy-auth.json";
var WORKBUDDY_AUTH_FILE_ENV = "WORKBUDDY_AUTH_FILE";
var WORKBUDDY_LIVE_FILENAME = "workbuddy-desktop.info";
var WORKBUDDY_OWN_PREFIX = ".workbuddy-auth";
var WORKBUDDY_VAULT_DIRNAME = "workbuddy-vault";
var OWN_FORMAT_VERSION = 1;
function workbuddyOwnAuthPath(region) {
  return join3(resolveDshHome(), `${WORKBUDDY_OWN_PREFIX}.${region}.json`);
}
function legacyWorkbuddyOwnAuthPath() {
  return join3(resolveDshHome(), WORKBUDDY_AUTH_FILENAME);
}
function workbuddyVaultDir(region) {
  return join3(resolveDshHome(), WORKBUDDY_VAULT_DIRNAME, region);
}
function vaultDocument(credential, accountId, refreshedFrom) {
  return {
    version: VAULT_FORMAT_VERSION,
    accountId,
    refreshedAtMs: Date.now(),
    ...refreshedFrom === void 0 ? {} : { refreshedFrom: authFileName(refreshedFrom) },
    auth: {
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken,
      // 0 means "unknown": a zero expiry must not overwrite a known future
      // one, and `expiryToMs` maps 0 back to 0 on the read side.
      expiresAt: credential.expiresAtMs > 0 ? Math.floor(credential.expiresAtMs / 1e3) : 0,
      ...credential.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAt: Math.floor(credential.refreshExpiresAtMs / 1e3) },
      ...credential.lastRefreshAtMs === void 0 ? {} : { lastRefreshTime: Math.floor(credential.lastRefreshAtMs / 1e3) },
      domain: credential.domain
    },
    account: {
      uid: credential.uid,
      ...credential.enterpriseId === void 0 ? {} : { enterpriseId: credential.enterpriseId },
      ...credential.nickname === void 0 ? {} : { nickname: credential.nickname },
      ...credential.uin === void 0 ? {} : { uin: credential.uin }
    }
  };
}
function parseVaultDocument(text, filePath) {
  const parsed = parseVaultDocumentWithWriteTime(text, filePath);
  return parsed === void 0 ? void 0 : parsed.credential;
}
function parseVaultDocumentWithWriteTime(text, filePath) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
  const document = parsed;
  if (document["version"] !== VAULT_FORMAT_VERSION) return void 0;
  if (typeof document["auth"] !== "object" || document["auth"] === null) return void 0;
  const credential = parseWorkBuddyAuth(JSON.stringify({ auth: document["auth"], account: document["account"] }), filePath);
  if (credential === void 0) return void 0;
  const refreshedAtMs = typeof document["refreshedAtMs"] === "number" && document["refreshedAtMs"] > 0 ? document["refreshedAtMs"] : void 0;
  const refreshedFrom = typeof document["refreshedFrom"] === "string" && document["refreshedFrom"] !== "" ? document["refreshedFrom"] : void 0;
  return {
    credential: { ...credential, source: "dsh" },
    ...refreshedAtMs === void 0 ? {} : { refreshedAtMs },
    ...refreshedFrom === void 0 ? {} : { refreshedFrom }
  };
}
var VAULT_DISMISSED_FILENAME = ".dismissed.json";
var DISMISSED_FORMAT_VERSION = 1;
var DISMISSED_LIMIT = 1e3;
var SCAN_SHARE_WINDOW_MS = 1e3;
async function readDismissed(dir) {
  const dismissed = /* @__PURE__ */ new Set();
  try {
    const parsed = JSON.parse(await readFile(join3(dir, VAULT_DISMISSED_FILENAME), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return dismissed;
    const document = parsed;
    if (document["version"] !== DISMISSED_FORMAT_VERSION) return dismissed;
    const ids = document["accountIds"];
    if (!Array.isArray(ids)) return dismissed;
    for (const id of ids) {
      if (typeof id === "string" && VAULT_ACCOUNT_ID_RE.test(id)) dismissed.add(id);
    }
  } catch {
  }
  return dismissed;
}
async function writeDismissed(dir, dismissed) {
  const path = join3(dir, VAULT_DISMISSED_FILENAME);
  const ids = [...dismissed].slice(-DISMISSED_LIMIT);
  const document = { version: DISMISSED_FORMAT_VERSION, accountIds: ids };
  await withFileLock(path, async () => {
    await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}
`, { mode: 384, dirMode: 448 });
  });
}
function isVaultCredentialFileName(name) {
  if (!name.endsWith(".json")) return false;
  return VAULT_ACCOUNT_ID_RE.test(name.slice(0, -".json".length));
}
var VAULT_FORMAT_VERSION = 1;
function defaultDesktopAuthDirs(platform = process.platform, home = homedir3(), env = process.env) {
  if (platform === "darwin") {
    return [join3(home, "Library", "Application Support", "CodeBuddyExtension", "Data", "Public", "auth")];
  }
  if (platform === "win32") {
    const local = nonEmptyEnv(env["LOCALAPPDATA"]) ?? join3(home, "AppData", "Local");
    const roaming = nonEmptyEnv(env["APPDATA"]) ?? join3(home, "AppData", "Roaming");
    return [
      join3(local, "CodeBuddyExtension", "Data", "Public", "auth"),
      join3(roaming, "CodeBuddyExtension", "Data", "Public", "auth")
    ];
  }
  if (platform === "linux") {
    const config = nonEmptyEnv(env["XDG_CONFIG_HOME"]) ?? join3(home, ".config");
    return [join3(config, "CodeBuddyExtension", "Data", "Public", "auth")];
  }
  return [];
}
function nonEmptyEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function defaultDesktopAuthCandidates() {
  return defaultDesktopAuthDirs().map((dir) => join3(dir, WORKBUDDY_LIVE_FILENAME));
}
function expiryToMs(value) {
  if (value <= 0) return 0;
  return value > 1e12 ? value : value * 1e3;
}
function credentialField(value, key) {
  if (typeof value === "string") return value;
  if (!isEncryptedFieldWrapper(value)) return void 0;
  if (key === void 0) return void 0;
  return openEncryptedField(value, key);
}
function optionalCredentialField(value, key) {
  if (typeof value === "string") return value === "" ? void 0 : value;
  if (!isEncryptedFieldWrapper(value)) return void 0;
  if (key === void 0) return void 0;
  try {
    return openEncryptedField(value, key);
  } catch {
    return void 0;
  }
}
function parseWorkBuddyAuth(text, filePath, atRestKey) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
  const document = parsed;
  let auth;
  let identity;
  if (typeof document["auth"] === "object" && document["auth"] !== null) {
    auth = document["auth"];
    identity = typeof document["account"] === "object" && document["account"] !== null ? document["account"] : {};
  } else {
    auth = document;
    identity = document;
  }
  let accessToken;
  let refreshToken;
  try {
    accessToken = credentialField(auth["accessToken"], atRestKey);
    refreshToken = credentialField(auth["refreshToken"], atRestKey);
  } catch {
    return void 0;
  }
  if (accessToken === void 0 || accessToken === "") return void 0;
  const expiresAtMs = typeof auth["expiresAt"] === "number" ? expiryToMs(auth["expiresAt"]) : 0;
  const refreshExpiresAtMs = typeof auth["refreshExpiresAt"] === "number" ? expiryToMs(auth["refreshExpiresAt"]) : void 0;
  const lastRefreshAtMs = typeof auth["lastRefreshTime"] === "number" ? expiryToMs(auth["lastRefreshTime"]) : void 0;
  const enterpriseId = optionalCredentialField(identity["enterpriseId"], atRestKey);
  const nickname = optionalCredentialField(identity["nickname"], atRestKey);
  const uin = optionalCredentialField(identity["uin"], atRestKey);
  const credential = {
    accessToken,
    refreshToken: refreshToken ?? "",
    expiresAtMs,
    ...refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs },
    domain: optionalCredentialField(auth["domain"], atRestKey) ?? "",
    uid: optionalCredentialField(identity["uid"], atRestKey) ?? "",
    ...enterpriseId === void 0 ? {} : { enterpriseId },
    ...nickname === void 0 ? {} : { nickname },
    ...uin === void 0 ? {} : { uin },
    ...lastRefreshAtMs === void 0 ? {} : { lastRefreshAtMs },
    source: "desktop",
    filePath
  };
  return credential;
}
function hasEncryptedCredentialFields(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  const document = parsed;
  const auth = typeof document["auth"] === "object" && document["auth"] !== null ? document["auth"] : document;
  const identity = typeof document["account"] === "object" && document["account"] !== null ? document["account"] : document;
  return isEncryptedFieldWrapper(auth["accessToken"]) || isEncryptedFieldWrapper(auth["refreshToken"]) || isEncryptedFieldWrapper(identity["nickname"]) || isEncryptedFieldWrapper(identity["uin"]) || isEncryptedFieldWrapper(identity["uid"]) || isEncryptedFieldWrapper(identity["enterpriseId"]) || isEncryptedFieldWrapper(auth["domain"]);
}
function fileRank(path) {
  return authFileName(path) === WORKBUDDY_LIVE_FILENAME ? 0 : 1;
}
function isFresher(candidate, incumbent) {
  const rankDiff = fileRank(candidate.filePath) - fileRank(incumbent.filePath);
  if (rankDiff !== 0) return rankDiff < 0;
  const candidateRefresh = candidate.lastRefreshAtMs;
  const incumbentRefresh = incumbent.lastRefreshAtMs;
  if (candidateRefresh !== void 0 && incumbentRefresh !== void 0) {
    if (candidateRefresh !== incumbentRefresh) return candidateRefresh > incumbentRefresh;
  } else if (candidateRefresh !== void 0) {
    return true;
  } else if (incumbentRefresh !== void 0) {
    return false;
  }
  return candidate.expiresAtMs > incumbent.expiresAtMs;
}
function authFileName(path) {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator === -1 ? path : path.slice(separator + 1);
}
var VAULT_ACCOUNT_ID_RE = /^[0-9a-f]{24}$/;
function workbuddyAccountId(credential) {
  const stable = credential.uin ?? credential.uid ?? credential.nickname ?? "unknown";
  return createHash2("sha256").update(`workbuddy\0${stable}`).digest("hex").slice(0, 24);
}
function parseOwnDocument(text, filePath) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
  const document = parsed;
  if (document["version"] !== OWN_FORMAT_VERSION) return void 0;
  if (typeof document["credential"] !== "object" || document["credential"] === null) return void 0;
  const credential = parseWorkBuddyAuth(JSON.stringify({ auth: document["credential"] }), filePath);
  if (credential === void 0) return void 0;
  const runtime = document["credential"];
  const legacyExpiry = typeof runtime["expiresAtMs"] === "number" ? expiryToMs(runtime["expiresAtMs"]) : 0;
  return {
    ...credential,
    ...credential.expiresAtMs === 0 && legacyExpiry > 0 ? { expiresAtMs: legacyExpiry } : {},
    source: "dsh"
  };
}
function isENOENT(error) {
  return error?.code === "ENOENT";
}
function shouldReplaceVaultEntry(candidate, incumbent) {
  if (fileRank(candidate.filePath) !== 0) return false;
  const writeMs = incumbent.refreshedAtMs;
  if (writeMs === void 0) return true;
  const issuanceMs = candidate.lastRefreshAtMs;
  if (issuanceMs === void 0) return candidate.expiresAtMs > incumbent.credential.expiresAtMs;
  return issuanceMs > writeMs;
}
async function readVaultEntries(dir) {
  const entries = /* @__PURE__ */ new Map();
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isENOENT(error)) return entries;
    throw error;
  }
  for (const name of names) {
    if (!isVaultCredentialFileName(name)) continue;
    const path = join3(dir, name);
    try {
      const parsed = parseVaultDocumentWithWriteTime(await readFile(path, "utf8"), path);
      if (parsed === void 0) continue;
      const id = name.slice(0, -".json".length);
      if (workbuddyAccountId(parsed.credential) !== id) continue;
      entries.set(id, parsed);
    } catch {
    }
  }
  return entries;
}
async function writeVaultEntry(dir, accountId, credential, refreshedFrom) {
  const path = join3(dir, `${accountId}.json`);
  await withFileLock(path, async () => {
    await writeFileAtomic(path, `${JSON.stringify(vaultDocument(credential, accountId, refreshedFrom), null, 2)}
`, {
      mode: 384,
      dirMode: 448
    });
  });
}
async function probeAuthFile(path, resolveAtRestKey) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const missing = isENOENT(error);
    return {
      failure: {
        reason: missing ? "missing" : "unreadable",
        // An ENOENT message is the path spelled out again ("ENOENT: no such
        // file or directory, open '<path>'"), and the card already prints that
        // path on its own line — carrying it here rendered the same string
        // twice in a row. A genuine read error (EACCES, EISDIR) says something
        // the reason alone does not, so only that one is kept.
        ...missing ? {} : { message: error instanceof Error ? error.message : String(error) }
      }
    };
  }
  const plain = parseWorkBuddyAuth(text, path);
  if (plain !== void 0) return { credential: plain };
  const encrypted = hasEncryptedCredentialFields(text);
  if (!encrypted) {
    return isParseableJson(text) ? { failure: { reason: "invalid", message: "no access token in the document" } } : { failure: { reason: "invalid", message: "the file is not valid JSON" } };
  }
  let key;
  try {
    key = await resolveAtRestKey();
  } catch (error) {
    return {
      failure: {
        reason: "encrypted",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
  if (key === void 0) {
    return {
      failure: {
        reason: "encrypted",
        message: `the credential fields are encrypted and no key was available; the WorkBuddy desktop app must be present (or set ${WORKBUDDY_APP_EXECUTABLE_ENV})`
      }
    };
  }
  const decrypted = parseWorkBuddyAuth(text, path, key);
  return decrypted === void 0 ? { failure: { reason: "invalid", message: "the encrypted credential fields could not be opened with the desktop app's key" } } : { credential: decrypted };
}
function isParseableJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
async function readAuthFile(path, resolveAtRestKey) {
  const probe = await probeAuthFile(path, resolveAtRestKey);
  return "credential" in probe ? probe.credential : void 0;
}
var WorkBuddyCredentialStore = class {
  refresh;
  refreshMarginMs;
  region;
  ownPathExplicit;
  legacyOwnPath;
  legacyOwnPathExplicit;
  vaultDirExplicit;
  /** The vault directory, resolved ONCE at construction. */
  vaultDirResolved;
  authDirs;
  resolveAtRestKey;
  desktopPathOverride;
  accountId;
  inflight;
  /**
   * In-flight/completed scan for the CURRENT `readAll` generation.
   *
   * One page open calls `readAll` six times: the usage route asks for the
   * account list, the sign-in state and the resolved credential, then the
   * per-account credits panel asks once PER ACCOUNT (`credentialFor`), and both
   * region tabs poll on the same timer. Each call re-read every auth file,
   * re-parsed it, and re-ran the vault merge — measured at 6 `readdir` + (6N+12)
   * `readFile` for N accounts, i.e. the cost grew with the account count on a
   * path whose answer cannot change within one tick.
   *
   * This is deliberately NOT a time-based cache: a TTL would make the card show
   * a stale account list after an OAuth add or an import, which is the very
   * class of bug this card keeps chasing. Instead the promise is shared while it
   * is in flight, and every WRITE clears it (see `invalidateScan`) — so a read
   * after a write always scans again, and a read during a scan joins it.
   *
   * Undefined means "no scan in flight and nothing cached".
   */
  scanInflight;
  /** When the cached scan was STARTED, epoch ms; only meaningful with it set. */
  scanAtMs = 0;
  /**
   * A RUNTIME account override from the pool's rotation, or undefined.
   *
   * Deliberately separate from {@link accountId}, which is the user's persisted
   * choice. Rotation decides who serves *now*; it must never rewrite what the
   * user picked, or "turn rotation off" could not restore their selection and
   * the plugin would be unable to tell the two apart afterwards. Nothing here
   * is ever written to settings.
   */
  rotatedAccountId;
  constructor(options) {
    this.refresh = options.refresh;
    this.refreshMarginMs = options.refreshMarginMs ?? 5 * 60 * 1e3;
    this.region = options.region;
    this.ownPathExplicit = options.ownPath;
    this.legacyOwnPath = options.legacyOwnPath ?? legacyWorkbuddyOwnAuthPath();
    this.legacyOwnPathExplicit = options.legacyOwnPath;
    this.vaultDirExplicit = options.vaultDir;
    this.vaultDirResolved = options.vaultDir ?? (options.region !== void 0 ? workbuddyVaultDir(options.region) : join3(resolveDshHome(), WORKBUDDY_VAULT_DIRNAME));
    this.authDirs = options.authDirs;
    this.desktopPathOverride = options.desktopPath;
    this.resolveAtRestKey = options.resolveAtRestKey ?? readAtRestKey;
  }
  /** Whether a credential's login domain belongs to this store's region. */
  matchesRegion(domain) {
    return this.region === void 0 || regionOf(domain) === this.region;
  }
  /**
   * The path this store refreshes into: the per-region file for a
   * region-scoped store, the legacy single file otherwise, or an explicitly
   * injected path in tests.
   */
  ownAuthPath() {
    if (this.ownPathExplicit !== void 0) return this.ownPathExplicit;
    return this.region !== void 0 ? workbuddyOwnAuthPath(this.region) : this.legacyOwnPath;
  }
  /**
   * Every plugin-owned copy to read, most preferred first. A region-scoped
   * store reads the legacy single copy as its migration source (readAll's
   * region filter drops it when it carries the other region's credential); an
   * unscoped store reads everything so diagnostics see both regions.
   *
   * With an explicitly injected own path the legacy source is read ONLY when
   * it was injected too — a test that pins one file must not accidentally see
   * the real machine's legacy copy.
   */
  ownCandidates() {
    if (this.ownPathExplicit !== void 0) {
      return this.legacyOwnPathExplicit !== void 0 ? [this.ownPathExplicit, this.legacyOwnPathExplicit] : [this.ownPathExplicit];
    }
    if (this.region !== void 0) {
      return [workbuddyOwnAuthPath(this.region), this.legacyOwnPath];
    }
    return [this.legacyOwnPath, workbuddyOwnAuthPath("cn"), workbuddyOwnAuthPath("global")];
  }
  /** The vault directory this store reads and writes (fixed at construction). */
  vaultDir() {
    return this.vaultDirResolved;
  }
  /** Repoint the desktop file or directory; applies on the next read. */
  setDesktopPath(path) {
    this.desktopPathOverride = path;
    this.inflight = void 0;
    this.invalidateScan();
  }
  /**
   * Select an account by id; tokens stay outside settings.
   *
   * The empty string is the settings-level sentinel for "no explicit
   * selection" (the card's Clear action writes it), so it is normalized here
   * rather than being kept as an id that can never match an account. Every
   * caller therefore gets the documented default — follow the app's current
   * sign-in — instead of a dead selection.
   */
  selectAccount(accountId) {
    this.accountId = accountId === "" ? void 0 : accountId;
    this.inflight = void 0;
    this.invalidateScan();
  }
  /** Selected account id, for diagnostics and route assembly. */
  selectedAccountId() {
    return this.accountId;
  }
  /**
   * Whether the region runs a SAVED choice rather than the documented default.
   *
   * `false` means "follow the app's current sign-in", which is also what the
   * card's Clear action restores. The two states can resolve to the very same
   * account — an upgraded user whose pre-split `accountId` happens to be the
   * app's current sign-in clears the choice and sees no change at all — so the
   * card cannot infer this from the account list alone. It reports the state
   * here so clearing is observable instead of looking like a dead button.
   */
  hasExplicitSelection() {
    return this.accountId !== void 0;
  }
  /** The auth-file path candidates, in probe order. */
  resolveDesktopCandidates() {
    const fromEnv = process.env[WORKBUDDY_AUTH_FILE_ENV];
    const explicit = this.desktopPathOverride ?? (fromEnv !== void 0 && fromEnv.trim() !== "" ? fromEnv : void 0);
    if (explicit !== void 0) return [explicit];
    return defaultDesktopAuthCandidates();
  }
  /** The resolved desktop auth-file path, for diagnostics. */
  desktopAuthPath() {
    return this.resolveDesktopCandidates()[0];
  }
  /**
   * Every auth file to scan: the live file plus the timestamped backups
   * WorkBuddy leaves beside it.
   *
   * An explicitly configured path pins the *directory*: its siblings are
   * still scanned, because a user who points the plugin at their auth file
   * expects account switching to work the same way it does on the default
   * path. Only the file ordering changes.
   *
   * A corrupt or signed-out file must never hide the others, so each read is
   * independent and failures are skipped rather than propagated.
   */
  async candidateFiles() {
    const explicitPath = this.desktopPathOverride ?? ((process.env[WORKBUDDY_AUTH_FILE_ENV] ?? "").trim() !== "" ? process.env[WORKBUDDY_AUTH_FILE_ENV] : void 0);
    const files = [];
    if (explicitPath !== void 0) {
      files.push(explicitPath);
      for (const backup of await this.backupsBeside(explicitPath)) files.push(backup);
      return files;
    }
    const dirs = this.authDirs ?? defaultDesktopAuthDirs();
    for (const dir of dirs) {
      const live = join3(dir, WORKBUDDY_LIVE_FILENAME);
      files.push(live);
      for (const backup of await this.backupsBeside(live)) files.push(backup);
    }
    return files;
  }
  /** Timestamped siblings of one auth file, newest first by filename. */
  async backupsBeside(path) {
    const dir = dirname2(path);
    const base = path.slice(dir.length + 1);
    try {
      const entries = await readdir(dir);
      return entries.filter((name) => name !== base && name.endsWith(".info")).sort().reverse().map((name) => join3(dir, name));
    } catch {
      return [];
    }
  }
  /**
   * Read every local credential, deduplicated by account id. Files are
   * probed newest-first, so the first entry for an account is its freshest.
   *
   * A region-scoped store sees only its own region's credentials: the other
   * region's accounts are invisible to selection, refresh, and status alike,
   * which is what keeps the two regions' providers from cross-billing.
   */
  /**
   * The account list, sharing one scan across concurrent and repeated reads.
   *
   * See {@link scanInflight}: the whole performance fix lives in these four
   * lines. Every caller keeps its OWN semantics (`current`, `accounts`,
   * `status`, `selectionLost`), because this returns the same array they used
   * to build themselves — only the filesystem work is shared.
   *
   * A failed scan is NOT cached: the rejection clears the slot so the next read
   * retries, rather than pinning every later caller to one transient failure.
   */
  async readAll() {
    const now = Date.now();
    if (this.scanInflight !== void 0 && now - this.scanAtMs < SCAN_SHARE_WINDOW_MS) {
      return this.scanInflight;
    }
    this.scanAtMs = now;
    this.scanInflight = this.scanAll().catch((error) => {
      this.scanInflight = void 0;
      throw error;
    });
    return this.scanInflight;
  }
  /** Drop the shared scan so the next read re-reads the filesystem. */
  invalidateScan() {
    this.scanInflight = void 0;
    this.scanAtMs = 0;
  }
  /** The one real scan: read every candidate file, then merge the vault. */
  async scanAll() {
    const files = await this.candidateFiles();
    const dismissed = await readDismissed(this.vaultDir());
    const byId = /* @__PURE__ */ new Map();
    for (const file of files) {
      const credential = await readAuthFile(file, this.resolveAtRestKey);
      if (credential === void 0 || !this.matchesRegion(credential.domain)) continue;
      const id = workbuddyAccountId(credential);
      if (dismissed.has(id)) continue;
      const existing = byId.get(id);
      if (existing === void 0) {
        byId.set(id, credential);
        continue;
      }
      if (isFresher(credential, existing)) byId.set(id, credential);
    }
    for (const own of await this.readOwns()) {
      if (!this.matchesRegion(own.domain)) continue;
      const id = workbuddyAccountId(own);
      if (dismissed.has(id)) continue;
      const existing = byId.get(id);
      if (existing === void 0) {
        byId.set(id, own);
      } else if (fileRank(existing.filePath) !== 0 && own.expiresAtMs > existing.expiresAtMs) {
        byId.set(id, own);
      }
    }
    await this.syncVault(byId, dismissed);
    return Object.freeze([...byId.values()]);
  }
  /**
   * Merge the scan's credentials into the vault and read the vault back.
   *
   * Incremental by contract: a scan that finds nothing new writes nothing.
   * Per account, the vault entry is written only when the scan's read is
   * fresher by {@link isFresherVaultEntry} — so a steady-state scan is
   * mtime-stable and every sync is O(accounts) reads with at most one write
   * per CHANGED account.
   */
  async syncVault(scan, dismissed) {
    const dir = this.vaultDir();
    let entries;
    try {
      entries = await readVaultEntries(dir);
    } catch {
      return;
    }
    let dirReady = false;
    for (const [id, credential] of scan) {
      if (dismissed.has(id)) continue;
      const incumbent = entries.get(id);
      if (incumbent !== void 0 && !shouldReplaceVaultEntry(credential, incumbent)) continue;
      if (!dirReady) {
        try {
          await mkdir2(dir, { recursive: true });
          dirReady = true;
        } catch {
          return;
        }
      }
      await writeVaultEntry(dir, id, credential);
      entries.set(id, { credential: { ...credential, source: "dsh" }, refreshedAtMs: Date.now() });
    }
    for (const [id, entry] of entries) {
      if (!this.matchesRegion(entry.credential.domain)) continue;
      const existing = scan.get(id);
      if (dismissed.has(id)) continue;
      if (existing === void 0) {
        scan.set(id, entry.credential);
      } else if (entry.refreshedFrom !== void 0 && entry.refreshedFrom === authFileName(existing.filePath)) {
        scan.set(id, entry.credential);
      } else if (fileRank(existing.filePath) !== 0 && entry.credential.expiresAtMs > existing.expiresAtMs) {
        scan.set(id, entry.credential);
      }
    }
  }
  /**
   * Default when no account is explicitly selected: the live sign-in, else the
   * freshest credential. Following the app's current sign-in is the documented
   * default behaviour; the backups exist so the user can switch explicitly.
   * This is NOT credit-seeking — it never reorders accounts to find one with
   * remaining credit.
   */
  preferred(credentials) {
    if (credentials.length === 0) return void 0;
    return credentials.reduce((best, credential) => isFresher(credential, best) ? credential : best);
  }
  /**
   * Token-free account list for the plugin card.
   *
   * `selected` answers one question only: which row is the account the plugin
   * is actually going to use? That is exactly what {@link current} decides, so
   * the two must never disagree — the card renders this list while the shim
   * bills through `current()`, and a row marked "selected" that `current()`
   * refuses to use is what made the dropdown look healthy while every request
   * failed with 401.
   *
   * So an explicit selection that matches NO local account marks nothing as
   * selected (no silent fallback to a different account — see {@link current}).
   * The implicit default is marked only when nothing was explicitly chosen.
   */
  async accounts() {
    const credentials = await this.readAll();
    if (credentials.length === 0) return [];
    const hasExplicitSelection = this.accountId !== void 0;
    const selectedExists = hasExplicitSelection && credentials.some((credential) => workbuddyAccountId(credential) === this.accountId);
    const defaultSelected = this.preferred(credentials);
    return credentials.map((credential) => {
      const id = workbuddyAccountId(credential);
      return {
        id,
        // The human name, or '' when the app did not give one. Deliberately NO
        // fallback to `uin`/`uid`: those are opaque identifiers, and showing one
        // as a "name" put a bare number in front of the user where a name
        // belonged. Presentation layers render their own placeholder for ''.
        accountName: credential.nickname ?? "",
        domain: credential.domain,
        source: credential.source,
        tokenExpiresAtMs: credential.expiresAtMs,
        filePath: credential.filePath,
        selected: selectedExists ? id === this.accountId : !hasExplicitSelection && credential === defaultSelected
      };
    });
  }
  /**
   * Whether a persisted selection exists that matches no local account, while
   * other local sign-ins ARE available to choose from.
   *
   * The card uses this to explain the state honestly (the account is signed in,
   * but the SAVED choice is gone) instead of showing the generic "sign in
   * again" hint, which misdirects: the token is usually perfectly healthy and
   * signing in again does not repair an orphaned id. When no local sign-in is
   * available at all, that hint IS accurate and this returns false.
   */
  async selectionLost() {
    if (this.accountId === void 0) return false;
    const credentials = await this.readAll();
    if (credentials.length === 0) return false;
    return !credentials.some((credential) => workbuddyAccountId(credential) === this.accountId);
  }
  /** The freshest stored credential for the current selection, no refresh. */
  async current() {
    const credentials = await this.readAll();
    if (this.rotatedAccountId !== void 0) {
      const rotated = credentials.find(
        (credential) => workbuddyAccountId(credential) === this.rotatedAccountId
      );
      if (rotated !== void 0) return rotated;
    }
    if (this.accountId === void 0) return this.preferred(credentials);
    return credentials.find((credential) => workbuddyAccountId(credential) === this.accountId);
  }
  /**
   * Set (or clear) the pool's RUNTIME account override.
   *
   * Never persists and never touches {@link accountId}: the user's saved choice
   * is what `clear` restores, which is the whole reason this lives in its own
   * field. Rotation is off when this is called with `undefined`.
   */
  setRotatedAccount(accountId) {
    this.rotatedAccountId = accountId;
  }
  /** The account the pool is currently rotating to, if any. */
  rotatedAccount() {
    return this.rotatedAccountId;
  }
  /**
   * One account's stored credential by id, WITHOUT consulting or changing the
   * current selection.
   *
   * Exists so a recovery probe can test whether some OTHER local account is
   * still accepted upstream while a rejected one stays selected: mutating the
   * live selection to find that out would be exactly the silent account switch
   * this store refuses to perform (it would bill the wrong account mid-probe).
   */
  async credentialFor(accountId) {
    const credentials = await this.readAll();
    return credentials.find((credential) => workbuddyAccountId(credential) === accountId);
  }
  /** The credential to send upstream: {@link current}, refreshed on demand. */
  async resolve() {
    const credential = await this.current();
    if (credential === void 0) {
      throw await this.describeMissingCredential();
    }
    if (!this.needsRefresh(credential)) return credential;
    this.inflight ??= this.refreshNow(credential).finally(() => {
      this.inflight = void 0;
    });
    return this.inflight;
  }
  /**
   * WHY no credential resolved, as the error to throw.
   *
   * `resolve()` seeing zero accounts has two very different causes, and the
   * generic "sign in once" message is only correct for one of them. When a
   * probe finds a credential file whose fields are encrypted and the key could
   * not be obtained, the user is signed in and re-authenticating cannot help —
   * so that case gets {@link WorkBuddyEncryptedCredentialError} instead, naming
   * the file and the environment variable that actually fixes it.
   *
   * The probe is only run on the failure path, so the healthy case pays nothing.
   * A probe that itself throws must not replace the real error, hence the
   * fallback to the generic message.
   */
  async describeMissingCredential() {
    let failures = [];
    try {
      failures = (await this.diagnose()).failures;
    } catch {
    }
    const encrypted = failures.filter((failure) => failure.reason === "encrypted").map((failure) => failure.path);
    if (encrypted.length > 0) return new WorkBuddyEncryptedCredentialError(encrypted);
    const candidates = this.resolveDesktopCandidates();
    const desktop = candidates.length > 0 ? candidates.join(" or ") : "(no desktop path on this platform)";
    return new Error(
      `workbuddy: no signed-in WorkBuddy account found; sign in once in the WorkBuddy desktop app (expected ${desktop} or ${WORKBUDDY_AUTH_FILE_ENV}), or refresh an existing session`
    );
  }
  /** Read-only sign-in summary; never refreshes and never throws. */
  async status() {
    try {
      const credential = await this.current();
      if (credential === void 0) return { state: "signed-out" };
      return {
        state: "signed-in",
        expiresAtMs: credential.expiresAtMs,
        ...credential.refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs: credential.refreshExpiresAtMs },
        ...credential.nickname === void 0 ? {} : { nickname: credential.nickname },
        ...credential.domain === "" ? {} : { domain: credential.domain },
        source: credential.source
      };
    } catch {
      return { state: "signed-out" };
    }
  }
  /**
   * Persist one OAuth sign-in into the unified vault.
   *
   * The credential is written with `source: 'dsh'` (it never came from a
   * desktop file) and joins the readable set on the next scan — the vault is
   * read by `readAll()` like any other source, so no separate discovery path
   * exists. The write is idempotent per account id: re-adding an account
   * replaces its entry, which is exactly what re-issuing a login means.
   *
   * Returns the account id so the card can offer to select it right away.
   */
  async addOAuthAccount(credential) {
    const id = workbuddyAccountId(credential);
    const dir = this.vaultDir();
    await mkdir2(dir, { recursive: true });
    await writeVaultEntry(dir, id, {
      ...credential,
      source: "dsh",
      filePath: join3(dir, `${id}.json`)
    });
    await this.forgetDismissal(dir, id);
    this.inflight = void 0;
    this.invalidateScan();
    return id;
  }
  /**
   * Drop one id from the dismissal list, if present.
   *
   * Silent by design: called on the ADD paths, where a list that cannot be
   * updated must not fail the action the user asked for. The consequence is the
   * same as before the fix — the account stays hidden until the list is
   * repaired — while throwing here would report a failed sign-in that succeeded.
   */
  async forgetDismissal(dir, accountId) {
    try {
      const dismissed = await readDismissed(dir);
      if (!dismissed.has(accountId)) return;
      dismissed.delete(accountId);
      await writeDismissed(dir, dismissed);
    } catch {
    }
  }
  /**
   * Forget EVERY dismissal, so the next read lists the accounts again.
   *
   * Called by the manual 「re-scan」 action. Dismissal is "hide until I ask to
   * scan again", and this is that ask: the user is requesting what the machine
   * currently has, which includes accounts they hid earlier. Leaving the list
   * intact would make a removed desktop account unrecoverable from the UI — the
   * opposite of what the button promises.
   *
   * PREFERS deleting the file over writing an empty list: an absent file is the
   * normal state and keeps the vault directory free of a file that says nothing.
   * The unlink is not the only way, though, because on Windows removing a file
   * another process holds open fails with `EPERM`/`EBUSY`/`EACCES` — an antivirus
   * scanner, OneDrive, or an editor with it open, the same contention the card's
   * `isFileContentionWriteError` classifies for profile writes and the reason
   * `docs/WINDOWS.md` keeps a register. POSIX unlinks open files happily, so
   * without this the promise 「点重新检测账号即可找回」 would be false, silently,
   * on exactly the platform it matters most on.
   *
   * So the unlink falls back to OVERWRITING the list with an empty one through
   * the same locked atomic write `writeDismissed` uses. For every reader the two
   * outcomes are identical (`readDismissed` yields no ids either way), so the
   * user's ask is honoured even when the file itself cannot be removed.
   *
   * Returns whether the dismissals are now genuinely gone, VERIFIED by reading
   * the list back rather than by trusting the write: the caller renders this, so
   * "it worked" has to mean it. A `false` is the honest answer for a vault that
   * could neither be unlinked nor rewritten, and the rescan still runs — the
   * accounts simply stay hidden, which the UI can now say out loud instead of
   * showing a button that appears to have done nothing.
   */
  async clearDismissals() {
    this.inflight = void 0;
    this.invalidateScan();
    const dir = this.vaultDir();
    const path = join3(dir, VAULT_DISMISSED_FILENAME);
    try {
      await rm2(path, { force: true });
    } catch {
      try {
        await writeDismissed(dir, /* @__PURE__ */ new Set());
      } catch {
        return (await readDismissed(dir)).size === 0;
      }
    }
    return (await readDismissed(dir)).size === 0;
  }
  /**
   * Remove ONE account from this region's list, by id.
   *
   * The account is DISMISSED, not merely deleted. Deleting the vault entry alone
   * was undone by the next scan: `syncVault` writes every desktop sign-in it
   * finds back into the vault (that is how a desktop account becomes selectable)
   * and `readAll` merges the vault in afterwards, so a removed desktop account
   * returned on the very next read while `removeAccount` had reported `true`.
   * Measured before the fix: remove → `true`, then `accounts()` still lists it.
   *
   * The desktop app's auth files stay read-only: dismissing hides the account
   * from this plugin without signing the app out, and that is exactly what the
   * card says. Re-adding it (a fresh OAuth sign-in or an import) clears the
   * dismissal, so the account is not lost to a future login.
   *
   * Returns whether a stored vault entry was also removed, so the caller can
   * still tell "removed" from "only a desktop sign-in" — the dismissal happens
   * either way, because only the user gets to decide an account is dismissed.
   */
  async removeAccount(accountId) {
    if (!VAULT_ACCOUNT_ID_RE.test(accountId)) {
      throw new Error(`workbuddy: refusing to remove '${accountId}': not a vault account id`);
    }
    const path = join3(this.vaultDir(), `${accountId}.json`);
    const removed = await withFileLock(path, async () => {
      let existed = true;
      try {
        await rm2(path, { force: false });
      } catch (error) {
        if (!isENOENT(error)) throw error;
        existed = false;
      }
      await rm2(`${path}.lock`, { force: false }).catch(() => {
      });
      return existed;
    });
    if (this.rotatedAccountId === accountId) this.rotatedAccountId = void 0;
    if (this.accountId === accountId) {
      this.accountId = void 0;
    }
    const dir = this.vaultDir();
    try {
      await mkdir2(dir, { recursive: true });
      const dismissed = await readDismissed(dir);
      if (!dismissed.has(accountId)) {
        dismissed.add(accountId);
        await writeDismissed(dir, dismissed);
      }
    } catch {
    }
    this.inflight = void 0;
    this.invalidateScan();
    return removed;
  }
  /**
   * Remove every plugin-owned copy this store could read (per-region file,
   * legacy single file, and their lock siblings); the desktop files are
   * untouched. A region store's logout therefore also clears the legacy
   * migration source — deliberate: `logout` is the user's "forget what the
   * plugin stored" action, not a per-account toggle.
   */
  async logout() {
    for (const path of this.ownCandidates()) {
      await rm2(path, { force: true });
      await rm2(`${path}.lock`, { force: true });
    }
    await rm2(this.vaultDir(), { recursive: true, force: true });
    this.invalidateScan();
  }
  needsRefresh(credential) {
    if (credential.expiresAtMs <= 0) return true;
    return Date.now() + this.refreshMarginMs >= credential.expiresAtMs;
  }
  async refreshNow(credential) {
    if (credential.refreshToken === "") {
      if (credential.expiresAtMs > Date.now() + 3e4) return credential;
      throw new Error("workbuddy: access token expired and no refresh token is stored; sign in again in the WorkBuddy desktop app");
    }
    try {
      const outcome = await this.refresh(credential);
      const refreshed = {
        ...credential,
        accessToken: outcome.accessToken,
        ...outcome.refreshToken === void 0 ? {} : { refreshToken: outcome.refreshToken },
        expiresAtMs: outcome.expiresInSec !== void 0 ? Date.now() + outcome.expiresInSec * 1e3 : credential.expiresAtMs,
        ...outcome.domain === void 0 || outcome.domain === "" ? {} : { domain: outcome.domain },
        source: "dsh"
      };
      this.invalidateScan();
      await writeVaultEntry(
        this.vaultDir(),
        workbuddyAccountId(credential),
        refreshed,
        credential.filePath
      ).catch(() => {
      });
      return refreshed;
    } catch (error) {
      if (credential.expiresAtMs > Date.now() + 3e4) return credential;
      throw new Error(
        `workbuddy: token refresh failed and the access token is expired (${String(error)}); open the WorkBuddy desktop app once to sign in again`
      );
    }
  }
  /**
   * Every readable plugin-owned copy, in candidate order; absent or corrupt
   * files are skipped rather than propagated.
   */
  async readOwns() {
    const copies = [];
    for (const path of this.ownCandidates()) {
      try {
        const parsed = parseOwnDocument(await readFile(path, "utf8"), path);
        if (parsed !== void 0) copies.push(parsed);
      } catch {
      }
    }
    return copies;
  }
  /** Whether any candidate file exists as a regular file; diagnostics only. */
  async desktopFilePresent() {
    for (const path of this.resolveDesktopCandidates()) {
      try {
        if ((await stat(path)).isFile()) return true;
      } catch {
      }
    }
    return false;
  }
  /**
   * Which paths were probed and why each one yielded no credential.
   *
   * Read-only and token-free: it exists so a signed-out card can explain
   * itself. A bare "not signed in" is undiagnosable on a machine whose layout
   * differs from the ones this plugin was written against — and on Windows it
   * is actively misleading, because encrypted token fields need the desktop app
   * present to be read at all. Only paths this store actually consults are
   * reported, and only files that failed: one healthy sibling would make the
   * whole list noise.
   */
  async diagnose() {
    const candidates = [];
    for (const path of await this.candidateFiles()) {
      const probe = await probeAuthFile(path, this.resolveAtRestKey);
      if ("credential" in probe) {
        if (!this.matchesRegion(probe.credential.domain)) {
          candidates.push({
            path,
            source: "desktop",
            reason: "wrong-region",
            message: `holds a ${regionOf(probe.credential.domain)} sign-in, but this tab reads the ${this.region} region`
          });
        }
        continue;
      }
      candidates.push({ path, source: "desktop", ...probe.failure });
    }
    for (const path of this.ownCandidates()) {
      let text;
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        if (isENOENT(error)) continue;
        candidates.push({
          path,
          source: "dsh",
          reason: "unreadable",
          message: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
      const parsed = parseOwnDocument(text, path);
      if (parsed === void 0 || !this.matchesRegion(parsed.domain)) {
        candidates.push({ path, source: "dsh", reason: "invalid", message: "not a readable plugin-owned credential" });
        continue;
      }
      continue;
    }
    const tried = [...await this.candidateFiles(), ...this.ownCandidates()];
    try {
      const names = await readdir(this.vaultDir());
      for (const name of names.filter(isVaultCredentialFileName)) {
        const path = join3(this.vaultDir(), name);
        tried.push(path);
        let text;
        try {
          text = await readFile(path, "utf8");
        } catch (error) {
          if (!isENOENT(error)) {
            candidates.push({
              path,
              source: "dsh",
              reason: "unreadable",
              message: error instanceof Error ? error.message : String(error)
            });
          }
          continue;
        }
        const parsed = parseVaultDocument(text, path);
        if (parsed === void 0) {
          candidates.push({ path, source: "dsh", reason: "invalid", message: "not a readable vault credential" });
        }
      }
    } catch {
    }
    return { tried, failures: candidates };
  }
};

// vendor/dsh-connect-workbuddy/dsml-recovery.ts
import { randomUUID } from "node:crypto";
var FULLWIDTH_BAR = "\uFF5C";
var MARKUP_TOKEN = `${FULLWIDTH_BAR}${FULLWIDTH_BAR}DSML${FULLWIDTH_BAR}${FULLWIDTH_BAR}`;
var BARS = `${FULLWIDTH_BAR}${FULLWIDTH_BAR}?`;
var MARKUP_RE = new RegExp(`${BARS}DSML${BARS}`, "g");
var MARKUP_PREFIXES = [
  `${FULLWIDTH_BAR}${FULLWIDTH_BAR}DSML${FULLWIDTH_BAR}${FULLWIDTH_BAR}`,
  "||DSML||",
  "|DSML|"
];
var ASCII_PREFIXES = ["||DSML||", "|DSML|"];
var BLOCK_TAGS = ["tool_calls", "invoke"];
var KEYWORD_TAGS = ["tool_calls", "tool-calls", "toolcalls", "invoke", "parameter", "calls", "tool"];
var CANONICAL_TAG_NAMES = /* @__PURE__ */ new Map([
  ["tool_calls", "tool_calls"],
  ["tool-calls", "tool_calls"],
  ["toolcalls", "tool_calls"],
  ["invoke", "invoke"],
  ["parameter", "parameter"]
]);
var MARKER_ONLY_TAG_NAMES = /* @__PURE__ */ new Set(["tool-calls", "toolcalls"]);
var FENCE_MARKERS = ["```", "~~~"];
function ignoredSpans(text) {
  const spans = [];
  let i = 0;
  let fence;
  let fenceStart = 0;
  while (i < text.length) {
    const atLineStart = i === 0 || text.charAt(i - 1) === "\n";
    if (fence !== void 0) {
      if (atLineStart && text.startsWith(fence, i)) {
        const lineEnd = text.indexOf("\n", i);
        const end = lineEnd === -1 ? text.length : lineEnd + 1;
        spans.push({ start: fenceStart, end, open: false });
        fence = void 0;
        i = end;
        continue;
      }
      i += 1;
      continue;
    }
    if (atLineStart) {
      const marker = FENCE_MARKERS.find((candidate) => text.startsWith(candidate, i));
      if (marker !== void 0) {
        fence = marker;
        fenceStart = i;
        i += marker.length;
        continue;
      }
    }
    if (text.charAt(i) === "`") {
      const end = codeSpanEnd(text, i);
      if (end === -1) {
        spans.push({ start: i, end: text.length, open: true });
        break;
      }
      spans.push({ start: i, end, open: false });
      i = end;
      continue;
    }
    const xml = xmlIgnoredEnd(text, i);
    if (xml !== void 0) {
      spans.push(xml);
      if (xml.end >= text.length && xml.open) break;
      i = xml.end;
      continue;
    }
    i += 1;
  }
  if (fence !== void 0) spans.push({ start: fenceStart, end: text.length, open: true });
  return spans;
}
function codeSpanEnd(text, start) {
  let ticks = 0;
  let i = start;
  while (i < text.length && text.charAt(i) === "`") {
    ticks += 1;
    i += 1;
  }
  if (ticks === 0 || ticks >= 3) return -1;
  let end = i;
  while (end < text.length) {
    if (text.charAt(end) !== "`") {
      end += 1;
      continue;
    }
    let closingTicks = 0;
    let j = end;
    while (j < text.length && text.charAt(j) === "`") {
      closingTicks += 1;
      j += 1;
    }
    if (closingTicks === ticks) return j;
    end = j;
  }
  return -1;
}
function xmlIgnoredEnd(text, index) {
  const forms = [
    ["<![CDATA[", "]]>"],
    ["<!--", "-->"],
    ["<?", "?>"]
  ];
  for (const [open, close] of forms) {
    if (!text.startsWith(open, index)) continue;
    const found = text.indexOf(close, index + open.length);
    if (found === -1) return { start: index, end: text.length, open: true };
    return { start: index, end: found + close.length, open: false };
  }
  return void 0;
}
function skipIgnored(spans, index, cursor) {
  while (cursor.at < spans.length) {
    const span = spans[cursor.at];
    if (span === void 0 || index < span.start) return index;
    if (index < span.end) return span.end;
    cursor.at += 1;
  }
  return index;
}
function prefixLengthAt(text, index) {
  for (const prefix of MARKUP_PREFIXES) {
    if (text.startsWith(prefix, index)) return prefix.length;
  }
  const normalized = normalizeFullwidth(text.slice(index, index + 8));
  for (const prefix of ASCII_PREFIXES) {
    if (normalized.startsWith(prefix)) return prefix.length;
  }
  return 0;
}
function isNameCharacter(text, index) {
  return /[\p{L}\p{N}_-]/u.test(text.charAt(index));
}
function readName(text, index) {
  const prefixLength = prefixLengthAt(text, index);
  const marked = prefixLength > 0;
  let position = index + prefixLength;
  while (position < text.length && /\s/.test(text.charAt(position))) position += 1;
  const start = position;
  while (position < text.length && isNameCharacter(text, position)) position += 1;
  if (position === start) return { name: "", end: index, marked };
  return { name: text.slice(start, position).toLowerCase(), end: position, marked };
}
function scanTag(text, index) {
  if (text.charAt(index) !== "<") return void 0;
  let position = index + 1;
  let closing = false;
  if (text.charAt(position) === "/") {
    closing = true;
    position += 1;
  }
  while (position < text.length && /\s/.test(text.charAt(position))) position += 1;
  const read = readName(text, position);
  if (read.name === "") return void 0;
  const canonical = CANONICAL_TAG_NAMES.get(read.name);
  const name = canonical !== void 0 && !(MARKER_ONLY_TAG_NAMES.has(read.name) && !read.marked) ? canonical : read.name;
  const attributesStart = read.end;
  let selfClosing = false;
  let cursor = read.end;
  while (cursor < text.length) {
    const character = text.charAt(cursor);
    if (character === ">") {
      return {
        start: index,
        end: cursor,
        name,
        closing,
        selfClosing,
        marked: read.marked,
        attributes: text.slice(attributesStart, cursor).trim()
      };
    }
    if (character === "/" && text.charAt(cursor + 1) === ">") {
      selfClosing = true;
      return {
        start: index,
        end: cursor + 1,
        name,
        closing,
        selfClosing,
        marked: read.marked,
        attributes: text.slice(attributesStart, cursor).trim()
      };
    }
    cursor += 1;
  }
  return void 0;
}
function findTag(text, spans, from) {
  const cursor = { at: 0 };
  let index = Math.max(from, 0);
  while (index < text.length) {
    const skipped = skipIgnored(spans, index, cursor);
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    if (text.charAt(index) === "<") {
      const tag = scanTag(text, index);
      if (tag !== void 0) return tag;
    }
    index += 1;
  }
  return void 0;
}
function findMatchingClose(text, spans, open) {
  let depth = 1;
  let index = open.end + 1;
  while (index < text.length) {
    const tag = findTag(text, spans, index);
    if (tag === void 0) return void 0;
    if (tag.name === open.name) {
      if (tag.closing) {
        depth -= 1;
        if (depth === 0) return tag;
      } else if (!tag.selfClosing) {
        depth += 1;
      }
    }
    index = tag.end + 1;
  }
  return void 0;
}
function findFirstOpener(text, spans) {
  let index = 0;
  while (index < text.length) {
    const tag = findTag(text, spans, index);
    if (tag === void 0) return void 0;
    if (!tag.closing && BLOCK_TAGS.includes(tag.name)) {
      const close = findMatchingClose(text, spans, tag);
      return close === void 0 ? { open: tag } : { open: tag, close };
    }
    index = tag.end + 1;
  }
  return void 0;
}
function decodeEntities(text) {
  if (!text.includes("&")) return text;
  const named = /* @__PURE__ */ new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"]
  ]);
  return text.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body.startsWith("#")) {
      const hex = body.charAt(1).toLowerCase() === "x";
      const digits = hex ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 1114111) return whole;
      return String.fromCodePoint(code);
    }
    return named.get(body.toLowerCase()) ?? whole;
  });
}
function parseAttributes(text) {
  const attributes = {};
  const pattern = /([a-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match = pattern.exec(text);
  while (match !== null) {
    const key = match[1];
    const value = match[2] ?? match[3];
    if (key !== void 0 && value !== void 0) attributes[key] = decodeEntities(value);
    match = pattern.exec(text);
  }
  return attributes;
}
function parseParameters(body) {
  const parameters = {};
  const spans = ignoredSpans(body);
  let index = 0;
  while (index < body.length) {
    const tag = findTag(body, spans, index);
    if (tag === void 0) break;
    if (tag.closing || tag.selfClosing) {
      index = tag.end + 1;
      continue;
    }
    const close = findMatchingClose(body, spans, tag);
    if (close === void 0) {
      index = tag.end + 1;
      continue;
    }
    const value = body.slice(tag.end + 1, close.start).trim();
    const attributes = parseAttributes(tag.attributes);
    const explicitName = tag.name === "parameter" ? attributes["name"] : void 0;
    const name = explicitName ?? tag.name;
    if (name !== void 0 && name !== "" && (explicitName !== void 0 || parameters[name] === void 0)) {
      parameters[name] = value.startsWith("<![CDATA[") && value.endsWith("]]>") ? value.slice(9, -3) : nestedOrText(value);
    }
    index = close.end + 1;
  }
  return parameters;
}
function nestedOrText(value) {
  if (!value.includes("<") || !value.includes(">")) return decodeEntities(value);
  const nested = parseParameters(value);
  return Object.keys(nested).length > 0 ? nested : decodeEntities(value);
}
function parseBlock(block, gate) {
  const calls = [];
  const spans = ignoredSpans(block);
  let index = 0;
  while (index < block.length) {
    const tag = findTag(block, spans, index);
    if (tag === void 0) break;
    if (!tag.closing && tag.name === "invoke") {
      const close = findMatchingClose(block, spans, tag);
      if (close === void 0) break;
      const call = parseInvoke(tag, close, block, gate);
      if (call !== void 0) calls.push(call);
      index = close.end + 1;
      continue;
    }
    index = tag.end + 1;
  }
  return calls;
}
function parseInvoke(open, close, block, gate) {
  const attributes = parseAttributes(open.attributes);
  const name = attributes["name"];
  if (name === void 0 || name === "") return void 0;
  if (!gate.declaredNames.has(name)) return void 0;
  const pinned = gate.pinnedToolName;
  if (pinned !== void 0 && pinned !== "auto" && pinned !== "required" && pinned !== "none" && pinned !== name) {
    return void 0;
  }
  const parameters = parseParameters(block.slice(open.end + 1, close.start));
  const required = gate.requiredParameters?.get(name);
  if (required !== void 0 && required.some((parameter) => parameters[parameter] === void 0)) return void 0;
  return {
    id: `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    name,
    arguments: JSON.stringify(parameters)
  };
}
function stripMarkup(text) {
  const spans = ignoredSpans(text);
  const cursor = { at: 0 };
  let result = "";
  let index = 0;
  while (index < text.length) {
    const skipped = skipIgnored(spans, index, cursor);
    if (skipped !== index) {
      result += text.slice(index, skipped);
      index = skipped;
      continue;
    }
    const tag = text.charAt(index) === "<" ? scanTag(text, index) : void 0;
    if (tag === void 0 || !tag.marked) {
      result += text.charAt(index);
      index += 1;
      continue;
    }
    const bracketed = !tag.closing && !tag.selfClosing && KEYWORD_TAGS.includes(tag.name);
    const close = bracketed ? findMatchingClose(text, spans, tag) : void 0;
    index = close === void 0 ? tag.end + 1 : close.end + 1;
  }
  return result;
}
function hasProse(text) {
  return stripMarkup(text).trim() !== "";
}
function holdFrom(text, spans) {
  let hold = text.length;
  const lastLt = text.lastIndexOf("<");
  if (lastLt !== -1 && looksLikeTagStart(text.slice(lastLt))) hold = Math.min(hold, lastLt);
  for (const span of spans) {
    if (span.open) hold = Math.min(hold, span.start);
  }
  return hold;
}
function looksLikeTagStart(tail) {
  if (!tail.startsWith("<")) return false;
  if (tail.includes(">")) return false;
  let body = tail.slice(1);
  if (body.startsWith("/")) body = body.slice(1);
  if (body === "" || isPartialMarker(body)) return true;
  const prefixLength = prefixLengthAt(body, 0);
  body = body.slice(prefixLength).trim().toLowerCase();
  if (body === "" || isPartialMarker(body)) return true;
  const openers = ["tool", "invoke", "tool_calls", "tool-calls", "toolcalls", "tool_call", "tool-call"];
  return openers.some((opener) => opener.startsWith(body) || body.startsWith(opener));
}
function isPartialMarker(body) {
  const trimmed = body.trimStart();
  if (trimmed === "") return true;
  const forms = [...MARKUP_PREFIXES, ...ASCII_PREFIXES];
  const candidates = [trimmed, normalizeFullwidth(trimmed.slice(0, 8))];
  return candidates.some((candidate) => candidate !== "" && forms.some((form) => form.startsWith(candidate) && candidate.length < form.length));
}
function normalizeFullwidth(text) {
  let normalized = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    normalized += code >= 65281 && code <= 65374 ? String.fromCodePoint(code - 65248) : character;
  }
  return normalized;
}
var DsmlStreamBuffer = class {
  pending = "";
  gate;
  constructor(gate) {
    this.gate = gate;
  }
  /** Feed one `delta.content` chunk; returns text and any call it completed. */
  add(chunk) {
    this.pending += chunk;
    const parts = [];
    const calls = [];
    if (this.gate.declaredNames.size === 0) {
      const text = this.pending;
      this.pending = "";
      return { text, prose: hasProse(text) };
    }
    for (; ; ) {
      const found = findFirstOpener(this.pending, ignoredSpans(this.pending));
      if (found === void 0) break;
      const head = this.pending.slice(0, found.open.start);
      if (head !== "") parts.push(head);
      if (found.close === void 0) {
        this.pending = this.pending.slice(found.open.start);
        return finish(parts, calls);
      }
      const body = this.pending.slice(found.open.start, found.close.end + 1);
      const recovered = parseBlock(body, this.gate);
      if (recovered.length > 0) calls.push(...recovered);
      else parts.push(body);
      this.pending = this.pending.slice(found.close.end + 1);
    }
    const hold = holdFrom(this.pending, ignoredSpans(this.pending));
    if (hold > 0) parts.push(this.pending.slice(0, hold));
    this.pending = this.pending.slice(hold);
    return finish(parts, calls);
  }
  /** End of stream: hand back everything still held, verbatim. */
  flush() {
    const text = this.pending;
    this.pending = "";
    return { text, prose: hasProse(text) };
  }
};
function finish(parts, calls) {
  const text = parts.join("");
  const outcome = { text, prose: hasProse(text) };
  if (calls.length > 0) outcome.calls = [...calls];
  return outcome;
}

// vendor/dsh-connect-workbuddy/shim.ts
var REQUEST_BODY_LIMIT = 64 * 1024 * 1024;
var FAILOVER_ACCOUNT_GAP_MS = 2e3;
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "[::1]"]);
function hostnameOfHost(host) {
  let hostname = host.trim().toLowerCase();
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    return end === -1 ? hostname : hostname.slice(0, end + 1);
  }
  const colon = hostname.lastIndexOf(":");
  if (colon !== -1 && /^\d+$/.test(hostname.slice(colon + 1))) hostname = hostname.slice(0, colon);
  return hostname;
}
function hostIsLoopback(host) {
  if (host === void 0 || host.trim() === "") return false;
  return LOOPBACK_HOSTS.has(hostnameOfHost(host));
}
function originIsLoopback(origin) {
  if (origin === void 0 || origin.trim() === "") return true;
  try {
    const { hostname } = new URL(origin);
    return LOOPBACK_HOSTS.has(hostname) || hostname === "::1";
  } catch {
    return false;
  }
}
function isJsonContentType(req) {
  const type = req.headers["content-type"];
  return typeof type === "string" && type.trim().toLowerCase().startsWith("application/json");
}
var KIND_STATUS = {
  hard_credit: 402,
  soft_rate: 429,
  // Same status as `soft_rate`, because that is what the upstream returned — the
  // distinction lives in `code`/`type`, not in a relabelled status. See
  // KIND_HOST_CODE for why the host must not read this as an account limit.
  model_busy: 429,
  session_dead: 401,
  policy_reject: 403,
  not_found: 502,
  server: 502,
  client: 400
};
var KIND_HOST_CODE = {
  soft_rate: "quota_exceeded",
  model_busy: "quota_exceeded"
};
function hostErrorCode(kind) {
  return KIND_HOST_CODE[kind] ?? kind;
}
function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}
function writeOpenAIError(res, status, kind, message, code) {
  writeJson(res, status, { error: { message, type: kind, code: code ?? kind } });
}
function readBody(req) {
  return new Promise((resolve2, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > REQUEST_BODY_LIMIT) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve2(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
var RecoveryStream = class {
  constructor(res, gate, logger, notice) {
    this.res = res;
    this.logger = logger;
    this.buffer = gate === void 0 ? void 0 : new DsmlStreamBuffer(gate);
    this.notice = notice;
  }
  res;
  logger;
  carry = "";
  decoder = new TextDecoder("utf-8");
  /** Frames received after the hold began, in arrival order. */
  held = [];
  /**
   * The hold window, as two separate facts.
   *
   * `windowOpened` becomes true at the FIRST content-bearing frame and stays
   * true: before it, frames carry no answer (a role delta, a keep-alive) and go
   * straight out; from it on, they are held until the answer is known to be
   * real. `windowClosed` means "an answer was delivered", after which every
   * frame passes through again — for the rest of the response, because a turn
   * that has already produced prose can no longer be replaced by a retry.
   */
  windowOpened = false;
  windowClosed = false;
  wroteContent = false;
  sawResidue = false;
  sawDone = false;
  /**
   * Set once the upstream speaks structured calls.
   *
   * Sticky for the whole response on purpose: recovering markup into a second
   * call channel after the upstream already produced a real one would hand the
   * client two answers to the same question.
   */
  nativeCallsSeen = false;
  buffer;
  /**
   * A notice to place at the head of the answer, once, before any prose.
   *
   * Set when the request reached this stream only after the pool failed over, so
   * the user learns WHY the answer came from a different account. Without it a
   * failover is invisible: the reply looks like it came from the account they
   * picked, and the only trace is a `logger.warn` they never see. The notice is
   * emitted ahead of the model's own text so it cannot be mistaken for part of
   * the answer, and only once — a retry that never delivers text must not leave
   * a stray line behind.
   */
  notice;
  /**
   * Emit the pending failover notice, if any, and forget it.
   *
   * Called immediately before the first content reaches the client. Placed
   * here rather than in the constructor because a stream whose write fails, or
   * whose attempt is discarded in favour of a retry, must not have already told
   * the user about a switch it never completed.
   */
  flushNotice() {
    const notice = this.notice;
    if (notice === void 0) return;
    this.notice = void 0;
    if (!this.res.writable) return;
    const chunk = { choices: [{ index: 0, delta: {}, finish_reason: "" }] };
    const choiceRecord = { index: 0, delta: {}, finish_reason: "" };
    this.windowOpened = true;
    this.emitFrame(contentFrame(chunk, choiceRecord, notice));
  }
  /** True when a call or real prose has reached the client. */
  get delivered() {
    return this.wroteContent;
  }
  /** True when the held bytes contain markup the gates refused. */
  get residueSeen() {
    return this.sawResidue;
  }
  /**
   * The single exit every byte of a FRAME passes through.
   *
   * SSE dispatches one event per blank-line-terminated run of `data:` lines.
   * A frame written WITHOUT its terminator leaves the client's decoder
   * waiting for a blank line that never arrives, so the NEXT write is
   * appended to the SAME event — and a client that joins the several `data:`
   * lines of one event with `\n` and parses the result as one JSON document
   * (openai's `SSEDecoder` does exactly that) then reads two payloads as one
   * and fails. Issue #53 is that failure: the upstream died between a `data:`
   * line and its blank line, `consume()` forwarded the half-frame verbatim,
   * and `finish()` glued its synthetic `[DONE]` onto it, producing
   * `data: {...}\ndata: [DONE]\n\n` — parsed as one event whose data is
   * `"{...}\n[DONE]"`, which throws "Unexpected non-whitespace character
   * after JSON at position N". The whole turn is then classified as a
   * non-retryable error, so the user simply sees the answer stop.
   *
   * Completing the terminator here fixes both halves at once: the truncated
   * frame becomes a self-contained event, and the `[DONE]` that follows can no
   * longer be joined to it. It is idempotent for the frames `push()` cuts —
   * those always carry the terminator already, so they pass through
   * byte-for-byte, which keeps guarantee 1 (frame order is never changed)
   * intact.
   *
   * Note that a missing NEWLINE is also completed: `data: {…}` cut mid-line
   * needs the full `\n\n`, not a single `\n`, to close the event. Such a frame
   * is upstream-corrupted JSON that cannot be repaired here; closing it at
   * least keeps the corruption confined to its own event instead of taking
   * the terminator down with it.
   */
  emitFrame(frame) {
    if (frame.endsWith("\n\n")) {
      this.res.write(frame);
      return;
    }
    this.res.write(frame.endsWith("\n") ? `${frame}
` : `${frame}

`);
  }
  /** Record that text the gates refused was seen (markup residue, not prose). */
  noteResidue(seen) {
    this.sawResidue ||= seen;
  }
  /** Drain one upstream body into the client. */
  async consume(body) {
    if (body === null) return;
    const source = Readable.fromWeb(body);
    try {
      for await (const chunk of source) {
        this.push(this.decoder.decode(chunk, { stream: true }));
      }
    } catch (error) {
      this.logger?.warn("dsh-connect-workbuddy: upstream stream failed mid-flight", error);
    }
    const tail = this.carry;
    this.carry = "";
    if (tail !== "") {
      const lineTerminated = tail.endsWith("\n");
      this.handleFrame(lineTerminated ? `${tail}
` : `${tail}

`);
    }
  }
  /**
   * Close the response: emit the block still unfinished at end-of-stream, then
   * everything held, then the terminator.
   */
  finish() {
    const flushed = this.buffer?.flush();
    if (flushed !== void 0 && flushed.text !== "") {
      this.noteResidue(!flushed.prose);
      this.emitContent(flushed.text);
    }
    this.closeWindow();
    if (!this.sawDone && this.res.writable) this.emitFrame("data: [DONE]\n\n");
    if (this.res.writable) this.res.end();
  }
  /** Drop held bytes without writing them (used when a retry replaced them). */
  discard() {
    this.held = [];
    this.windowClosed = true;
  }
  // -------------------------------------------------------------------------
  /** Split incoming bytes into whole SSE frames, handling chunk boundaries. */
  push(text) {
    this.carry += text;
    let start = 0;
    for (; ; ) {
      const newline = this.carry.indexOf("\n", start);
      if (newline === -1) break;
      const line = this.carry.slice(start, newline);
      if (line.trim() === "") {
        const frame = this.carry.slice(0, newline + 1);
        this.carry = this.carry.slice(newline + 1);
        start = 0;
        this.handleFrame(frame);
        continue;
      }
      start = newline + 1;
    }
  }
  /** Handle one complete frame, rewriting it only when recovery produced something. */
  handleFrame(frame) {
    const payload = dataPayload(frame);
    if (payload === void 0) {
      this.send(frame, false);
      return;
    }
    if (payload === "[DONE]") {
      this.sawDone = true;
      this.send(frame, false);
      return;
    }
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      this.send(frame, false);
      return;
    }
    const choices = chunk["choices"];
    const choice = Array.isArray(choices) ? choices[0] : void 0;
    if (typeof choice !== "object" || choice === null || Array.isArray(choice)) {
      this.send(frame, false);
      return;
    }
    const choiceRecord = choice;
    const deltaValue = choiceRecord["delta"];
    const delta = typeof deltaValue === "object" && deltaValue !== null && !Array.isArray(deltaValue) ? deltaValue : void 0;
    if (delta === void 0) {
      this.send(frame, false);
      return;
    }
    const nativeCalls = delta["tool_calls"];
    if (Array.isArray(nativeCalls) && nativeCalls.length > 0) {
      this.nativeCallsSeen = true;
      this.windowOpened = true;
      this.flushNotice();
      this.send(frame, false);
      this.wroteContent = true;
      this.closeWindow();
      return;
    }
    const content = delta["content"];
    if (typeof content !== "string" || content === "") {
      const reason = finishReasonOf(choiceRecord);
      if (reason !== "") this.drainBuffer();
      this.send(frame, reason !== "");
      return;
    }
    if (this.buffer === void 0 || this.nativeCallsSeen) {
      this.windowOpened = true;
      this.flushNotice();
      this.closeWindow();
      this.emitFrame(frame);
      this.wroteContent = true;
      return;
    }
    this.windowOpened = true;
    const outcome = this.buffer.add(content);
    if (outcome.calls !== void 0 && outcome.calls.length > 0) {
      this.flushNotice();
      this.send(callsFrame(chunk, choiceRecord, outcome.calls), false);
      this.wroteContent = true;
      this.closeWindow();
      if (outcome.text !== "") this.emitFrame(contentFrame(chunk, choiceRecord, outcome.text));
      return;
    }
    this.noteResidue(!outcome.prose && outcome.text !== "");
    if (outcome.text === "") {
      this.send(contentFrame(chunk, choiceRecord, ""), false);
      return;
    }
    if (outcome.prose) {
      this.flushNotice();
      this.send(contentFrame(chunk, choiceRecord, outcome.text), false);
      this.wroteContent = true;
      this.closeWindow();
      return;
    }
    this.send(contentFrame(chunk, choiceRecord, outcome.text), false);
  }
  /**
   * Hand back whatever the buffer is still holding, right now.
   *
   * Called before a terminator frame is forwarded. `flush()` ends the buffer's
   * attempt — if content somehow keeps arriving afterwards it starts a fresh
   * one, which is the correct reading of a stream that declared itself finished.
   */
  drainBuffer() {
    const flushed = this.buffer?.flush();
    if (flushed === void 0 || flushed.text === "") return;
    this.noteResidue(!flushed.prose);
    this.emitContent(flushed.text);
  }
  /**
   * Emit text the buffer was still holding when the stream ended.
   *
   * It goes through `send` + `closeWindow` rather than straight to the socket on
   * purpose: a `finish_reason` frame may already be queued, and this text is
   * content that logically precedes it. Writing directly would put the answer
   * after its own terminator — a client that stops accumulating at
   * `finish_reason` would silently lose the tail.
   */
  emitContent(text) {
    const chunk = { choices: [{ index: 0, delta: {}, finish_reason: "" }] };
    const choiceRecord = { index: 0, delta: {}, finish_reason: "" };
    this.windowOpened = true;
    const frame = contentFrame(chunk, choiceRecord, text);
    if (text.trim() !== "") {
      this.flushNotice();
      this.send(frame, false);
      this.wroteContent = true;
      this.closeWindow();
      return;
    }
    this.send(frame, false);
  }
  /** Queue a frame while the window is open, or write it once it has closed. */
  send(frame, final) {
    if (this.windowClosed || !this.windowOpened) {
      this.emitFrame(frame);
      return;
    }
    const entry = { frame, final };
    if (!final) {
      const at = this.held.findIndex((item) => item.final);
      if (at !== -1) {
        this.held.splice(at, 0, entry);
        return;
      }
    }
    this.held.push(entry);
  }
  /**
   * An answer has been delivered: flush everything held, in order, and never
   * hold again for this response.
   */
  closeWindow() {
    this.windowClosed = true;
    const pending = this.held;
    this.held = [];
    for (const entry of pending) this.emitFrame(entry.frame);
  }
};
function dataPayload(frame) {
  for (const line of frame.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data:")) continue;
    return trimmed.slice("data:".length).trim();
  }
  return void 0;
}
function finishReasonOf(choice) {
  const reason = choice["finish_reason"];
  return typeof reason === "string" ? reason : "";
}
function callsFrame(chunk, choice, calls) {
  const toolCalls = calls.map((call, index) => ({
    index,
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: call.arguments }
  }));
  const next = { ...chunk, choices: [{ ...choice, delta: { tool_calls: toolCalls }, finish_reason: "tool_calls" }] };
  return `data: ${JSON.stringify(next)}

`;
}
function describeAccount(credential) {
  if (credential.uin !== void 0 && credential.uin !== "") return credential.uin;
  if (credential.nickname !== void 0 && credential.nickname !== "") return credential.nickname;
  return workbuddyAccountId(credential);
}
function failoverReasonText(failure) {
  if (failure.ok) return "unusable";
  switch (failure.kind) {
    // The 6004 volume limit: the account serves this request again once the
    // stated reset passes.
    case "soft_rate":
      return "rate limited";
    // NOT the same sentence as `soft_rate`, though both leave the pool. The
    // remedy differs in kind: an exhausted account cannot pay for this model AT
    // ALL until it is topped up or its quota cycle rolls over, so "rate limited"
    // sends the user to wait for something that will not arrive. Kept
    // failover-worthy — another ACCOUNT may well have credits, which is exactly
    // why the notice has to name the real reason.
    case "hard_credit":
      return "out of credits";
    case "model_busy":
      return "throttled on this model (not the account)";
    case "session_dead":
      return "signed out";
    case "policy_reject":
      return "rejected by policy";
    case "not_found":
      return "model unavailable";
    case "server":
      return "erroring upstream";
    default:
      return `unusable (http ${failure.status})`;
  }
}
function failoverNoticeText(from, reason) {
  return `

> [dsh-connect-workbuddy] \u300C${from}\u300Dwas ${reason} \u2014 this answer came from another account

`;
}
function contentFrame(chunk, choice, content) {
  const delta = { ...choice["delta"], content };
  const next = { ...chunk, choices: [{ ...choice, delta }] };
  return `data: ${JSON.stringify(next)}

`;
}
function createWorkBuddyShim(options) {
  const { store, client, catalog } = options;
  const logger = options.logger;
  const failoverAccount = options.failoverAccount;
  const prepareAccount = options.prepareAccount;
  const onAccountFailure = options.onAccountFailure;
  const SHARED_SECRET = randomBytes2(32).toString("base64url");
  function bearerOk(req) {
    const header = req.headers.authorization;
    if (typeof header !== "string") return false;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match === null) return false;
    const presented = match[1];
    const expected = SHARED_SECRET;
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  const ready = new Promise((resolve2, reject) => {
    server.once("listening", () => resolve2());
    server.once("error", reject);
  });
  server.listen(0, "127.0.0.1");
  const baseUrl = () => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("workbuddy shim has no listening address");
    }
    return `http://127.0.0.1:${address.port}`;
  };
  async function handle(req, res) {
    try {
      if (!hostIsLoopback(req.headers.host)) {
        writeOpenAIError(res, 403, "host_not_allowed", "Host header must name the loopback interface");
        return;
      }
      if (!originIsLoopback(req.headers.origin)) {
        writeOpenAIError(res, 403, "origin_not_allowed", "Origin must be a loopback origin");
        return;
      }
      if (!bearerOk(req)) {
        writeOpenAIError(res, 401, "unauthorized", "missing or invalid Authorization bearer");
        return;
      }
      const url = req.url ?? "/";
      if (req.method === "GET" && (url === "/healthz" || url === "/healthz/")) {
        writeJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
        writeJson(res, 200, {
          object: "list",
          data: catalog.current().map((model) => ({
            id: model.id,
            object: "model",
            created: 0,
            owned_by: "workbuddy"
          }))
        });
        return;
      }
      if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/v1/chat/completions/")) {
        await chatCompletions(req, res);
        return;
      }
      writeOpenAIError(res, 404, "not_found", `no such route: ${req.method} ${url}`);
    } catch (error) {
      if (!res.headersSent) {
        writeOpenAIError(res, 500, "internal", String(error));
      } else {
        res.end();
      }
    }
  }
  function isFailoverWorthy(kind) {
    return kind !== "client" && kind !== "model_busy";
  }
  async function chatCompletions(req, res) {
    if (!isJsonContentType(req)) {
      writeOpenAIError(res, 415, "unsupported_media_type", "Content-Type must be application/json");
      return;
    }
    await prepareAccount?.().catch((error) => {
      logger?.warn("dsh-connect-workbuddy: pool account selection failed", error);
    });
    let credential;
    try {
      credential = await store.resolve();
    } catch (error) {
      writeOpenAIError(res, 401, "not_signed_in", String(error));
      return;
    }
    const raw = (await readBody(req)).toString("utf8");
    const prepared = prepareChatBody(raw);
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    let result = await client.chatStream(credential, prepared, controller.signal);
    const triedAccountIds = [];
    let switchedFrom;
    let switchedBecause;
    const failures = [];
    const recordAttempt = (credential2, failure) => {
      if (failure.ok) return;
      failures.push({ accountId: workbuddyAccountId(credential2), failure });
    };
    const reportFailures = () => {
      const batch = failures.splice(0, failures.length);
      if (onAccountFailure === void 0) return;
      if (controller.signal.aborted) return;
      for (const entry of batch) {
        if (entry.failure.ok) continue;
        try {
          onAccountFailure(entry.accountId, {
            status: entry.failure.status,
            kind: entry.failure.kind,
            message: entry.failure.message
          });
        } catch (error) {
          logger?.warn("dsh-connect-workbuddy: recording an account failure failed", error);
        }
      }
    };
    while (!result.ok && isFailoverWorthy(result.kind) && failoverAccount !== void 0) {
      if (controller.signal.aborted) break;
      recordAttempt(credential, result);
      triedAccountIds.push(workbuddyAccountId(credential));
      const next = await failoverAccount(triedAccountIds).catch(() => void 0);
      if (next === void 0) break;
      if (triedAccountIds.includes(workbuddyAccountId(next))) break;
      if (controller.signal.aborted) break;
      await new Promise((resolve2) => {
        if (controller.signal.aborted) return resolve2();
        const timer = setTimeout(resolve2, FAILOVER_ACCOUNT_GAP_MS);
        controller.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve2();
        }, { once: true });
      });
      if (controller.signal.aborted) break;
      logger?.warn(
        `dsh-connect-workbuddy: retrying chat on another pool account after ${result.kind} (http ${result.status})`
      );
      switchedFrom ??= describeAccount(credential);
      switchedBecause ??= failoverReasonText(result);
      credential = next;
      result = await client.chatStream(credential, prepared, controller.signal);
    }
    if (failures.length === 0 || failures[failures.length - 1]?.accountId !== workbuddyAccountId(credential)) {
      recordAttempt(credential, result);
    }
    reportFailures();
    if (!result.ok) {
      const attempts = triedAccountIds.length;
      const note = attempts > 1 ? ` (after trying ${attempts} accounts)` : "";
      if (result.kind === "policy_reject") {
        const detail = result.detail;
        const lead = detail?.displayMsg ?? result.message.slice(0, 200);
        const meta = ["\u670D\u52A1\u7AEF\u7B56\u7565\u62D2\u7EDD"];
        if (detail?.upstreamCode !== void 0) meta.push(`code ${detail.upstreamCode}`);
        if (detail?.requestId !== void 0) meta.push(`requestId ${detail.requestId}`);
        const message = `${lead}\uFF08${meta.join("\uFF0C")}\uFF09${note}\u3002\u8BE5\u8BF7\u6C42\u88AB WorkBuddy \u670D\u52A1\u7AEF\u7B56\u7565\u62D2\u7EDD\uFF0C\u91CD\u65B0\u767B\u5F55\u4E0D\u4F1A\u89E3\u51B3\uFF1B\u53EF\u5728 WorkBuddy \u684C\u9762\u7AEF\u7528\u540C\u4E00\u8D26\u53F7\u9A8C\u8BC1\uFF0C\u6216\u5207\u6362\u533A\u57DF/\u8D26\u53F7\u540E\u91CD\u8BD5`;
        writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, message, hostErrorCode(result.kind));
        return;
      }
      if (result.kind === "model_busy") {
        const detail = result.detail;
        const lead = detail?.displayMsg ?? result.message.slice(0, 200);
        const meta = ["\u6A21\u578B\u5F53\u524D\u8D1F\u8F7D\u8F83\u9AD8"];
        if (detail?.upstreamCode !== void 0) meta.push(`code ${detail.upstreamCode}`);
        if (detail?.requestId !== void 0) meta.push(`requestId ${detail.requestId}`);
        const message = `${lead}\uFF08${meta.join("\uFF0C")}\uFF09${note}\u3002\u8FD9\u4E0D\u662F\u8D26\u53F7\u88AB\u9650\u6D41\u2014\u2014\u540C\u4E00\u51ED\u636E\u4E0B\u6362\u4E00\u4E2A\u6A21\u578B\u5373\u53EF\u6B63\u5E38\u4F7F\u7528\uFF1B\u63D2\u4EF6\u4E0D\u4F1A\u4E3A\u6B64\u5207\u6362\u8D26\u53F7\uFF0C\u56E0\u4E3A\u8BE5\u9650\u5236\u8DDF\u968F\u6A21\u578B\u672C\u8EAB\u3002\u5EFA\u8BAE\u7B49\u5F85\u7EA6 1 \u5206\u949F\u540E\u91CD\u8BD5\uFF0C\u6216\u5207\u6362\u5230\u8D1F\u8F7D\u8F83\u4F4E\u7684\u6A21\u578B`;
        writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, message, hostErrorCode(result.kind));
        return;
      }
      writeOpenAIError(
        res,
        KIND_STATUS[result.kind],
        result.kind,
        `workbuddy upstream ${result.kind} (http ${result.status})${note}: ${result.message.slice(0, 400)}`,
        hostErrorCode(result.kind)
      );
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const declared = declaredTools(prepared);
    const gate = declared === void 0 ? void 0 : {
      declaredNames: declared.names,
      requiredParameters: declared.requiredParameters,
      ...declared.pinnedToolName === void 0 ? {} : { pinnedToolName: declared.pinnedToolName }
    };
    const notice = switchedFrom === void 0 || switchedBecause === void 0 ? void 0 : failoverNoticeText(switchedFrom, switchedBecause);
    const writer = new RecoveryStream(res, gate, logger, notice);
    await writer.consume(result.response.body);
    if (gate !== void 0 && !writer.delivered && writer.residueSeen && !controller.signal.aborted) {
      logger?.warn("dsh-connect-workbuddy: the turn produced DSML markup only; retrying it once");
      const retryTried = [...triedAccountIds, workbuddyAccountId(credential)];
      let retryCredential = credential;
      for (; ; ) {
        const attempt = await client.chatStream(retryCredential, prepared, controller.signal);
        if (attempt.ok) {
          writer.discard();
          const retried = new RecoveryStream(res, gate, logger);
          await retried.consume(attempt.response.body);
          retried.finish();
          reportFailures();
          return;
        }
        recordAttempt(retryCredential, attempt);
        if (!isFailoverWorthy(attempt.kind) || failoverAccount === void 0) break;
        if (controller.signal.aborted) break;
        const next = await failoverAccount(retryTried).catch(() => void 0);
        if (next === void 0) break;
        if (retryTried.includes(workbuddyAccountId(next))) break;
        retryTried.push(workbuddyAccountId(next));
        retryCredential = next;
      }
      logger?.warn("dsh-connect-workbuddy: markup-only retry did not start; showing the original text");
    }
    writer.finish();
    reportFailures();
  }
  return {
    ready,
    baseUrl,
    token: () => SHARED_SECRET,
    close: () => new Promise((resolve2, reject) => {
      server.close(() => resolve2());
      server.closeAllConnections();
      server.once("error", reject);
    })
  };
}

// vendor/dsh-connect-workbuddy/catalog.ts
var FALLBACK_WORKBUDDY_MODELS = [
  { id: "auto", name: "Auto", contextWindow: 168e3, maxTokens: 32e3 },
  { id: "hy3", name: "Hy3", contextWindow: 192e3, maxTokens: 64e3 },
  { id: "glm-5v-turbo", name: "GLM-5v-Turbo", contextWindow: 2e5, maxTokens: 64e3 },
  { id: "glm-5.3", name: "GLM-5.3", contextWindow: 1e6, maxTokens: 48e3 },
  { id: "glm-5.2", name: "GLM-5.2", contextWindow: 1e6, maxTokens: 48e3 },
  { id: "glm-5.1", name: "GLM-5.1", contextWindow: 2e5, maxTokens: 48e3 },
  { id: "minimax-m3", name: "MiniMax-M3", contextWindow: 512e3, maxTokens: 128e3 },
  { id: "kimi-k3-1", name: "Kimi-K3", contextWindow: 1e6, maxTokens: 32e3 },
  { id: "kimi-k2.7", name: "Kimi-K2.7-Code", contextWindow: 256e3, maxTokens: 32e3 },
  { id: "kimi-k2.6", name: "Kimi-K2.6", contextWindow: 256e3, maxTokens: 32e3 },
  { id: "deepseek-v4-flash", name: "Deepseek-V4-Flash", contextWindow: 1e6, maxTokens: 5e4 },
  { id: "deepseek-v4-pro", name: "Deepseek-V4-Pro", contextWindow: 1e6, maxTokens: 5e4 }
];
var FALLBACK_WORKBUDDY_MODELS_GLOBAL = [
  { id: "default-model", name: "Auto", contextWindow: 176e3, maxTokens: 24e3, creditMultiplier: 0.79 },
  { id: "fast-model", name: "Fast", contextWindow: 2e5, maxTokens: 32e3, creditMultiplier: 0.34 },
  { id: "balanced-model", name: "Balanced", contextWindow: 256e3, maxTokens: 32e3, creditMultiplier: 0.59 },
  { id: "primary-model", name: "Primary", contextWindow: 272e3, maxTokens: 72e3, creditMultiplier: 3.31 },
  { id: "deep-model", name: "Deep", contextWindow: 176e3, maxTokens: 24e3, creditMultiplier: 3.33 },
  // Free promotional model (`x0.00`, "Free now"): the reason the global roster
  // is read from the desktop channel at all — the CLI channel omits it.
  { id: "deepseek-v4.1-flash", name: "Deepseek-V4.1-Flash", contextWindow: 1e6, maxTokens: 128e3, creditMultiplier: 0 },
  { id: "gpt-6-astra", name: "GPT-6-Astra", contextWindow: 1e6, maxTokens: 128e3, creditMultiplier: 6.67 },
  { id: "hy4-preview", name: "Hy4 preview", contextWindow: 1e6, maxTokens: 64e3, creditMultiplier: 0 },
  { id: "hy3", name: "Hy3", contextWindow: 192e3, maxTokens: 64e3, creditMultiplier: 0 },
  { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", contextWindow: 1e6, maxTokens: 128e3, creditMultiplier: 3.47 },
  { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", contextWindow: 1e6, maxTokens: 128e3, creditMultiplier: 1.39 },
  { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", contextWindow: 1e6, maxTokens: 128e3, creditMultiplier: 0.14 },
  { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 1e6, maxTokens: 128e3, creditMultiplier: 3.31 },
  { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 272e3, maxTokens: 72e3, creditMultiplier: 1.65 },
  { id: "gpt-5.3-codex", name: "GPT-5.3-Codex", contextWindow: 272e3, maxTokens: 72e3, creditMultiplier: 1.25 },
  { id: "gemini-3.5-flash", name: "Gemini-3.5-Flash", contextWindow: 1e6, maxTokens: 65536, creditMultiplier: 0.99 },
  { id: "glm-5.3", name: "GLM-5.3", contextWindow: 1e6, maxTokens: 48e3, creditMultiplier: 0.79 },
  { id: "glm-5.2", name: "GLM-5.2", contextWindow: 1e6, maxTokens: 48e3, creditMultiplier: 0.79 },
  { id: "kimi-k3", name: "Kimi-K3", contextWindow: 1e6, maxTokens: 32e3, creditMultiplier: 1.62 },
  { id: "kimi-k2.6", name: "Kimi-K2.6", contextWindow: 256e3, maxTokens: 32e3, creditMultiplier: 0.52 }
];
function fallbackModelsFor(region) {
  return region === "global" ? FALLBACK_WORKBUDDY_MODELS_GLOBAL : FALLBACK_WORKBUDDY_MODELS;
}
var WorkBuddyCatalog = class {
  models;
  /**
   * Whether this region has any local sign-in. Defaults to `true` — the
   * permissive direction — so a scan that has not run yet (or failed) keeps
   * serving the fallback rather than blanking a region that may be fine.
   */
  usable = true;
  /**
   * Whether the user has switched this region's provider ON. Opt-out: defaults
   * to `true`, so a config predating this switch (and the pre-region-split flat
   * fields, which never carry `enabled`) keeps both providers running. Set to
   * `false` by `setRegionEnabled` to withdraw the region from DSH's model
   * picker entirely (its adapter route and configurable-provider entry are
   * pulled by the Host via `AdapterRegistrationHandle.replace([])` /
   * `DirectoryRegistrationHandle.replace([])`). This is a USER choice, distinct
   * from {@link usable}: a region the user switched off keeps its catalog,
   * accounts, and model picks intact and reappears the moment they re-check it.
   */
  enabled = true;
  /**
   * @param region Seeds the static fallback for this region; each region's
   * provider must never serve the other region's roster before its first
   * live refresh lands.
   */
  constructor(region = "cn") {
    this.models = fallbackModelsFor(region);
  }
  /**
   * Current entries; the fallback list until the upstream answer lands.
   *
   * Empty while this region has no local sign-in OR the user has switched it
   * off: the provider stays registered (its row still hosts the settings card
   * and the account picker), but it advertises nothing to pick. DSH drops empty
   * provider groups from the picker (`buildModelCatalog` filters
   * `models.length > 0`), so the group disappears exactly when it would be pure
   * noise. The two empty causes are independent: `usable` is the automatic
   * "no account" gate (issue #12), `enabled` is the user's explicit on/off.
   */
  current() {
    return this.usable && this.enabled ? this.models : [];
  }
  /** Whether this region currently advertises any model. */
  isRegionUsable() {
    return this.usable;
  }
  /** Whether the user has this region's provider switched on. */
  isRegionEnabled() {
    return this.enabled;
  }
  /**
   * Record whether this region has a local sign-in.
   *
   * Separate from {@link set} on purpose: `set()` carries a live upstream
   * answer and must never be empty, while "this region has no account" is a
   * legitimate empty state that must survive across refreshes. Keeping them
   * apart is what lets the non-empty guard stay strict.
   *
   * @returns whether the value changed, so the caller can skip invalidating
   *   its adapter snapshots when nothing moved.
   */
  setRegionUsable(usable) {
    if (this.usable === usable) return false;
    this.usable = usable;
    return true;
  }
  /**
   * Record the user's explicit on/off choice for this region's provider.
   *
   * Distinct from {@link setRegionUsable}: that is the automatic "no local
   * account" gate, while this is a deliberate user action (issue #11-style
   * region switch). The Host reads the same `enabled` flag through
   * `regionStateOf(config, region).enabled !== false`, so the two halves never
   * disagree. Returns whether the value changed.
   */
  setRegionEnabled(enabled) {
    if (this.enabled === enabled) return false;
    this.enabled = enabled;
    return true;
  }
  /** Replace the list; callers invalidate their adapter snapshot after this. */
  set(models) {
    if (models.length === 0) throw new Error("workbuddy model catalog cannot be empty");
    this.models = models.map((model) => ({ ...model }));
  }
};
export {
  WorkBuddyCatalog,
  WorkBuddyCredentialStore,
  WorkBuddyUpstreamClient,
  createWorkBuddyShim,
  fallbackModelsFor,
  regionOf,
  workbuddyAccountId
};
