import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { loadTutorialMedia, type TutorialMedia } from "../services/tutorialMedia";
import "./investorTutorials.css";

function durationLabel(seconds: number) {
  const rounded = Math.ceil(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function PlayGlyph() {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <rect x="2.5" y="4" width="19" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" />
    <path d="m10 8 6 4-6 4z" fill="currentColor" />
  </svg>;
}

export function InvestorTutorialsPage() {
  const { user } = useAuth();
  const isInvestor = Boolean(user && !user.is_manager);
  const catalogue = useAsync(() => isInvestor ? api.tutorials() : Promise.resolve({available: false, lessons: []}), [user?.id]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [media, setMedia] = useState<(TutorialMedia & {lessonId: string; userId: number}) | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const playerRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lessons = isInvestor && catalogue.data?.available ? catalogue.data.lessons : [];
  const selected = lessons[selectedIndex] ?? lessons[0];
  const currentMedia = media?.lessonId === selected?.id && media?.userId === user?.id ? media : null;
  function applyCaptionPreference() {
    const tracks = videoRef.current?.textTracks;
    if (tracks) for (let index = 0; index < tracks.length; index++) tracks[index].mode = captionsEnabled ? "showing" : "disabled";
  }
  useEffect(applyCaptionPreference, [captionsEnabled, currentMedia]);
  function selectChapter(index: number) {
    setSelectedIndex(index);
    if (window.matchMedia("(max-width:850px)").matches) {
      playerRef.current?.scrollIntoView({behavior: "instant", block: "start"});
    }
  }

  useEffect(() => {setSelectedIndex(0);}, [user?.id]);
  useEffect(() => {
    const controller = new AbortController();
    let loaded: TutorialMedia | null = null;
    setMedia(null);
    setMediaError(null);
    if (!selected || !isInvestor) {setMediaLoading(false); return () => controller.abort();}
    setMediaLoading(true);
    loadTutorialMedia(selected.id, controller.signal).then(result => {
      loaded = result;
      if (controller.signal.aborted) {result.dispose(); return;}
      setMedia({...result, lessonId: selected.id, userId: user!.id});
    }).catch(error => {
      if (!controller.signal.aborted) setMediaError(error instanceof Error ? error.message : "הסרטון לא נטען");
    }).finally(() => {
      if (!controller.signal.aborted) setMediaLoading(false);
    });
    return () => {controller.abort(); loaded?.dispose();};
  }, [selected?.id, user?.id, isInvestor, retry]);

  if (user?.is_manager) return <Navigate to="/" replace />;
  if (catalogue.loading) return <div className="state" role="status">טוענים את ההדרכות...</div>;
  if (catalogue.error) return <div className="state state--error" role="alert">
    <p>{catalogue.error}</p><button className="btn btn--ghost" onClick={catalogue.reload}>נסה שוב</button>
  </div>;
  if (!selected) return <section className="tutorials-empty panel">
    <PlayGlyph /><h1>הדרכה לתיק שלך</h1><p>ההדרכות עדיין אינן זמינות. אפשר להמשיך לתיק שלך.</p>
    <Link className="btn" to="/investors">לתיק שלי</Link>
  </section>;

  return <div className="tutorials-page" dir="rtl">
    <header className="tutorials-intro">
      <span className="tutorials-intro__icon"><PlayGlyph /></span>
      <div><p className="tutorials-eyebrow">לומדים את תזרים</p><h1>הדרכה קצרה לתיק שלך</h1>
        <p>תבחר נושא, תצפה בפעולות ותמשיך בקצב שלך.</p></div>
      <span className="tutorials-count">{lessons.length} סרטונים קצרים</span>
    </header>
    <div className="tutorials-layout">
      <section ref={playerRef} className="tutorials-player panel" aria-label="נגן ההדרכה">
        <header className="tutorials-player__head">
          <span className="tutorials-eyebrow">סרטון {selectedIndex + 1} מתוך {lessons.length}</span>
          <h2>{selected.title}</h2><p>{selected.summary}</p>
        </header>
        <div className={`tutorials-screen${selected.id === "08-notifications" ? " tutorials-screen--portrait" : ""}`} aria-busy={mediaLoading}>
          {currentMedia ? <video ref={videoRef} key={selected.id} className="tutorials-video" controls playsInline preload="metadata"
            src={currentMedia.video} poster={currentMedia.poster} aria-label={selected.title}
            onLoadedMetadata={applyCaptionPreference}
            onError={() => setMediaError("לא ניתן לנגן את הסרטון במכשיר הזה. אפשר לנסות שוב או לקרוא את ההסבר למטה.")}>
            <track kind="captions" src={currentMedia.captions} srcLang="he" label="עברית" default={captionsEnabled} onLoad={applyCaptionPreference} />
          </video> : <div className="tutorials-screen__state" role={mediaError ? "alert" : "status"}>
            <PlayGlyph /><p>{mediaError ?? "טוענים את הסרטון..."}</p>
            {mediaError ? <button className="btn btn--ghost" onClick={() => setRetry(n => n + 1)}>נסה שוב</button> : null}
          </div>}
        </div>
        {currentMedia && mediaError ? <p className="tutorials-error" role="alert">{mediaError}
          <button className="btn btn--small btn--ghost" onClick={() => setRetry(n => n + 1)}>נסה שוב</button></p> : null}
        <div className="tutorials-player__foot">
          <span>משך הסרטון <bdi>{durationLabel(selected.duration_seconds)}</bdi></span>
          <div className="tutorials-player__actions">
          <button type="button" className="btn btn--small btn--ghost" aria-pressed={captionsEnabled} disabled={!currentMedia}
            onClick={() => setCaptionsEnabled(value => !value)}>{captionsEnabled ? "כתוביות מופעלות" : "כתוביות"}</button>
          {selectedIndex < lessons.length - 1 ? <button className="btn btn--small" onClick={() => selectChapter(selectedIndex + 1)}>
            לסרטון הבא <span aria-hidden="true">←</span></button> : <Link className="btn btn--small" to="/investors">לתיק שלי</Link>}
          </div>
        </div>
        <details key={`text-${selected.id}`} className="tutorials-transcript">
          <summary>ההסבר בכתב</summary><p>{selected.transcript}</p>
        </details>
      </section>
      <nav className="tutorials-chapters" aria-label="נושאי ההדרכה">
        <h2>מה תרצה ללמוד?</h2>
        {lessons.map((lesson, index) => <button key={lesson.id} type="button"
          className={`tutorials-chapter${index === selectedIndex ? " is-selected" : ""}`}
          aria-current={index === selectedIndex ? "true" : undefined}
          onClick={() => selectChapter(index)}>
          <span className="tutorials-chapter__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <span className="tutorials-chapter__copy"><strong>{lesson.title}</strong><span>{lesson.summary}</span></span>
          <bdi className="tutorials-chapter__time">{durationLabel(lesson.duration_seconds)}</bdi>
        </button>)}
      </nav>
    </div>
  </div>;
}
