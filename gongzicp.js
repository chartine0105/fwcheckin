
/**
 * 公子CP GitHub Actions 自动签到
 * Cookie 单凭证版本
 * Node.js 20+
 */

const BASE = "https://gongzicp.com";
const SIGN_URL = `${BASE}/webapi/user/signHandle`;
const STATE_URL = `${BASE}/webapi/user/getSignDate`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

const TIME_ZONE = process.env.GZCP_TIME_ZONE || "Asia/Shanghai";
const REQUEST_TIMEOUT_MS = 20000;
const VERIFY_ATTEMPTS = 4;
const VERIFY_DELAY_MS = 1500;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function todayParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = type => parts.find(p => p.type === type)?.value;

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function parseAccounts(raw) {
  if (!raw.trim()) {
    throw new Error("未配置 GitHub Secret：GZCP_ACCOUNTS");
  }

  let accounts;

  try {
    accounts = JSON.parse(raw);
  } catch {
    throw new Error("GZCP_ACCOUNTS 不是有效 JSON");
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("GZCP_ACCOUNTS 必须是非空数组");
  }

  accounts.forEach((a, i) => {
    if (!a || typeof a !== "object") {
      throw new Error(`账号${i + 1}配置格式错误`);
    }

    if (typeof a.cookie !== "string" || !a.cookie.trim()) {
      throw new Error(`账号${i + 1}缺少 cookie`);
    }
  });

  return accounts;
}

function makeHeaders(account, isSign = false) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    client: "pc",
    "Content-Type": "application/json",
    Cookie: account.cookie,
    Referer: `${BASE}/user/home`,
    "User-Agent": UA,
  };

  if (isSign) {
    headers.timestamp = String(Math.floor(Date.now() / 1000));
    headers["rand-str"] =
      require("node:crypto").randomBytes(16).toString("hex");
  }

  return headers;
}

async function requestJson(url, account, options = {}) {
  const { method = "GET", body, isSign = false } = options;

  const response = await fetch(url, {
    method,
    headers: makeHeaders(account, isSign),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "follow",
  });

  const raw = await response.text();
  let json;

  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(
      `接口未返回有效 JSON（HTTP ${response.status}），可能登录失效或接口变化`
    );
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}：${json.msg || "请求失败"}`);
  }

  if (json.code !== 200) {
    throw new Error(
      `接口业务错误 code=${json.code ?? "未知"}：${json.msg || "无错误说明"}`
    );
  }

  return json;
}

async function getSignState(account) {
  const result = await requestJson(STATE_URL, account);
  const signData = result?.data?.signData;

  if (!signData || typeof signData !== "object") {
    throw new Error("签到状态数据异常");
  }

  const total = Number(signData.total);
  const thisMonth = Number(signData.thisMonth);
  const continuous = Number(signData.continuous);
  const list = signData.list;

  if (!Number.isFinite(total) || !Number.isFinite(thisMonth)) {
    throw new Error("签到统计字段格式异常");
  }

  if (!Array.isArray(list)) {
    throw new Error("签到日期列表格式异常");
  }

  return {
    total,
    thisMonth,
    continuous: Number.isFinite(continuous) ? continuous : null,
    list: list.map(Number).filter(Number.isFinite),
  };
}

function hasSignedToday(state, today) {
  return state.list.includes(today.day);
}

function stateSummary(state) {
  return `累计=${state.total}，本月=${state.thisMonth}，连续=${state.continuous ?? "未知"}天，日期列表=[${state.list.join(",")}]`;
}

async function runOne(account, index) {
  const label = String(account.label || `账号${index + 1}`)
    .replace(/[\r\n]/g, " ");

  const tag = `[公子CP][${label}]`;
  const today = todayParts();

  try {
    console.log(`${tag} 查询签到状态，日期=${today.date}`);

    const before = await getSignState(account);
    console.log(`${tag} 签到前：${stateSummary(before)}`);

    if (hasSignedToday(before, today)) {
      const msg = `${tag} ✅ 今日已经签到：${stateSummary(before)}`;
      console.log(msg);
      return { success: true, msg };
    }

    const signResult = await requestJson(SIGN_URL, account, {
      method: "POST",
      body: {},
      isSign: true,
    });

    console.log(
      `${tag} 签到接口返回：code=${signResult.code}，msg=${signResult.msg || "无"}`
    );

    let after = null;
    let lastError = null;

    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
      await sleep(VERIFY_DELAY_MS);

      try {
        after = await getSignState(account);

        if (
          after.total > before.total ||
          hasSignedToday(after, today)
        ) {
          break;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (
      after &&
      (after.total > before.total || hasSignedToday(after, today))
    ) {
      const msg = `${tag} ✅ 签到成功：${stateSummary(after)}`;
      console.log(msg);
      return { success: true, msg };
    }

    const reason = lastError
      ? `；状态查询异常：${lastError.message}`
      : "";

    const msg =
      `${tag} ❌ 无法确认签到成功：签到前(${stateSummary(before)})` +
      (after ? `；签到后(${stateSummary(after)})` : "") +
      reason;

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

  for (const result of results) {
    console.log(result.msg);
  }

  const failures = results.filter(r => !r.success).length;

  if (failures > 0) {
    console.error(`::error::${failures}/${results.length} 个账号签到失败`);
    process.exitCode = 1;
  } else {
    console.log("✅ 所有账号均已确认今日签到");
    process.exitCode = 0;
  }
}

main().catch(error => {
  console.error(`::error::未处理异常：${error.message}`);
  process.exitCode = 1;
});
