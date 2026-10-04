import { AUTH_EXPIRED_EVENT, getToken, setToken } from "./api";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export type TutorialMedia = {
  video: string;
  poster: string;
  captions: string;
  dispose: () => void;
};

export async function loadTutorialMedia(lessonId: string, signal: AbortSignal): Promise<TutorialMedia> {
  const token = getToken();
  if (!token) throw new Error("נדרשת התחברות מחדש");
  const assets = ["video", "poster", "captions"] as const;
  const blobs = await Promise.all(assets.map(async (asset) => {
    const response = await fetch(`${API_BASE}/api/v1/tutorials/media/${encodeURIComponent(lessonId)}/${asset}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
      cache: "no-store",
    });
    if (response.status === 401 && getToken() === token) {
      setToken(null);
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    if (!response.ok) throw new Error("לא ניתן לטעון את הסרטון כרגע. אפשר לנסות שוב.");
    return response.blob();
  }));
  signal.throwIfAborted();
  const [video, poster, captions] = blobs.map(blob => URL.createObjectURL(blob));
  return { video, poster, captions, dispose: () => {
    [video, poster, captions].forEach(url => URL.revokeObjectURL(url));
  } };
}
