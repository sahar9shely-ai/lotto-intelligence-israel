import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";

export function ChatPage() {
  const { chatMessages, sendMessage, refreshChat, user } = useAuth();
  const [text, setText] = useState("");

  useEffect(() => {
    void refreshChat();
  }, [refreshChat]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = text;
    setText("");
    await sendMessage(value);
  }

  return (
    <AppShell>
      <section className="chat-screen">
        <div className="chat-screen__head">
          <h1>צ'אט פרטי</h1>
          <p>חדר רומנטי · {user.name}</p>
        </div>
        <div className="chat-thread">
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`bubble bubble--${msg.from}`}
            >
              {msg.text}
            </div>
          ))}
        </div>
        <form className="chat-input" onSubmit={onSubmit}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="כתבו הודעה..."
          />
          <button type="submit" aria-label="שלח">
            ➤
          </button>
        </form>
      </section>
    </AppShell>
  );
}
