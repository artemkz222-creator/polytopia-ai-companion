import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeScreenshot, validateAnalysis } from "./analysis.mjs";
import { createHandler } from "./index.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const analysis = {
  isGameScreenshot: true,
  summary: "Видны два города.",
  economy: "Доход не читается. Уточните число звёзд.",
  threats: "Рядом с городом виден противник.",
  bestMove: "Если доступен свободный воин, прикройте город.",
  threeTurnPlan: ["Прикройте город.", "Разведайте окрестности.", "Оцените возможность расширения."],
  uncertainties: ["Не видны изученные технологии."],
};

function request({ image = png, type = "image/png", context = "", ...options } = {}) {
  const form = new FormData();
  form.set("image", new Blob([image], { type }), "screenshot.png");
  form.set("context", context);
  return new Request("https://example.com/api/analyze", { method: "POST", body: form, ...options });
}

async function events(response) {
  return (await response.text()).trim().split("\n").map(line => JSON.parse(line));
}

test("rejects invalid methods and routes without calling AI", async () => {
  const handler = createHandler({ analyze: () => assert.fail("AI must not be called") });
  const response = await handler(new Request("https://example.com/api/analyze"));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.equal((await handler(new Request("https://example.com/api/missing"))).status, 404);
});

test("rejects cross-origin requests, unsupported files, spoofed image types and oversized comments", async () => {
  const handler = createHandler({ analyze: () => assert.fail("AI must not be called") });
  assert.equal((await handler(request({ headers: { Origin: "https://another.example" } }))).status, 403);
  assert.equal((await handler(request({ type: "image/svg+xml" }))).status, 415);
  assert.equal((await handler(request({ image: Buffer.from("not a PNG") }))).status, 415);
  assert.equal((await handler(request({ image: Buffer.alloc(0) }))).status, 413);
  assert.equal((await handler(request({ context: "a".repeat(1501) }))).status, 400);
});

test("bounds body size even without a Content-Length header", async () => {
  const handler = createHandler({ analyze: () => assert.fail("AI must not be called") });
  const response = await handler(request({ image: Buffer.alloc(7 * 1024 * 1024) }));
  assert.equal(response.status, 413);
});

test("returns malformed multipart and unsupported content as useful errors", async () => {
  const handler = createHandler({ analyze: () => assert.fail("AI must not be called") });
  assert.equal((await handler(new Request("https://example.com/api/analyze", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }))).status, 415);
  assert.equal((await handler(new Request("https://example.com/api/analyze", { method: "POST", body: "invalid", headers: { "Content-Type": "multipart/form-data; boundary=test" } }))).status, 400);
});

test("streams initial status before AI finishes and returns analysis with the supplied image and context", async () => {
  let finish;
  const handler = createHandler({ analyze: async (image, context) => {
    assert.equal(image.type, "image/png");
    assert.deepEqual(image.bytes, png);
    assert.equal(context, "Бардур, 8-й ход");
    return new Promise(resolve => { finish = resolve; });
  } });
  const response = await handler(request({ context: "  Бардур, 8-й ход  " }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const reader = response.body.getReader();
  assert.deepEqual(JSON.parse(new TextDecoder().decode((await reader.read()).value)), { type: "status" });
  finish(analysis);
  assert.deepEqual(JSON.parse(new TextDecoder().decode((await reader.read()).value)), { type: "result", analysis });
  assert.equal((await reader.read()).done, true);
});

test("does not present tactical advice for unrelated images", async () => {
  const handler = createHandler({ analyze: async () => ({ ...analysis, isGameScreenshot: false, summary: "На изображении нет игрового поля." }) });
  const output = await events(await handler(request()));
  assert.equal(output.at(-1).type, "error");
  assert.match(output.at(-1).message, /нет игрового поля/);
  assert.equal(output.some(event => event.type === "result"), false);
});

test("handles provider errors and rate limits without exposing upstream diagnostics", async () => {
  for (const status of [429, 500]) {
    const handler = createHandler({ analyze: async () => { throw Object.assign(new Error("private upstream diagnostic"), { status }); } });
    const output = await events(await handler(request()));
    assert.equal(output.at(-1).type, "error");
    assert.doesNotMatch(JSON.stringify(output), /private upstream diagnostic/);
    assert.match(output.at(-1).message, status === 429 ? /лимит/ : /Повторите попытку/);
  }
});

test("cancelling the response aborts the provider request", async () => {
  let providerSignal;
  const handler = createHandler({ analyze: async (_image, _context, signal) => {
    providerSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  } });
  const response = await handler(request());
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(providerSignal.aborted, true);
});

test("sends real image content to the vision model with a strict output schema", async () => {
  const signal = new AbortController().signal;
  const client = { chat: { completions: { create: async (payload, options) => {
    assert.equal(payload.model, "gpt-4.1-mini");
    assert.equal(payload.response_format.json_schema.strict, true);
    assert.equal(payload.messages[1].content[1].image_url.url, `data:image/png;base64,${png.toString("base64")}`);
    assert.match(payload.messages[1].content[0].text, /Бардур/);
    assert.equal(options.signal, signal);
    assert.equal(options.maxRetries, 0);
    return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(analysis) } }] };
  } } } };
  assert.deepEqual(await analyzeScreenshot({ type: "image/png", bytes: png }, "Бардур", signal, client), analysis);
});

test("rejects incomplete, refused, malformed and empty model output", async () => {
  for (const choice of [
    { finish_reason: "length", message: { content: JSON.stringify(analysis) } },
    { finish_reason: "stop", message: { refusal: "Cannot analyze", content: null } },
    { finish_reason: "stop", message: { content: "{}" } },
    { finish_reason: "stop", message: { content: "not JSON" } },
  ]) {
    const client = { chat: { completions: { create: async () => ({ choices: [choice] }) } } };
    await assert.rejects(analyzeScreenshot({ type: "image/png", bytes: png }, "", new AbortController().signal, client));
  }
  assert.equal(validateAnalysis(analysis), true);
  assert.equal(validateAnalysis({ ...analysis, bestMove: "" }), false);
  assert.equal(validateAnalysis({ ...analysis, threeTurnPlan: ["one"] }), false);
});
