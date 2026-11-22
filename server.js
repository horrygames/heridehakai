// ヘリde破壊 世界ランキング用サーバー v2（Supabase保存版・追加ライブラリなし）
// 使い方: node server.js  （Renderでは自動でこの形で起動する）
// 保存先:
//   Renderの環境変数 SUPABASE_URL と SUPABASE_SERVICE_KEY が設定されていれば
//   Supabase（Postgres）に保存する。Renderが再起動しても記録は消えない。
//   未設定なら今まで通り data.json に保存する（フォールバック）。
// API（v1と互換）:
//   GET  /api/ranking?limit=100  -> { entries: [...], total: 件数 }
//   POST /api/ranking {nickname, score, yen, stage} -> { id, rank, total }
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 10000;
const DATA_FILE = path.join(__dirname, "data.json");
const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const USE_SB = !!(SB_URL && SB_KEY);

/* ---------- ファイル保存（フォールバック） ---------- */
function fileLoad() {
  try {
    const rows = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}
function fileSave(rows) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), "utf8");
}

/* ---------- Supabase保存 ---------- */
function sbHeaders(extra) {
  return Object.assign(
    {
      apikey: SB_KEY,
      Authorization: "Bearer " + SB_KEY,
      "Content-Type": "application/json",
    },
    extra || {}
  );
}
async function sbCount(query) {
  // PostgRESTの件数取得: HEAD + Prefer: count=exact で Content-Range に総件数が返る
  const res = await fetch(SB_URL + "/rest/v1/scores?select=id" + (query ? "&" + query : ""), {
    method: "HEAD",
    headers: sbHeaders({ Prefer: "count=exact" }),
  });
  const range = res.headers.get("content-range") || "";
  const total = parseInt(range.split("/")[1], 10);
  return isFinite(total) ? total : 0;
}
async function sbGetRanking(limit) {
  const q =
    "select=id,nickname,score,yen,stage,created_at&order=score.desc,id.asc&limit=" + limit;
  const res = await fetch(SB_URL + "/rest/v1/scores?" + q, { headers: sbHeaders() });
  if (!res.ok) throw new Error("supabase get failed: " + res.status);
  const entries = await res.json();
  let total = entries.length;
  try {
    total = await sbCount("");
  } catch (e) {}
  return { entries, total };
}
async function sbSubmit(nickname, score, yen, stage) {
  const res = await fetch(SB_URL + "/rest/v1/scores", {
    method: "POST",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ nickname, score, yen, stage }),
  });
  if (!res.ok) throw new Error("supabase post failed: " + res.status);
  const rows = await res.json();
  const entry = rows[0];
  if (!entry) throw new Error("supabase post: no row returned");
  const above =
    (await sbCount("score=gt." + score)) +
    (await sbCount("score=eq." + score + "&id=lt." + entry.id));
  const total = await sbCount("");
  return { id: entry.id, rank: above + 1, total };
}

/* ---------- HTTPサーバー ---------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (url.pathname === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(
      "ヘリde破壊 ランキングサーバーは動いてるよ（保存先: " + (USE_SB ? "Supabase" : "ファイル") + "）"
    );
  }

  if (url.pathname === "/api/ranking" && req.method === "GET") {
    let limit = parseInt(url.searchParams.get("limit") || "50", 10);
    if (!isFinite(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100;
    try {
      if (USE_SB) return sendJson(res, 200, await sbGetRanking(limit));
      const rows = fileLoad().slice().sort((a, b) => b.score - a.score || a.id - b.id);
      return sendJson(res, 200, { entries: rows.slice(0, limit), total: rows.length });
    } catch (e) {
      return sendJson(res, 500, { error: "server error" });
    }
  }

  if (url.pathname === "/api/ranking" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 100000) req.destroy();
    });
    req.on("end", async () => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        return sendJson(res, 400, { error: "bad json" });
      }
      const nickname = String(data.nickname || "").trim().slice(0, 12);
      const score = Math.floor(Number(data.score));
      const yen = Math.floor(Number(data.yen));
      const stage = String(data.stage || "").trim().slice(0, 20);
      if (
        !nickname || !stage || !isFinite(score) || !isFinite(yen) ||
        score < 0 || score > 100000000 || yen < 0 || yen > 100000000000
      ) {
        return sendJson(res, 400, { error: "invalid score" });
      }
      try {
        if (USE_SB) return sendJson(res, 200, await sbSubmit(nickname, score, yen, stage));
        const rows = fileLoad();
        const entry = {
          id: rows.reduce((m, r) => Math.max(m, r.id), 0) + 1,
          nickname, score, yen, stage,
          created_at: new Date().toISOString(),
        };
        rows.push(entry);
        fileSave(rows);
        const rank =
          rows.filter((r) => r.score > score || (r.score === score && r.id < entry.id)).length + 1;
        return sendJson(res, 200, { id: entry.id, rank, total: rows.length });
      } catch (e) {
        return sendJson(res, 500, { error: "server error" });
      }
    });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, () =>
  console.log("ranking server listening on " + PORT + " (storage: " + (USE_SB ? "supabase" : "file") + ")")
);
