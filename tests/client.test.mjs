import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeImageFile, readAnalysisStream } from "../src/analysis.ts";

const analysis = {
  isGameScreenshot: true,
  summary: "Видны два города.",
  economy: "Доход не читается.",
  threats: "Рядом виден противник.",
  bestMove: "Прикройте город.",
  threeTurnPlan: ["Шаг 1.", "Шаг 2.", "Шаг 3."],
  uncertainties: [],
};

function streamOf(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

test("parses NDJSON split across chunks, including multibyte characters split mid-byte", async () => {
  const line = `${JSON.stringify({ type: "status" })}\n${JSON.stringify({ type: "result", analysis })}\n`;
  const bytes = new TextEncoder().encode(line);
  const cut = bytes.indexOf(0xd0, 30) + 1; // split inside a Cyrillic character
  assert.deepEqual(await readAnalysisStream(streamOf([bytes.slice(0, cut), bytes.slice(cut)])), analysis);
});

test("accepts a final line without trailing newline", async () => {
  assert.deepEqual(await readAnalysisStream(streamOf([`{"type":"status"}\n${JSON.stringify({ type: "result", analysis })}`])), analysis);
});

test("reports server error events, broken JSON, incomplete results and early end in Russian", async () => {
  await assert.rejects(readAnalysisStream(streamOf(['{"type":"error","message":"Лимит запросов."}\n'])), /Лимит запросов/);
  await assert.rejects(readAnalysisStream(streamOf(['{"type":"status"}\n{broken\n'])), /повреждённый ответ/);
  await assert.rejects(readAnalysisStream(streamOf(['{"type":"result","analysis":{"summary":"x"}}\n'])), /неполный анализ/);
  await assert.rejects(readAnalysisStream(streamOf(['{"type":"status"}\n'])), /прервался/);
});

test("reports a dropped connection in Russian and cancels the stream when done", async () => {
  let cancelled = false;
  const failing = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"status"}\n')); },
    pull(controller) { controller.error(new TypeError("network error")); },
  });
  await assert.rejects(readAnalysisStream(failing), /Соединение с сервером прервалось/);
  const open = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "result", analysis })}\n`)); },
    cancel() { cancelled = true; },
  });
  await readAnalysisStream(open);
  assert.equal(cancelled, true);
});

test("infers image type from the extension when the browser reports none", () => {
  assert.equal(normalizeImageFile(new File(["x"], "shot.PNG", { type: "" })).type, "image/png");
  assert.equal(normalizeImageFile(new File(["x"], "shot.jpg", { type: "image/jpeg" })).type, "image/jpeg");
  assert.equal(normalizeImageFile(new File(["x"], "shot.heic", { type: "image/heic" })), null);
  assert.equal(normalizeImageFile(new File(["x"], "notes.txt", { type: "" })), null);
});
