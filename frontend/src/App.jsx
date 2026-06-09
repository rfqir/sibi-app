import { useState, useRef, useEffect, useCallback } from "react";

const WS_URL = "ws://localhost:8000/ws";
const COLORS = {
  bg: "#0a0e1a",
  panel: "#0d1526",
  border: "#1a2744",
  cyan: "#00f5ff",
  cyanDim: "#00b8cc",
  green: "#00ff88",
  yellow: "#ffd700",
  red: "#ff4466",
  text: "#c8d8f0",
  textDim: "#4a6080",
};

function CornerBox({ children, style }) {
  const corner = { position: "absolute", width: 14, height: 14 };
  const line = `2px solid ${COLORS.cyan}`;
  return (
    <div style={{ position: "relative", ...style }}>
      <div style={{ ...corner, top: 0, left: 0, borderTop: line, borderLeft: line }} />
      <div style={{ ...corner, top: 0, right: 0, borderTop: line, borderRight: line }} />
      <div style={{ ...corner, bottom: 0, left: 0, borderBottom: line, borderLeft: line }} />
      <div style={{ ...corner, bottom: 0, right: 0, borderBottom: line, borderRight: line }} />
      {children}
    </div>
  );
}

function BBox({ det, videoW, videoH }) {
  const { bbox, label, confidence } = det;
  return (
    <div
      style={{
        position: "absolute",
        left: `${bbox.x * 100}%`,
        top: `${bbox.y * 100}%`,
        width: `${bbox.w * 100}%`,
        height: `${bbox.h * 100}%`,
        border: `2px solid ${COLORS.cyan}`,
        boxShadow: `0 0 8px ${COLORS.cyan}88`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -24,
          left: -2,
          background: COLORS.cyan,
          color: COLORS.bg,
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "monospace",
          padding: "2px 8px",
          whiteSpace: "nowrap",
          letterSpacing: 1,
        }}
      >
        {label} {(confidence * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function StatusDot({ connected }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8, height: 8, borderRadius: "50%",
          background: connected ? COLORS.green : COLORS.red,
          boxShadow: `0 0 6px ${connected ? COLORS.green : COLORS.red}`,
          display: "inline-block",
        }}
      />
      <span style={{ fontFamily: "monospace", fontSize: 12, color: COLORS.textDim, letterSpacing: 1 }}>
        {connected ? "CONNECTED" : "DISCONNECTED"}
      </span>
    </span>
  );
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const intervalRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [connected, setConnected] = useState(false);
  const [detections, setDetections] = useState([]);
  const [fps, setFps] = useState(0);
  const [lastLabel, setLastLabel] = useState(null);
  const [history, setHistory] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const fpsRef = useRef({ count: 0, last: Date.now() });

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  };

  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => { setConnected(false); setTimeout(connectWS, 2000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "detections") {
        setDetections(msg.detections);
        if (msg.detections.length > 0) {
          const top = msg.detections[0];
          setLastLabel(top.label);
          setHistory(h => {
            const last = h[h.length - 1];
            if (last?.label === top.label) return h;
            return [...h.slice(-19), { label: top.label, conf: top.confidence, ts: Date.now() }];
          });
        }
        fpsRef.current.count++;
        const now = Date.now();
        if (now - fpsRef.current.last >= 1000) {
          setFps(fpsRef.current.count);
          fpsRef.current = { count: 0, last: now };
        }
      }
    };
    wsRef.current = ws;
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 }
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraOn(true);
      connectWS();

      intervalRef.current = setInterval(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || wsRef.current?.readyState !== WebSocket.OPEN) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        // Kirim sebagai binary blob (lebih ringan dari base64)
        canvas.toBlob((blob) => {
          if (blob && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(blob);
          }
        }, "image/jpeg", 0.7);
      }, 100);
    } catch (err) {
      alert("Gagal akses kamera: " + err.message);
    }
  }, [connectWS]);

  const stopCamera = useCallback(() => {
    clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    wsRef.current?.close();
    setCameraOn(false);
    setConnected(false);
    setDetections([]);
    setLastLabel(null);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const s = {
    app: {
      minHeight: "100vh", background: COLORS.bg, color: COLORS.text,
      fontFamily: "'Courier New', monospace", padding: "16px",
      display: "flex", flexDirection: "column", gap: 16, maxWidth: 480,
      margin: "0 auto",
    },
    header: {
      display: "flex", justifyContent: "space-between", alignItems: "center",
      borderBottom: `1px solid ${COLORS.border}`, paddingBottom: 12,
    },
    title: {
      fontSize: 20, fontWeight: 700, letterSpacing: 3,
      color: COLORS.cyan, textShadow: `0 0 12px ${COLORS.cyan}88`,
    },
    videoWrap: {
      position: "relative", background: "#000", borderRadius: 4,
      overflow: "hidden", aspectRatio: "4/3",
      border: `1px solid ${COLORS.border}`,
    },
    video: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
    placeholder: {
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12, color: COLORS.textDim,
    },
    btn: (active) => ({
      flex: 1, padding: "12px 0", border: "none", borderRadius: 4,
      fontFamily: "monospace", fontSize: 14, fontWeight: 700, letterSpacing: 2,
      cursor: "pointer", transition: "all 0.15s",
      background: active
        ? `linear-gradient(135deg, #ff1a3a, #cc0022)`
        : `linear-gradient(135deg, ${COLORS.cyan}, ${COLORS.cyanDim})`,
      color: active ? "#fff" : COLORS.bg,
      boxShadow: active
        ? `0 0 16px #ff1a3a66`
        : `0 0 16px ${COLORS.cyan}44`,
    }),
    labelBig: {
      textAlign: "center", padding: "16px 0",
      fontSize: 72, fontWeight: 900, lineHeight: 1,
      color: COLORS.cyan, textShadow: `0 0 30px ${COLORS.cyan}`,
      letterSpacing: 8,
    },
    panel: {
      background: COLORS.panel, border: `1px solid ${COLORS.border}`,
      borderRadius: 4, padding: "12px 16px",
    },
    panelTitle: {
      fontSize: 11, letterSpacing: 3, color: COLORS.textDim,
      marginBottom: 8, textTransform: "uppercase",
    },
    historyRow: {
      display: "flex", gap: 6, flexWrap: "wrap",
    },
    historyItem: (i) => ({
      padding: "3px 10px", borderRadius: 2,
      background: i === history.length - 1 ? COLORS.cyan : COLORS.border,
      color: i === history.length - 1 ? COLORS.bg : COLORS.text,
      fontSize: 13, fontWeight: 700, letterSpacing: 2,
      transition: "all 0.2s",
    }),
    statsRow: {
      display: "flex", gap: 16, fontSize: 12, color: COLORS.textDim,
    },
    stat: {
      display: "flex", flexDirection: "column", gap: 2,
    },
    statVal: { color: COLORS.cyan, fontSize: 18, fontWeight: 700 },
  };

  return (
    <div style={s.app}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.title}>SIBI.AI</span>
        <StatusDot connected={connected} />
      </div>

      {/* Video feed */}
      <CornerBox>
        <div style={s.videoWrap}>
          <video ref={videoRef} style={s.video} muted playsInline />
          {!cameraOn && (
            <div style={s.placeholder}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={COLORS.textDim} strokeWidth="1.5">
                <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
              </svg>
              <span style={{ fontSize: 12, letterSpacing: 2 }}>CAMERA STANDBY</span>
            </div>
          )}
          {cameraOn && detections.map((det, i) => (
            <BBox key={i} det={det} />
          ))}
          {cameraOn && (
            <div style={{
              position: "absolute", top: 8, right: 8,
              background: "#00000088", padding: "3px 8px",
              fontSize: 11, fontFamily: "monospace", color: COLORS.green,
              letterSpacing: 1,
            }}>
              ● LIVE {fps}fps
            </div>
          )}
        </div>
      </CornerBox>

      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        {!cameraOn ? (
          <button style={s.btn(false)} onClick={startCamera}>▶ START CAMERA</button>
        ) : (
          <button style={s.btn(true)} onClick={stopCamera}>■ STOP CAMERA</button>
        )}
      </div>

      {/* Install PWA Button */}
      {installPrompt && !installed && (
        <button
          onClick={handleInstall}
          style={{
            width: "100%", padding: "10px 0", border: `1px solid ${COLORS.cyan}`,
            borderRadius: 4, background: "transparent",
            color: COLORS.cyan, fontFamily: "monospace", fontSize: 13,
            fontWeight: 700, letterSpacing: 2, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          ⬇ INSTALL APP
        </button>
      )}
      {installed && (
        <div style={{ textAlign: "center", fontSize: 12, color: COLORS.green, letterSpacing: 2, padding: "6px 0" }}>
          ✓ APP INSTALLED
        </div>
      )}

      {/* Big label */}
      {lastLabel && (
        <div style={s.labelBig}>{lastLabel}</div>
      )}
      {!lastLabel && cameraOn && (
        <div style={{ ...s.labelBig, fontSize: 14, color: COLORS.textDim, letterSpacing: 3 }}>
          SCANNING...
        </div>
      )}

      {/* Stats */}
      <div style={s.panel}>
        <div style={s.panelTitle}>Statistics</div>
        <div style={s.statsRow}>
          <div style={s.stat}>
            <span style={{ fontSize: 11, letterSpacing: 1 }}>DETECTIONS</span>
            <span style={s.statVal}>{detections.length}</span>
          </div>
          <div style={s.stat}>
            <span style={{ fontSize: 11, letterSpacing: 1 }}>FPS</span>
            <span style={s.statVal}>{fps}</span>
          </div>
          <div style={s.stat}>
            <span style={{ fontSize: 11, letterSpacing: 1 }}>CONFIDENCE</span>
            <span style={s.statVal}>
              {detections[0] ? `${(detections[0].confidence * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div style={s.panel}>
          <div style={s.panelTitle}>Detection History</div>
          <div style={s.historyRow}>
            {history.map((h, i) => (
              <span key={h.ts} style={s.historyItem(i)}>{h.label}</span>
            ))}
          </div>
        </div>
      )}

      {/* Detection list */}
      {detections.length > 0 && (
        <div style={s.panel}>
          <div style={s.panelTitle}>Active Detections</div>
          {detections.map((det, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between",
              padding: "4px 0", borderBottom: i < detections.length - 1 ? `1px solid ${COLORS.border}` : "none",
            }}>
              <span style={{ fontWeight: 700, color: COLORS.cyan, letterSpacing: 2 }}>{det.label}</span>
              <span style={{ color: COLORS.textDim, fontSize: 12 }}>
                {(det.confidence * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ textAlign: "center", fontSize: 10, color: COLORS.textDim, letterSpacing: 2, paddingTop: 8 }}>
        SIBI DETECTION SYSTEM v1.0
      </div>
    </div>
  );
}
