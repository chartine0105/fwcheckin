
const BASE = "https://gongzicp.com";
const COOKIE_NAMES = ["c_n", "c_n_n__c", "WBKFRo"];

function parseCookies(raw) {
  const result = [];

  for (const item of raw.split(";")) {
    const index = item.indexOf("=");
    if (index < 1) continue;

    const name = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();

    if (COOKIE_NAMES.includes(name) && value) {
      result.push(`${name}=${value}`);
    }
  }

  return result;
}

async function main() {
  const raw = process.env.GZCP_PERSISTENT_COOKIES || "";
  const cookies = parseCookies(raw);

  const missing = COOKIE_NAMES.filter(
    name => !cookies.some(item => item.startsWith(`${name}=`))
  );

  if (missing.length) {
    throw new Error(`缺少长期 Cookie：${missing.join(", ")}`);
  }

  console.log("已读取三个长期 Cookie。");
  console.log("开始测试网站会话恢复……");

  const response = await fetch(`${BASE}/user/home`, {
    method: "GET",
    headers: {
      "Cookie": cookies.join("; "),
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html,application/xhtml+xml",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });

  const html = await response.text();

  const setCookies = response.headers.getSetCookie?.() || [];

  const newCookieNames = setCookies.map(item =>
    item.split(";")[0].split("=")[0]
  );

  console.log("HTTP 状态：", response.status);
  console.log("是否跳转：", response.status >= 300 &&
    response.status < 400);
  console.log("是否返回登录页面：",
    /login|登录|account_login/i.test(html)
  );
  console.log("服务器设置的新 Cookie 名称：",
    [...new Set(newCookieNames)].join(", ") || "无"
  );

  console.log(
    "注意：返回网页不等于已登录，必须通过 getSignDate 验证。"
  );
}

main().catch(error => {
  console.error("测试失败：", error.message);
  process.exitCode = 1;
});
