export type Analysis = {
  isGameScreenshot: boolean;
  summary: string;
  economy: string;
  threats: string;
  bestMove: string;
  threeTurnPlan: [string, string, string];
  uncertainties: string[];
};

export const allowedImageTypes = ["image/png", "image/jpeg", "image/webp"];
export const maxUploadSize = 15 * 1024 * 1024;
const maxSendSize = 6 * 1024 * 1024;
const maxSide = 1920;

const unavailableMessage = "Сервис анализа недоступен. Повторите попытку позже.";

const extensionTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Some mobile browsers report an empty MIME type; fall back to the file extension. */
export function normalizeImageFile(file: File): File | null {
  if (allowedImageTypes.includes(file.type)) return file;
  if (file.type) return null;
  const type = extensionTypes[file.name.split(".").pop()?.toLowerCase() ?? ""];
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : null;
}

function loadImage(file: Blob): Promise<{ image: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ image: img, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось открыть изображение. Файл повреждён или формат не поддерживается браузером."));
    };
    img.src = url;
  });
}

function encode(image: HTMLImageElement, scale: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Браузер не смог подготовить скриншот. Попробуйте другой браузер."));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Браузер не смог подготовить скриншот. Попробуйте другой файл.")), "image/jpeg", quality);
  });
}

async function prepareImage(file: File): Promise<Blob> {
  const { image, release } = await loadImage(file);
  try {
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Изображение пустое. Выберите другой скриншот.");
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && file.size <= maxSendSize) return file;
    for (const quality of [0.92, 0.8, 0.65]) {
      const blob = await encode(image, scale, quality);
      if (blob.size <= maxSendSize) return blob;
    }
    throw new Error("Не удалось уменьшить скриншот до 6 МБ. Выберите изображение меньшего размера.");
  } finally {
    release();
  }
}

/** Small JPEG preview stored in local history (blob: URLs do not survive a reload). */
export async function createThumbnail(file: File): Promise<string> {
  const { image, release } = await loadImage(file);
  try {
    const scale = Math.min(1, 240 / Math.max(image.naturalWidth, image.naturalHeight));
    const blob = await encode(image, scale, 0.7);
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Не удалось сохранить миниатюру."));
      reader.readAsDataURL(blob);
    });
  } finally {
    release();
  }
}

function isAnalysis(value: unknown): value is Analysis {
  const v = value as Analysis | null;
  return !!v && typeof v === "object" && typeof v.summary === "string" && typeof v.economy === "string"
    && typeof v.threats === "string" && typeof v.bestMove === "string"
    && Array.isArray(v.threeTurnPlan) && v.threeTurnPlan.length === 3 && Array.isArray(v.uncertainties);
}

/** Reads the NDJSON stream from /api/analyze: `status` events, then one `result` or `error`. */
export async function readAnalysisStream(body: ReadableStream<Uint8Array>): Promise<Analysis> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error("Соединение с сервером прервалось во время анализа. Проверьте интернет и повторите попытку.");
      }
      const { value, done } = chunk;
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: { type?: string; message?: unknown; analysis?: unknown };
        try {
          event = JSON.parse(line);
        } catch {
          throw new Error("Сервер прислал повреждённый ответ. Повторите попытку.");
        }
        if (event.type === "error") {
          throw new Error(typeof event.message === "string" && event.message ? event.message : "Не удалось выполнить анализ. Повторите попытку.");
        }
        if (event.type === "result") {
          if (!isAnalysis(event.analysis)) throw new Error("Сервер прислал неполный анализ. Повторите попытку.");
          return event.analysis;
        }
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  throw new Error("Анализ прервался до получения результата. Повторите попытку.");
}

function httpErrorMessage(status: number): string {
  if (status === 404) {
    return import.meta.env?.DEV
      ? "Сервер анализа не найден. Запустите проект командой «npx netlify dev --port 8889», а не «npm run dev»."
      : unavailableMessage;
  }
  if (status === 413) return "Изображение слишком большое. Выберите файл меньшего размера.";
  if (status === 415) return "Поддерживаются только изображения PNG, JPEG и WebP.";
  if (status === 429) return "Слишком много запросов. Подождите минуту и повторите попытку.";
  if (status >= 500) return "Сервер анализа временно недоступен. Повторите попытку через минуту.";
  return unavailableMessage;
}

export async function requestAnalysis(file: File, context: string, signal: AbortSignal): Promise<Analysis> {
  const image = await prepareImage(file);
  signal.throwIfAborted();
  const form = new FormData();
  form.append("image", image, image === file ? file.name : "screenshot.jpg");
  form.append("context", context);

  let response: Response;
  try {
    response = await fetch("/api/analyze", { method: "POST", body: form, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("Нет связи с сервером анализа. Проверьте подключение к интернету и повторите попытку.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(typeof data?.error === "string" ? data.error : httpErrorMessage(response.status));
  }
  if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
    throw new Error(httpErrorMessage(404));
  }
  return readAnalysisStream(response.body);
}
