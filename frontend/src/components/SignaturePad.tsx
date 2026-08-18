import { useCallback, useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

function pointerPoint(canvas: HTMLCanvasElement, event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(rect.width, 1);
  const scaleY = canvas.height / Math.max(rect.height, 1);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

export function SignaturePad({
  onChange,
  disabled = false,
}: {
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<Point | null>(null);
  const hasInk = useRef(false);
  const [empty, setEmpty] = useState(true);

  const paintBlank = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = Math.max(canvas.clientWidth || 0, 280);
    const height = Math.max(canvas.clientHeight || 0, 140);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#14352c";
    ctx.lineWidth = 2.2 * ratio;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const reset = useCallback(() => {
    hasInk.current = false;
    setEmpty(true);
    paintBlank();
    onChangeRef.current("");
  }, [paintBlank]);

  useEffect(() => {
    reset();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (hasInk.current) return;
      reset();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [reset]);

  function emit() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk.current) return;
    onChangeRef.current(canvas.toDataURL("image/png"));
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.nativeEvent.pointerId);
    drawing.current = true;
    last.current = pointerPoint(canvas, event.nativeEvent);
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || !drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !last.current) return;
    const next = pointerPoint(canvas, event.nativeEvent);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last.current = next;
    hasInk.current = true;
    setEmpty(false);
  }

  function onPointerUp() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    emit();
  }

  return (
    <div className="sign-pad">
      <canvas
        ref={canvasRef}
        className="sign-pad__canvas"
        aria-label="לוח חתימה דיגיטלית"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="sign-pad__bar">
        <span className="muted">{empty ? "חתמו כאן בעכבר או באצבע" : "החתימה נשמרה"}</span>
        <button type="button" className="btn btn--ghost btn--small" onClick={reset} disabled={disabled || empty}>
          נקה
        </button>
      </div>
    </div>
  );
}
