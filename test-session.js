
const BASE = "https://gongzicp.com";

async function main() {
  const cookie = process.env.GZCP_PERSISTENT_COOKIES;

  if (!cookie) {
    throw new Error("缺少 GZCP_PERSISTENT_COOKIES");
  }

  console.log("开始测试长期 Cookie 是否能恢复 API 登录……");

  const response = await fetch(
    `${BASE}/webapi/user/getSignDate`,
    {
      method: "GET",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "client": "pc",
        "Referer": `${BASE}/user/home`,
        "User-Agent": "Mozilla/5.0",
        "Cookie": cookie
      },
      signal: AbortSignal.timeout(20000)
    }
  );

  const text = await response.text();

  console.log("HTTP 状态：", response.status);

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    console.log("接口没有返回 JSON。");
    console.log("响应内容类型：", response.headers.get("content-type"));
    throw new Error("无法解析接口响应");
  }

  console.log("业务状态码：", data.code);
  console.log("业务提示：", data.msg || "无");

  if (data.code === 200) {
    console.log("测试成功：长期 Cookie 可以直接访问签到状态接口。");
    console.log("返回数据结构：", Object.keys(data.data || {}).join(", "));
  } else {
    console.log("测试未通过：长期 Cookie 尚不能独立访问签到接口。");
  }
}

main().catch(error => {
  console.error("测试异常：", error.message);
  process.exitCode = 1;
});
