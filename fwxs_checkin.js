
/*
 * 废文网 (SosadFun) 自动签到脚本
 * GitHub Actions 失败状态检测版
 *
 * 环境变量：
 *   fwxs = 登录废文网后的完整 Cookie
 *
 * 多账号格式：
 *   Cookie1#账号1@Cookie2#账号2
 *
 * 说明：
 *   1. Cookie 失效或请求异常：失败
 *   2. 签到次数增加：成功
 *   3. 能确认今日已签到：成功
 *   4. 无法确认签到结果：失败
 *   5. 任意账号失败，进程最终以非零状态退出
 */

const BASE = "https://xn--pxtr7m.net";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0 Safari/537.36";

function stripTags(s) {
  return s
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function reqText(url, cookie, method = "GET") {
  const resp = await fetch(url, {
    method,
    headers: {
      Cookie: cookie,
      "User-Agent": UA,
      Accept: "text/html",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });

  const buf = Buffer.from(await resp.arrayBuffer());

  return {
    status: resp.status,
    loc: resp.headers.get("location") || "",
    text: buf.toString("utf8"),
  };
}

// 从 HTML 中提取用户 ID
function findUserId(html) {
  const m = html.match(/\/users\/(\d+)\/usercenter/i);
  return m ? m[1] : null;
}

// 解析个人中心的签到状态
function parseState(html) {
  const t = stripTags(html);

  const num = (re) => {
    const m = t.match(re);
    return m ? Number.parseInt(m[1], 10) : null;
  };

  const total = num(/总签到\s*[：:]\s*(\d+)/);
  const cont = num(/连续签到\s*[：:]\s*(\d+)/);

  let latest = null;

  const li = t.indexOf("最新签到：");
  const li2 = t.indexOf("最新签到:");

  const pos = li >= 0 ? li : li2;

  if (pos >= 0) {
    latest = t
      .slice(pos + 5, pos + 100)
      .split(/连续|补签|盐度|总签到|答题|注册|时间/)
      [0]
      .trim();
  }

  return { total, cont, latest };
}

// 判断页面是否明显是登录页面
function looksLikeLoginPage(html) {
  return (
    /type\s*=\s*["']password["']/i.test(html) &&
    /登录|登陆|login/i.test(stripTags(html))
  );
}

function isRedirectToLogin(loc) {
  return /login|signin|sign-in/i.test(loc);
}

// 对单个账号执行签到
async function runOne(cookie, label) {
  const tag = `【废文】${label}`;

  try {
    if (!cookie || !cookie.trim()) {
      throw new Error("Cookie 为空");
    }

    // 1. 检查首页和登录状态
    const home = await reqText(BASE + "/", cookie);

    if (home.status < 200 || home.status >= 400) {
      throw new Error(`首页请求失败，HTTP ${home.status}`);
    }

    const uid = findUserId(home.text);

    if (!uid || looksLikeLoginPage(home.text)) {
      throw new Error("Cookie 无效、已过期，或未能识别登录状态");
    }

    const ucUrl = `${BASE}/users/${uid}/usercenter`;

    // 2. 获取签到前状态
    const beforeResp = await reqText(ucUrl, cookie);

    if (
      beforeResp.status < 200 ||
      beforeResp.status >= 300 ||
      isRedirectToLogin(beforeResp.loc) ||
      !findUserId(beforeResp.text)
    ) {
      throw new Error(
        `无法读取个人中心，HTTP ${beforeResp.status}`
      );
    }

    const before = parseState(beforeResp.text);

    if (before.total === null) {
      throw new Error("无法解析签到前的总签到次数，页面格式可能已变化");
    }

    console.log(
      `${tag} 签到前：总签到=${before.total}，连续签到=${before.cont}`
    );

    // 3. 请求签到接口
    const q = await reqText(BASE + "/qiandao", cookie);

    console.log(
      `${tag} 签到请求：HTTP ${q.status}，跳转=${q.loc || "无"}`
    );

    // 4. 重新读取个人中心，验证结果
    const afterResp = await reqText(ucUrl, cookie);

    if (
      afterResp.status < 200 ||
      afterResp.status >= 300 ||
      isRedirectToLogin(afterResp.loc) ||
      !findUserId(afterResp.text)
    ) {
      throw new Error(
        `签到后无法读取个人中心，HTTP ${afterResp.status}`
      );
    }

    const after = parseState(afterResp.text);

    if (after.total === null) {
      throw new Error("无法解析签到后的总签到次数");
    }

    // 5. 总签到次数增加，视为签到成功
    if (after.total > before.total) {
      const msg =
        `${tag} ✅ 签到成功：连续${after.cont ?? "未知"}天` +
        ` / 总${after.total}天`;

      console.log(msg);
      return { success: true, msg };
    }

    // 6. 次数没有增加：不能仅凭模糊文本认定成功
    // 需要在此处依据网站实际 HTML 确认“今日已签到”的可靠标志。
    //
    // 当前无法可靠确认时，宁可报告失败，也不假报成功。
    const msg =
      `${tag} ❌ 无法确认签到成功：` +
      `总签到${before.total} -> ${after.total}，` +
      `签到请求HTTP ${q.status}，` +
      `最新签到=${after.latest ?? "未知"}`;

    console.log(msg);

    return { success: false, msg };
  } catch (e) {
    const msg = `${tag} ❌ 异常：${e.message}`;
    console.log(msg);
    return { success: false, msg };
  }
}

// 主程序
async function main() {
  const raw = process.env.fwxs || "";

  if (!raw.trim()) {
    console.error("❌ 未配置环境变量 fwxs");
    process.exitCode = 1;
    return;
  }

  const accounts = raw
    .split("@")
    .map((s) => s.trim())
    .filter(Boolean);

  if (accounts.length === 0) {
    console.error("❌ 没有可执行的账号");
    process.exitCode = 1;
    return;
  }

  console.log(`共 ${accounts.length} 个账号`);

  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const parts = accounts[i].split("#");
    const cookie = parts[0].trim();
    const label = (parts[1] || `账号${i + 1}`).trim();

    const res = await runOne(cookie, label);
    results.push(res);
  }

  console.log("\n========= 最终结果 =========");

  for (const res of results) {
    console.log(res.msg);
  }

  const failures = results.filter((res) => !res.success);

  if (failures.length > 0) {
    console.error(
      `::error::${failures.length}/${results.length} 个账号签到失败或结果无法确认`
    );

    // 让 Node.js 以失败状态退出，触发 GitHub Actions 失败通知
    process.exitCode = 1;
  } else {
    console.log("✅ 所有账号均已确认签到成功");
    process.exitCode = 0;
  }
}

main().catch((e) => {
  console.error(`::error::签到程序发生未处理异常：${e.message}`);
  process.exitCode = 1;
});
