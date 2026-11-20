// 카이와 놀이터 점수 저장 함수 (Netlify Functions + Netlify Blobs)
//   GET    ?room=ABCD            해당 수업의 점수 목록
//   POST   {room,team,name,sc}   점수 저장 (같은 번호는 덮어쓰기)
//   DELETE ?room=ABCD&team=7     참가자 하나 삭제 (team을 빼면 수업 전체 삭제)
// Netlify 환경 변수 TEACHER_PIN 을 만들면 삭제할 때 같은 비밀번호가 필요합니다.
import { getStore } from "@netlify/blobs";

const ROOM = /^[A-Z0-9]{3,8}$/;
const MAX_TEAMS = 150;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const pad2 = (n) => String(n).padStart(2, "0");
const cleanRoom = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

export function cleanBody(b) {
  if (!b || typeof b !== "object") return null;
  const room = cleanRoom(b.room);
  const team = Math.trunc(Number(b.team));
  const sc = Array.isArray(b.sc) ? b.sc.slice(0, 4).map((x) => Math.max(0, Math.min(999, Math.round(Number(x) || 0)))) : [];
  if (!ROOM.test(room) || !(team >= 1 && team <= 9999) || sc.length !== 4) return null;
  const name = String(b.name || "").replace(/[<>&"'`]/g, "").trim().slice(0, 10) || `참가자${team}`;
  return { room, team, name, sc };
}

async function readRoom(store, room) {
  const { blobs } = await store.list({ prefix: `${room}/` });
  const rows = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return rows.filter(Boolean).sort((a, b) => a.team - b.team);
}

export async function handle(req, store, env = {}) {
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const room = cleanRoom(url.searchParams.get("room"));
      if (!ROOM.test(room)) return json({ error: "수업 코드가 올바르지 않아요." }, 400);
      return json({ rows: await readRoom(store, room) });
    }
    if (req.method === "POST") {
      const data = cleanBody(await req.json().catch(() => null));
      if (!data) return json({ error: "보낸 내용이 올바르지 않아요." }, 400);
      const key = `${data.room}/${pad2(data.team)}`;
      const exists = await store.get(key);
      if (exists === null || exists === undefined) {
        const { blobs } = await store.list({ prefix: `${data.room}/` });
        if (blobs.length >= MAX_TEAMS) return json({ error: "이 수업 코드에는 더 이상 참가자를 추가할 수 없어요." }, 429);
      }
      await store.setJSON(key, { team: data.team, name: data.name, sc: data.sc, ts: Date.now() });
      return json({ ok: true });
    }
    if (req.method === "DELETE") {
      const pin = env.TEACHER_PIN;
      if (pin && req.headers.get("x-teacher-pin") !== pin) return json({ error: "선생님 비밀번호가 맞지 않아요." }, 401);
      const room = cleanRoom(url.searchParams.get("room"));
      if (!ROOM.test(room)) return json({ error: "수업 코드가 올바르지 않아요." }, 400);
      const team = url.searchParams.get("team");
      if (team) {
        await store.delete(`${room}/${pad2(Math.trunc(Number(team)))}`);
      } else {
        const { blobs } = await store.list({ prefix: `${room}/` });
        await Promise.all(blobs.map((b) => store.delete(b.key)));
      }
      return json({ ok: true });
    }
    return json({ error: "지원하지 않는 요청이에요." }, 405);
  } catch (e) {
    return json({ error: "서버에서 문제가 생겼어요." }, 500);
  }
}

export default async (req) => {
  const store = getStore({ name: "kaillois", consistency: "strong" });
  return handle(req, store, process.env);
};
