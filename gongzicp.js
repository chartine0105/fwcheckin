/**
 * 公子CP (gongzicp.com) GitHub Actions 自动签到 (账号密码直登版)
 */

const crypto = require("node:crypto");

const BASE = "https://gongzicp.com";
const LOGIN_URL = `${BASE}/cp.UserExternal/account_login`;
const SIGN_URL = `${BASE}/webapi/user/signHandle`;
const STATE_URL = `${BASE}/webapi/user/getSignDate`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/147.0.0.0 Safari/537.36"; // 与你的抓包一致

const TIME_ZONE = process.env.GZCP_TIME_ZONE || "Asia/Shanghai";
const REQUEST_TIMEOUT_MS = 20000;
const VERIFY_ATTEMPTS = 4;
const VERIFY_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function todayParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function parseAccounts(raw) {
  if (!raw.trim()) throw new Error("未配置 GitHub Secret：GZCP_ACCOUNTS");

  let accounts;
  try {
    accounts = JSON.parse(raw);
  } catch {
    throw new Error("GZCP_ACCOUNTS 不是有效 JSON，请检查配置");
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("GZCP_ACCOUNTS 必须是至少包含一个账号的 JSON 数组");
  }

  accounts.forEach((a, i) => {
    if (!a || typeof a !== "object") {
      throw new Error(`账号${i + 1}配置格式错误`);
    }
    for (const key of ["username", "password"]) {
      if (typeof a[key] !== "string" || !a[key].trim()) {
        throw new Error(`账号${i + 1}缺少 ${key}`);
      }
    }
  });

  return accounts;
}

/**
 * 登录并获取凭证
 * 注意：这里假设你的 Payload 是 JSON。如果是二进制，需要根据真实情况改写这里。
 */
async function login(account) {
  console.log(`[公子CP] 正在尝试登录账号：${account.username}`);

  // 模拟抓包中的头信息
  const reqHeaders = {
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Content-Type": "application/grpc-web+proto", // 使用你截图里的 Content-Type
    "Origin": BASE,
    "Referer": `${BASE}/login/signin`,
    "User-Agent": UA,
    "_c_n": "6011f", // 截图里的设备标识
    "Version": "1",
    "Token": "4f", // 截图里的初始 Token（可能为空或某个固定值）
  };

  // 【关键】：如果 Payload 是纯文本或者 JSON，请在这里修改请求体！
  // 目前假设它接收 JSON（如果报错，请把抓包里的 Payload 发给我看看）
  const payload = {
    account: account.username, // 字段名可能需根据抓包修改，比如 username / phone
    password: account.password,
  };

  const response = await fetch(LOGIN_URL, {
    method: "POST",
    headers: reqHeaders,
    body: JSON.stringify(payload), // 如果是二进制需改这里
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`登录 HTTP 失败: ${response.status}`);
  }

  // 提取最新的 Cookie 和 Token (gRPC 通常通过 Header 下发)
  const setCookies = response.headers.get("set-cookie") || "";
  // 这里的 token 可能在返回的 header 里，也可能在请求头里叫 "token"
  const newToken = response.headers.get("token") || reqHeaders.Token;

  // 尝试从 Set-Cookie 中提取 PHPSESSID
  let phpSessId = "";
  const match = setCookies.match(/PHPSESSID=([^;]+)/);
  if (match) {
    phpSessId = `PHPSESSID=${match[1]}`;
  } else {
    console.log(`[警告] 登录响应中没有找到 Set-Cookie PHPSESSID`);
  }

  return {
    cookie: phpSessId,
    token: newToken,
    // gRPC 接口通常不需要 authorization，或者可以直接拿 token 替代
    authorization: newToken, 
  };
}

function makeHeaders(credentials, isSign = false) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Authorization: credentials.authorization,
    client: "pc",
    "Content-Type": "application/json",
    Cookie: credentials.cookie,
    Referer: `${BASE}/user/home`,
    "User-Agent": UA,
    token: credentials.token,
  };

  if (isSign) {
    headers.timestamp = String(Math.floor(Date.now() / 1000));
    headers["rand-str"] = crypto.randomBytes(16).toString("hex");
  }

  return headers;
}

async function requestJson(url, credentials, options = {}) {
  const { method = "GET", body, isSign = false } = options;
  const response = await fetch(url, {
    method,
    headers: makeHeaders(credentials, isSign),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "follow",
  });

  const raw = await response.text();
  let json;

  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`接口未返回有效 JSON（HTTP ${response.status}），可能登录失效`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}：${json.msg || "请求失败"}`);
  }

  if (json.code !== 200) {
    throw new Error(`接口业务错误 code=${json.code ?? "未知"}：${json.msg || "无错误说明"}`);
  }

  return json;
}

async function getSignState(credentials) {
  const result = await requestJson(STATE_URL, credentials);
  const signData = result?.data?.signData;

  if (!signData || typeof signData !== "object") {
    throw new Error("getSignDate 返回中缺少 data.signData，无法验证签到状态");
  }

  const list = signData.list;
  if (!Array.isArray(list)) {
    throw new Error("签到日期列表 signData.list 格式异常");
  }

  return {
    total: Number(signData.total),
    thisMonth: Number(signData.thisMonth),
    continuous: Number(signData.continuous),
    list: list.map(Number).filter(Number.isFinite),
  };
}

function hasSignedToday(state, today) {
  return state.list.includes(today.day);
}

function stateSummary(state) {
  return `累计=${state.total}，本月=${state.thisMonth}，连续=${state.continuous ?? "未知"}天，日期=[${state.list.join(",")}]`;
}

async function runOne(account, index) {
  const label = String(account.label || `账号${index + 1}`).replace(/[\r\n]/g, " ");
  const tag = `[公子CP][${label}]`;
  const today = todayParts();

  try {
    // 1. 动态登录获取凭证
    const credentials = await login(account);
    console.log(`${tag} 🔑 登录成功，凭证已更新`);

    // 2. 查询状态
    console.log(`${tag} 查询签到状态，日期=${today.date}（${TIME_ZONE}）`);
    const before = await getSignState(credentials);
    console.log(`${tag} 签到前：${stateSummary(before)}`);

    if (hasSignedToday(before, today)) {
      const msg = `${tag} ✅ 今日已经签到：${stateSummary(before)}`;
      console.log(msg);
      return { success: true, msg };
    }

    // 3. 执行签到
    const signResult = await requestJson(SIGN_URL, credentials, {
      method: "POST",
      body: {},
      isSign: true,
    });
    console.log(`${tag} 签到接口返回：code=${signResult.code}，msg=${signResult.msg || "无"}`);

    // 4. 验证结果
    let after = null;
    let lastError = null;

    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
      await sleep(VERIFY_DELAY_MS);
      try {
        after = await getSignState(credentials);
        if (after.total > before.total || hasSignedToday(after, today)) {
          break;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (after && (after.total > before.total || hasSignedToday(after, today))) {
      const msg = `${tag} ✅ 签到成功：${stateSummary(after)}`;
      console.log(msg);
      return { success: true, msg };
    }

    const reason = lastError ? `；状态查询异常：${lastError.message}` : "";
    const msg = `${tag} ❌ 无法确认签到成功：签到前(${stateSummary(before)})` + (after ? `；签到后(${stateSummary(after)})` : "") + reason;
    console.error(msg);
    return { success: false, msg };
  } catch (error) {
    const msg = `${tag} ❌ 失败：${error.message}`;
    console.error(msg);
    return { success: false, msg };
  }
}

async function main() {
  let accounts;
  try {
    accounts = parseAccounts(process.env.GZCP_ACCOUNTS || "");
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`公子CP自动签到开始，共 ${accounts.length} 个账号`);
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    results.push(await runOne(accounts[i], i));
  }

  console.log("\n========= 最终结果 =========");
  for (const result of results) console.log(result.msg);

  const failures = results.filter((r) => !r.success).length;
  if (failures > 0) {
    console.error(`::error::${failures}/${results.length} 个账号签到失败`);
    process.exitCode = 1;
  } else {
    console.log("✅ 所有账号均已确认今日签到");
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error(`::error::未处理异常：${error.message}`);
  process.exitCode = 1;
});
