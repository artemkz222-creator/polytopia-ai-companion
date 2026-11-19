import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, Bot, CheckCircle2, Clock3, Coins,
  ImagePlus, Map, Shield, Sparkles, Target, Trash2, Upload, X
} from "lucide-react";

type SavedScan = { id: string; name: string; date: string; url: string };

const tips = [
  { title: "Экономика", icon: Coins, text: "После распознавания скриншота здесь появится оценка дохода, расходов и приоритетов развития." },
  { title: "Угрозы", icon: Shield, text: "Здесь будут отмечаться вражеские юниты, опасные направления и уязвимые города." },
  { title: "Лучший следующий ход", icon: Target, text: "AI предложит конкретное действие, объяснит причину и ожидаемую пользу." },
  { title: "План на 3 хода", icon: Clock3, text: "Краткий план развития с учётом экономики, карты и ближайших угроз." }
];

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [history, setHistory] = useState<SavedScan[]>([]);
  const [message, setMessage] = useState("Загрузите скриншот игрового поля, чтобы начать.");
  const inputRef = useRef<HTMLInputElement>(null);

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
      setMessage("Поддерживаются PNG, JPEG и WebP.");
      return;
    }
    if (next.size > 15 * 1024 * 1024) {
      setMessage("Файл слишком большой. Максимальный размер — 15 МБ.");
      return;
    }
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setMessage("Скриншот загружен. AI-анализатор пока не подключён.");
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
    setFile(null);
    setPreview("");
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
        <span className="status"><span className="status-dot" /> MVP · версия 0.1</span>
      </header>

      <section className="hero">
        <div className="eyebrow"><Sparkles size={14} /> ПОМОЩНИК КОМАНДИРА</div>
        <h1>Продумай ход.<br /><em>Победи стратегически.</em></h1>
        <p>Загрузи снимок своей партии в The Battle of Polytopia — здесь будет собран анализ карты, экономики и следующих действий.</p>
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
        <div className="upload-actions">
          <button className="secondary-button" onClick={() => inputRef.current?.click()}><Upload size={16} /> {preview ? "Заменить файл" : "Выбрать файл"}</button>
          <button className="primary-button" onClick={saveToHistory} disabled={!file}><Sparkles size={16} /> Сохранить снимок</button>
        </div>
        <p className="inline-message" role="status">{message}</p>
      </section>

      <section className="analysis-section">
        <div className="section-heading">
          <div><span className="step">02</span><h2>Тактический анализ</h2></div>
          <span className="demo-label"><span /> AI не подключён</span>
        </div>
        <div className="notice"><AlertTriangle size={18} /><p><strong>Ожидает подключения AI.</strong> Сейчас приложение принимает и сохраняет скриншоты, но ещё не распознаёт игровые объекты и не генерирует советы.</p></div>
        <div className="analysis-grid">
          {tips.map(({ title, icon: Icon, text }) => (
            <article className="analysis-tile" key={title}>
              <span className="tile-icon"><Icon size={19} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="tile-state">ОЖИДАЕТ АНАЛИЗА</span>
            </article>
          ))}
        </div>
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