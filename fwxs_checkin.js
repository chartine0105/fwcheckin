/*
 * 废文网(SosadFun) 自动签到脚本 (带 GitHub Actions 微信/邮件提醒版)
 * ------------------------------------------------------------
 * 环境变量:
 *   fwxs = 浏览器登录废文网后的完整 Cookie
 *   PUSHPLUS_TOKEN = (可选) 用于微信接收失败提醒
 */
const BASE = "https://xn--pxtr7m.net"; // 废文.net
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function stripTags(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

async function reqText(url, cookie, method = "GET") {
  const resp = await fetch(url, {
    method,
    headers: { Cookie: cookie, "User-Agent": UA, Accept: "text/html" },
    redirect: "manual",
  });
  const buf = Buffer.from(await resp.arrayBuffer());
  return { status: resp.status, loc: resp.headers.get("location") || "", text: buf.toString("utf8") };
}

function findUserId(html) {
  const m = html.match(/\/users\/(\d+)\/usercenter/);
  return m ? m[1] : null;
}

function parseState(html) {
  const t = stripTags(html);
  const num = (re) => {
    const m = t.match(re);
    return m ? parseInt(m[1], 10) : null;
  };
  const total = num(/总签到：(\d+)/);
  const cont = num(/连续签到：(\d+)/);
  let latest = null;
  const li = t.indexOf("最新签到：");
  if (li >= 0) latest = t.slice(li + 5, li + 5 + 24).split(/连续|补签|盐度|总签到|答题|注册|时间/)[0].trim();
  return { total, cont, latest };
}

async function runOne(cookie, label) {
  const tag = `【废文】${label}`;
  try {
    const home = await reqText(BASE + "/", cookie);
    const uid = findUserId(home.text);
    if (!uid) {
      console.log(`${tag} ❌ Cookie 无效或已过期（未登录）`);
      return { success: false, msg: `${tag} ❌ Cookie 失效` }; // 标记失败
    }
    const ucUrl = `${BASE}/users/${uid}/usercenter`;
    const before = parseState((await reqText(ucUrl, cookie)).text);

    const q = await reqText(BASE + "/qiandao", cookie);

    const after = parseState((await reqText(ucUrl, cookie)).text);

    let result;
    if (before.total != null && after.total != null && after.total > before.total) {
      result = `${tag} ✅ 签到成功  连续${after.cont}天 / 总${after.total}天`;
    } else if (
      after.latest && /秒|分|刚|just|second|minute|hour/i.test(after.latest) &&
      before.total === after.total && after.total != null
    ) {
      result = `${tag} ☑️ 今日已签到  连续${after.cont}天 / 总${after.total}天（最新：${after.latest}）`;
    } else {
      result = `${tag} ⚠️ 状态未变（HTTP ${q.status}）连续${after.cont}天 / 总${after.total}天（最新：${after.latest}）`;
    }
    console.log(result);
    return { success: true, msg: result };
  } catch (e) {
    const msg = `${tag} ❌ 异常：${e.message}`;
    console.log(msg);
    return { success: false, msg: msg }; // 标记异常失败
  }
}

// 发送通知（支持 PushPlus 和 青龙）
async function pushNotify(title, content) {
  try {
    // 1. 青龙面板支持
    if (typeof QLAPI !== "undefined" && QLAPI.systemNotify) {
      await QLAPI.systemNotify({ title, content });
    }
    // 2. PushPlus (微信推送)
    const pushToken = process.env.PUSHPLUS_TOKEN;
    if (pushToken) {
      await fetch("http://www.pushplus.plus/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pushToken, title: title, content: content })
      });
    }
  } catch (e) {
    console.log("通知发送失败(可忽略):", e.message);
  }
}

(async () => {
  const raw = process.env.fwxs || ""; // 注意：原作者要求变量名是小写的 fwxs，你 Secret 名字别填错
  if (!raw.trim()) {
    console.log("❌ 未配置环境变量 fwxs");
    process.exit(1);
  }
  const accounts = raw.split("@").map((s) => s.trim()).filter(Boolean);
  console.log(`共 ${accounts.length} 个账号`);
  
  const results = [];
  let hasError = false; // 用来记录是否有账号失败了

  for (let i = 0; i < accounts.length; i++) {
    const parts = accounts[i].split("#");
    const cookie = parts[0].trim();
    const label = (parts[1] || `账号${i + 1}`).trim();
    const res = await runOne(cookie, label);
    
    if (!res.success) hasError = true; // 只要有一个失败，就标记
    results.push(res.msg);
  }

  const finalMsg = results.join("\n");
  await pushNotify("废文网签到", finalMsg);

  // 核心改动：如果有任何一个账号失败，让 GitHub Actions 报错变红，触发邮件提醒！
  if (hasError) {
    console.log("::error::检测到签到失败或 Cookie 过期，请及时检查！");
    process.exit(1); 
  }
})();
