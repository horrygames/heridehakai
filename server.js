// ヘリde破壊 世界ランキング用サーバー（追加ライブラリなし・Nodeだけで動く）
// 使い方: node server.js  （Renderでは自動でこの形で起動する）
// API:
//   GET  /api/ranking?limit=100  -> { entries: [...], total: 件数 }
//   POST /api/ranking {nickname, score, yen, stage} -> { id, rank, total }
// 注意: 記録は data.json に保存する。Renderの無料枠は再起動・再デプロイで
// ファイルが消えることがあるので、ランキングがリセットされる場合があるよ。
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 10000;
const DATA_FILE = path.join(__dirname, "data.json");

function load() {
  try {
    const rows = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}
function save(rows) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), "utf8");
}

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

const server = http.createServer((req, res) => {
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
    return res.end("ヘリde破壊 ランキングサーバーは動いてるよ");
  }

  if (url.pathname === "/api/ranking" && req.method === "GET") {
    let limit = parseInt(url.searchParams.get("limit") || "50", 10);
    if (!isFinite(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100;
    const rows = load().slice().sort((a, b) => b.score - a.score || a.id - b.id);
    return sendJson(res, 200, { entries: rows.slice(0, limit), total: rows.length });
  }

  if (url.pathname === "/api/ranking" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 100000) req.destroy(); });
    req.on("end", () => {
      let data;
      try { data = JSON.parse(raw); } catch (e) { return sendJson(res, 400, { error: "bad json" }); }
      const nickname = String(data.nickname || "").trim().slice(0, 12);
      const score = Math.floor(Number(data.score));
      const yen = Math.floor(Number(data.yen));
      const stage = String(data.stage || "").trim().slice(0, 20);
      if (!nickname || !stage || !isFinite(score) || !isFinite(yen) ||
          score < 0 || score > 100000000 || yen < 0 || yen > 100000000000) {
        return sendJson(res, 400, { error: "invalid score" });
      }
      const rows = load();
      const entry = {
        id: rows.reduce((m, r) => Math.max(m, r.id), 0) + 1,
        nickname, score, yen, stage,
        created_at: new Date().toISOString(),
      };
      rows.push(entry);
      save(rows);
      const rank = rows.filter((r) => r.score > score || (r.score === score && r.id < entry.id)).length + 1;
      return sendJson(res, 200, { id: entry.id, rank, total: rows.length });
    });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log("ranking server listening on " + PORT));
