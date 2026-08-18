import { useCallback, useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

function pointerPoint(canvas: HTMLCanvasElement, event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
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
  const [empty, setEmpty] = useState(true);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 140;
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
    setEmpty(true);
    onChangeRef.current("");
  }, []);

  useEffect(() => {
    resize();
  }, [resize]);

  function emit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    setEmpty(false);
  }

  function onPointerUp() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (!empty) emit();
    else emit();
  }

  function clear() {
    resize();
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
        <button type="button" className="btn btn--ghost btn--small" onClick={clear} disabled={disabled || empty}>
          נקה
        </button>
      </div>
    </div>
  );
}
