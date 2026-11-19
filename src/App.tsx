import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, Bot, CheckCircle2, Clock3, Coins,
  ImagePlus, LoaderCircle, Map, Save, Shield, Sparkles, Target, Trash2, Upload, X
} from "lucide-react";
import { requestAnalysis, type Analysis } from "./analysis";

type SavedScan = { id: string; name: string; date: string; url: string };

const tips = [
  { title: "Экономика", icon: Coins, text: "После распознавания скриншота здесь появится оценка дохода, расходов и приоритетов развития." },
  { title: "Угрозы", icon: Shield, text: "Здесь будут отмечаться вражеские юниты, опасные направления и уязвимые города." },
  { title: "Лучший следующий ход", icon: Target, text: "ИИ предложит конкретное действие, объяснит причину и ожидаемую пользу." },
  { title: "План на 3 хода", icon: Clock3, text: "Краткий план развития с учётом экономики, карты и ближайших угроз." }
];

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [history, setHistory] = useState<SavedScan[]>([]);
  const [message, setMessage] = useState("Загрузите скриншот игрового поля, чтобы начать.");
  const [context, setContext] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => { requestRef.current?.abort(); }, []);

  useEffect(() => {
    const saved = localStorage.getItem("polytopia-scans");
    if (saved) {
      try { setHistory(JSON.parse(saved) as SavedScan[]); } catch { /* ignore invalid local data */ }
    }
  }, []);

  useEffect(() => {
    return () => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); };
  }, [preview]);

  function selectFile(next: File | undefined) {
    if (!next) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(next.type)) {
      setError("Поддерживаются PNG, JPEG и WebP.");
      return;
    }
    if (next.size > 15 * 1024 * 1024) {
      setError("Файл слишком большой. Максимальный размер — 15 МБ.");
      return;
    }
    cancelAnalysis();
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setAnalysis(null);
    setError("");
    setMessage("Скриншот готов. Нажмите «Разобрать с ИИ».");
    if (inputRef.current) inputRef.current.value = "";
  }

  function cancelAnalysis() {
    requestRef.current?.abort();
    requestRef.current = null;
    setIsAnalyzing(false);
  }

  async function analyzeCurrent() {
    if (!file || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setIsAnalyzing(true);
    setAnalysis(null);
    setError("");
    setMessage("ИИ изучает карту и составляет план. Обычно это занимает до минуты.");
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
    try {
      const result = await requestAnalysis(file, context, controller.signal);
      if (requestRef.current !== controller) return;
      setAnalysis(result);
      setMessage("Анализ готов — рекомендации ниже.");
    } catch (reason) {
      if (requestRef.current !== controller) return;
      setError(timedOut ? "Анализ занял слишком много времени. Попробуйте ещё раз." : reason instanceof Error ? reason.message : "Не удалось выполнить анализ. Повторите попытку.");
      setMessage("Скриншот остаётся на экране. Можно повторить анализ.");
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsAnalyzing(false);
      }
    }
  }

  function saveToHistory() {
    if (!file || !preview) return;
    const item: SavedScan = {
      id: crypto.randomUUID(),
      name: file.name,
      date: new Date().toLocaleString("ru-RU"),
      url: preview
    };
    const next = [item, ...history].slice(0, 8);
    setHistory(next);
    localStorage.setItem("polytopia-scans", JSON.stringify(next));
    setMessage("Запись добавлена в историю на этом устройстве.");
  }

  function removeHistory(id: string) {
    const next = history.filter(item => item.id !== id);
    setHistory(next);
    localStorage.setItem("polytopia-scans", JSON.stringify(next));
  }

  function clearCurrent() {
    cancelAnalysis();
    setFile(null);
    setPreview("");
    setContext("");
    setAnalysis(null);
    setError("");
    setMessage("Загрузите скриншот игрового поля, чтобы начать.");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Polytopia AI Companion home">
          <span className="brand-mark"><Map size={21} /></span>
          <span><strong>POLYTOPIA</strong><small>AI COMPANION</small></span>
        </a>
        <span className="status"><span className="status-dot" /> Анализ с ИИ · 0.2</span>
      </header>

      <section className="hero">
        <div className="eyebrow"><Sparkles size={14} /> ПОМОЩНИК КОМАНДИРА</div>
        <h1>Продумай ход.<br /><em>Победи стратегически.</em></h1>
        <p>Загрузи снимок своей партии в The Battle of Polytopia — ИИ разберёт карту, оценит экономику и предложит следующие действия.</p>
      </section>

      <section className="upload-card">
        <div className="section-heading">
          <div><span className="step">01</span><h2>Игровой скриншот</h2></div>
          {preview && <button className="icon-button" onClick={clearCurrent} aria-label="Удалить текущий скриншот"><X size={18} /></button>}
        </div>
        {!preview ? (
          <button className="dropzone" onClick={() => inputRef.current?.click()}>
            <span className="upload-icon"><ImagePlus size={26} /></span>
            <strong>Загрузить скриншот</strong>
            <span>Нажми, чтобы выбрать изображение из Фото</span>
            <small>PNG, JPG или WebP · до 15 МБ</small>
          </button>
        ) : (
          <div className="preview-wrap">
            <img src={preview} alt="Загруженный скриншот игрового поля Polytopia" />
            <div className="preview-meta"><CheckCircle2 size={16} /> {file?.name}</div>
          </div>
        )}
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => selectFile(e.target.files?.[0])} />
        {preview && <div className="context-field">
          <label htmlFor="game-context">Что важно учесть <span>необязательно</span></label>
          <textarea id="game-context" maxLength={1500} rows={3} disabled={isAnalyzing} value={context} onChange={event => { setContext(event.target.value); setAnalysis(null); setError(""); setMessage("Комментарий обновлён. Нажмите «Разобрать с ИИ»."); }} placeholder="Например: играю за Бардур, 8-й ход, хочу захватить город. Укажи технологии и звёзды, если их плохо видно." />
          <small>ИИ видит только этот скриншот. Контекст помогает уточнить совет.</small>
        </div>}
        <div className="upload-actions">
          <button className="secondary-button" onClick={() => inputRef.current?.click()}><Upload size={16} /> {preview ? "Заменить файл" : "Выбрать файл"}</button>
          {preview && <button className="secondary-button" onClick={saveToHistory}><Save size={16} /> Сохранить снимок</button>}
          {isAnalyzing ? (
            <button className="primary-button" onClick={() => { cancelAnalysis(); setMessage("Анализ отменён. Можно запустить снова."); }}><X size={16} /> Отменить анализ</button>
          ) : (
            <button className="primary-button" onClick={analyzeCurrent} disabled={!file}><Sparkles size={16} /> {error ? "Повторить анализ" : "Разобрать с ИИ"}</button>
          )}
        </div>
        <p className="inline-message" role="status">{message}</p>
        {error && <div className="error-message" role="alert"><AlertTriangle size={17} /><p>{error}</p></div>}
      </section>

      <section className="analysis-section" aria-busy={isAnalyzing}>
        <div className="section-heading">
          <div><span className="step">02</span><h2>Тактический анализ</h2></div>
          <span className={`demo-label ${analysis ? "is-ready" : ""}`}>{isAnalyzing ? <LoaderCircle className="spin" size={13} /> : <span />}{isAnalyzing ? "Изучаю карту" : analysis ? "Готово" : "По скриншоту"}</span>
        </div>
        {analysis ? (
          <div className="analysis-summary" aria-live="polite"><CheckCircle2 size={18} /><p>{analysis.summary}</p></div>
        ) : (
          <div className="notice">{isAnalyzing ? <LoaderCircle className="spin" size={18} /> : <Bot size={18} />}<p>{isAnalyzing ? "Распознаю видимые города и юниты, оцениваю позицию и варианты развития." : "Выберите скриншот и запустите анализ. ИИ предложит план по видимой части поля и отметит, где не хватает данных."}</p></div>
        )}
        <div className="analysis-grid">
          {tips.map(({ title, icon: Icon, text }, index) => (
            <article className={`analysis-tile ${analysis ? "has-result" : ""} ${index === 2 && analysis ? "best-move" : ""}`} key={title}>
              <span className="tile-icon"><Icon size={19} /></span>
              <h3>{title}</h3>
              {isAnalyzing ? (
                <div className="analysis-skeleton" aria-hidden="true"><i /><i /><i /></div>
              ) : analysis ? (
                index === 3 ? <ol className="turn-plan">{analysis.threeTurnPlan.map((step, turn) => <li key={turn}><span>{turn === 0 ? "Этот ход" : `Через ${turn} ${turn === 1 ? "ход" : "хода"}`}</span><p>{step}</p></li>)}</ol>
                  : <p>{[analysis.economy, analysis.threats, analysis.bestMove][index]}</p>
              ) : <p>{text}</p>}
              {!analysis && <span className="tile-state">{isAnalyzing ? "СОСТАВЛЯЮ РЕКОМЕНДАЦИИ" : "ОЖИДАЕТ АНАЛИЗА"}</span>}
            </article>
          ))}
        </div>
        {analysis && <div className="analysis-caveat"><AlertTriangle size={16} /><div><strong>Учитывай неопределённость</strong>{analysis.uncertainties.length > 0 && <ul>{analysis.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul>}<p>ИИ может ошибаться. Проверь доступность действий и стоимость в игре перед ходом.</p></div></div>}
      </section>

      <section className="history-section">
        <div className="section-heading">
          <div><span className="step">03</span><h2>История снимков</h2></div>
          <span className="count">{history.length}/8</span>
        </div>
        {history.length === 0 ? (
          <div className="empty-history"><Bot size={22} /><span>Сохранённые снимки появятся здесь.</span></div>
        ) : (
          <div className="history-list">
            {history.map(item => (
              <div className="history-item" key={item.id}>
                <img src={item.url} alt="" />
                <div><strong>{item.name}</strong><small>{item.date}</small></div>
                <button className="icon-button" onClick={() => removeHistory(item.id)} aria-label={`Удалить ${item.name}`}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer><span>POLYTOPIA AI COMPANION</span><span>Создано для стратегов <ArrowUpRight size={13} /></span></footer>
    </main>
  );
}
