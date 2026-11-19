export type Analysis = {
  isGameScreenshot: boolean;
  summary: string;
  economy: string;
  threats: string;
  bestMove: string;
  threeTurnPlan: [string, string, string];
  uncertainties: string[];
};

async function prepareImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Не удалось открыть изображение. Выберите другой файл."));
      img.src = url;
    });
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && file.size <= 6 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Не удалось подготовить скриншот. Попробуйте другой браузер.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Не удалось подготовить скриншот.")), "image/jpeg", 0.92);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function requestAnalysis(file: File, context: string, signal: AbortSignal): Promise<Analysis> {
  const image = await prepareImage(file);
  signal.throwIfAborted();
  const form = new FormData();
  form.append("image", image, image.type === "image/jpeg" ? "screenshot.jpg" : file.name);
  form.append("context", context);
  const response = await fetch("/api/analyze", { method: "POST", body: form, signal });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? "Сервис анализа недоступен. Повторите попытку позже.");
  }
  if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
    throw new Error("Сервис анализа недоступен. Повторите попытку позже.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: Analysis | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      if (done && pending) lines.push(pending);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "result") result = event.analysis as Analysis;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!result) throw new Error("Анализ прервался. Повторите попытку.");
  return result;
}
