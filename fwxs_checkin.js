/*
 * 废文网(SosadFun) 自动签到脚本
 * ------------------------------------------------------------
 * 兼容：青龙面板 / 纯 Node.js(>=18) / GitHub Actions
 * 无需任何 npm 依赖（使用 Node 原生 fetch，Node 18+ 内置）
 *
 * 环境变量:
 *   fwxs = 浏览器登录废文网后的完整 Cookie
 *          多账号用 @ 分隔；每个 cookie 可用 #昵称 备注。
 *          例：  cookieA#张三@cookieB#李四
 *
 * 原理:
 *   签到接口是 web 路由 GET /qiandao（签到按钮北京时间早晨出现）。
 *   脚本请求该地址触发签到，再对比个人中心「总签到天数」判定结果，
 *   不依赖页面文案正则，稳定不易随站点改版而失效。
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

// 从任意页面 HTML 找到当前登录用户 id（导航栏 usercenter 链接）
function findUserId(html) {
  const m = html.match(/\/users\/(\d+)\/usercenter/);
  return m ? m[1] : null;
}

// 解析个人中心的签到状态
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
      return `${tag} ❌ Cookie 失效`;
    }
    const ucUrl = `${BASE}/users/${uid}/usercenter`;
    const before = parseState((await reqText(ucUrl, cookie)).text);

    // 触发签到（签到在服务端即刻完成，无需跟随跳转）
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
    return result;
  } catch (e) {
    const msg = `${tag} ❌ 异常：${e.message}`;
    console.log(msg);
    return msg;
  }
}

// 青龙通知（配置了通知渠道时自动推送；其它环境静默跳过）
async function pushNotify(title, content) {
  try {
    if (typeof QLAPI !== "undefined" && QLAPI.systemNotify) await QLAPI.systemNotify({ title, content });
  } catch (e) {
    console.log("通知发送失败(可忽略):", e.message);
  }
}

(async () => {
  const raw = process.env.fwxs || "";
  if (!raw.trim()) {
    console.log("❌ 未配置环境变量 fwxs");
    process.exit(1);
  }
  const accounts = raw.split("@").map((s) => s.trim()).filter(Boolean);
  console.log(`共 ${accounts.length} 个账号`);
  const results = [];
  for (let i = 0; i < accounts.length; i++) {
    const parts = accounts[i].split("#");
    const cookie = parts[0].trim();
    const label = (parts[1] || `账号${i + 1}`).trim();
    results.push(await runOne(cookie, label));
  }
  await pushNotify("废文网签到", results.join("\n"));
})();
