import { analyzeScreenshot } from "./analysis.mjs";

const maxImageSize = 6 * 1024 * 1024;
const maxBodySize = maxImageSize + 64 * 1024;
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function matchesImageType(bytes, type) {
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

async function readForm(request) {
  if (!request.body) throw new Error("empty");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodySize) {
        await reader.cancel();
        throw new RangeError("size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": request.headers.get("content-type") ?? "" },
  }).formData();
}

export function createHandler({ analyze = analyzeScreenshot } = {}) {
  return async function handler(request) {
    if (new URL(request.url).pathname !== "/api/analyze") return jsonError("Страница не найдена.", 404);
    if (request.method !== "POST") {
      const response = jsonError("Для анализа загрузите скриншот.", 405);
      response.headers.set("Allow", "POST");
      return response;
    }
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return jsonError("Запрос с другого сайта запрещён.", 403);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      return jsonError("Загрузите изображение PNG, JPEG или WebP.", 415);
    }
    if (Number(request.headers.get("content-length")) > maxBodySize) return jsonError("Изображение слишком большое. Выберите файл меньшего размера.", 413);

    let form;
    try {
      form = await readForm(request);
    } catch (error) {
      return jsonError(error instanceof RangeError ? "Изображение слишком большое." : "Не удалось прочитать изображение. Загрузите его снова.", error instanceof RangeError ? 413 : 400);
    }
    const file = form.get("image");
    const context = form.get("context") ?? "";
    if (!(file instanceof File) || !allowedTypes.has(file.type)) return jsonError("Поддерживаются PNG, JPEG и WebP.", 415);
    if (file.size === 0 || file.size > maxImageSize) return jsonError("Нужен непустой файл размером до 6 МБ после подготовки.", 413);
    if (typeof context !== "string" || context.length > 1500) return jsonError("Комментарий должен быть не длиннее 1500 символов.", 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!matchesImageType(bytes, file.type)) return jsonError("Формат файла не соответствует изображению. Выберите другой скриншот.", 415);

    const abort = new AbortController();
    const onAbort = () => abort.abort();
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) abort.abort();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = value => {
          if (!abort.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        };
        // Send headers immediately and keep slow vision requests open on Netlify Server.
        send({ type: "status" });
        const heartbeat = setInterval(() => send({ type: "status" }), 8000);
        try {
          const result = await analyze({ type: file.type, bytes }, context.trim(), abort.signal);
          if (result.isGameScreenshot) send({ type: "result", analysis: result });
          else send({ type: "error", message: `Не удалось разобрать игровое поле. ${result.summary}` });
        } catch (error) {
          console.error("AI analysis failed", {
            status: Number.isInteger(error?.status) ? error.status : undefined,
            category: error instanceof SyntaxError ? "invalid-json" : error?.name === "Error" ? "analysis-error" : "provider-error",
          });
          const limited = error?.status === 429;
          send({ type: "error", message: limited
            ? "Сервис ИИ сейчас перегружен или достигнут лимит запросов. Попробуйте позже."
            : "Не удалось получить анализ от ИИ. Повторите попытку через минуту." });
        } finally {
          clearInterval(heartbeat);
          request.signal.removeEventListener("abort", onAbort);
          if (!abort.signal.aborted) controller.close();
        }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

export default createHandler();
export const config = { path: "/api/*" };
