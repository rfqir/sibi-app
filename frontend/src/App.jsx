import { useState, useRef, useEffect, useCallback } from "react";

const WS_URL = "ws://localhost:8000/ws";
const gestureImages = import.meta.glob(
  "./assets/img/*.{jpg,jpeg,png}",
  {
    eager: true,
    import: "default",
  }
);
const THEMES = {
  light: {
    bg: "#f8fafc",
    panel: "#ffffff",
    border: "#e2e8f0",
    text: "#0f172a",
    textDim: "#64748b",
    primary: "#1d4ed8",
    primaryLight: "#eff6ff",
    green: "#10b981",
    red: "#ef4444",
    cardShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.03)",
    inputBg: "#ffffff",
  },
  dark: {
    bg: "#0f172a",
    panel: "#1e293b",
    border: "#334155",
    text: "#f1f5f9",
    textDim: "#94a3b8",
    primary: "#3b82f6",
    primaryLight: "rgba(59, 130, 246, 0.1)",
    green: "#10b981",
    red: "#f87171",
    cardShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
    inputBg: "#111827",
  }
};

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const intervalRef = useRef(null);
  const streamRef = useRef(null);
  

  const [cameraOn, setCameraOn] = useState(false);
  const [connected, setConnected] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState("user");
  const [detections, setDetections] = useState([]);
  const [fps, setFps] = useState(0);
  const [lastLabel, setLastLabel] = useState(null);
  const [history, setHistory] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [isDesktop, setIsDesktop] = useState(typeof window !== "undefined" ? window.innerWidth > 900 : false);
  const [practiceWord, setPracticeWord] = useState("");
  const [practiceInput, setPracticeInput] = useState("");
  const [practiceActive, setPracticeActive] = useState(false);
  const [practiceProgress, setPracticeProgress] = useState(0);
  const [expectedLetter, setExpectedLetter] = useState(null);
  const [practiceCompleted, setPracticeCompleted] = useState(false);
  const fpsRef = useRef({ count: 0, last: Date.now() });
  const getGestureImage = (letter) => {
    if (!letter) return null;

    const match = Object.entries(gestureImages).find(([path]) =>
      path.toLowerCase().endsWith(`/${letter.toLowerCase()}.jpg`)
    );

    return match?.[1] ?? null;
  };
  const gestureImage = getGestureImage(expectedLetter);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });
  const currentTheme = darkMode ? THEMES.dark : THEMES.light;

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth > 900);
    window.addEventListener("resize", handleResize);
    
    const installHandler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", installHandler);
    window.addEventListener("appinstalled", () => setInstalled(true));

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("beforeinstallprompt", installHandler);
    };
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

    if (msg.type === "practice_started") {
      setPracticeWord(msg.word);
      setExpectedLetter(msg.expected);
      setPracticeProgress(0);
      setPracticeActive(true);
    }

    if (msg.type === "detections") {
        setDetections(msg.detections);
        if (msg.practice) {
          setPracticeProgress(msg.practice.progress ?? 0);

          if (msg.practice.completed) {
            setPracticeCompleted(true);
            setExpectedLetter(null);
          } else if (msg.practice.expected) {
            setExpectedLetter(msg.practice.expected);
          }
        }
        if (msg.detections.length > 0) {
          const top = msg.detections[0];
          setLastLabel(top.label);
          setHistory(h => {
            const last = h[h.length - 1];
            if (last?.label === top.label) return h;
            return [...h.slice(-7), { label: top.label, conf: top.confidence, ts: Date.now() }];
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
  const startPractice = () => {
  if (!practiceInput.trim()) return;

  setPracticeCompleted(false);

  wsRef.current?.send(
    JSON.stringify({
      type: "start_practice",
      word: practiceInput.toUpperCase(),
    })
  );
};
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: selectedCamera, width: 640, height: 480 }
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
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        wsRef.current.send(JSON.stringify({ type: "frame", image: dataUrl }));
      }, 500);
    } catch (err) {
      alert("Gagal akses kamera: " + err.message);
    }
  }, [connectWS, selectedCamera]);

  const stopCamera = useCallback(() => {
    clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    wsRef.current?.close();
    setCameraOn(false);
    setConnected(false);
    setDetections([]);
    setLastLabel(null);
    setPracticeActive(false);
    setPracticeWord("");
    setExpectedLetter(null);
    setPracticeProgress(0);
    setPracticeCompleted(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const s = {
    app: {
      height: isDesktop ? "100vh" : "auto",
      maxHeight: isDesktop ? "100vh" : "none",
      background: currentTheme.bg,
      color: currentTheme.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif',
      padding: isDesktop ? "24px 40px" : "16px 12px",
      display: "flex",
      flexDirection: "column",
      gap: isDesktop ? "16px" : "12px",
      overflow: isDesktop ? "hidden" : "auto",
      boxSizing: "border-box",
    },
    navbar: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottom: `1px solid ${currentTheme.border}`,
      paddingBottom: "12px",
      flexShrink: 0,
      width: isDesktop ? "70%" : "100%",
      margin: "0 auto",
    },
    brand: { display: "flex", alignItems: "center", gap: "10px", fontSize: "18px", fontWeight: "700", color: currentTheme.primary, letterSpacing: "-0.5px" },
    brandDot: { width: "10px", height: "10px", borderRadius: "50%", background: currentTheme.primary },
    
    layout: {
      display: "grid",
      gridTemplateColumns: isDesktop ? "280px 1fr" : "1fr",
      gap: isDesktop ? "20px" : "16px",
      width: isDesktop ? "70%" : "100%",
      margin: "0 auto",
      flexGrow: 1,
      minHeight: 0,
    },
    
    leftColumn: {
      display: "flex",
      flexDirection: "column", 
      gap: isDesktop ? "16px" : "12px",
      minHeight: 0,
      order: isDesktop ? 1 : 2
    },
    rightColumn: {
      order: isDesktop ? 2 : 1
    },
    
    card: {
      background: currentTheme.panel,
      border: `1px solid ${currentTheme.border}`,
      borderRadius: "12px",
      boxShadow: currentTheme.cardShadow,
      padding: "20px",
      boxSizing: "border-box",
    },
    // MODIFIKASI: Ukuran disesuaikan (compact dan proporsional dengan layout professional business)
    statsCardWrapper: {
      background: currentTheme.panel,
      border: `1px solid ${currentTheme.border}`,
      borderRadius: "12px",
      boxShadow: currentTheme.cardShadow,
      padding: "14px 16px", // Dibuat lebih tipis namun pas dengan grid content
      boxSizing: "border-box",
    },
    cardTitle: {
      fontSize: "12px",
      fontWeight: "600",
      color: currentTheme.textDim,
      margin: "0 0 12px 0", // Mengurangi jarak bawah judul sedikit agar tidak terlalu kosong
      letterSpacing: "1px",
      textTransform: "uppercase"
    },
    videoArea: {
      position: "relative",
      width: "100%",
      aspectRatio: "16/9",
      background: "#000",
      borderRadius: "8px",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: `1px solid ${currentTheme.border}`
    },
    btnAction: (isOn) => ({
      padding: "10px 20px", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: "600", cursor: "pointer", 
      background: isOn ? currentTheme.red : currentTheme.primary, color: "#ffffff", display: "flex", alignItems: "center", gap: "8px", transition: "background 0.2s"
    }),
    btnInstall: {
      width: "100%", padding: "10px", border: `1px solid ${currentTheme.border}`, borderRadius: "6px", background: currentTheme.inputBg,
      color: currentTheme.primary, fontSize: "13px", fontWeight: "600", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "12px"
    },
    toggleMode: {
      background: "transparent", border: `1px solid ${currentTheme.border}`, borderRadius: "6px", cursor: "pointer", 
      color: currentTheme.text, display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px"
    },
    statsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" },
    statCard: {
      padding: "8px 4px", // Menggunakan padding proporsional agar ramping namun tulisan tidak menempel batas luar
      borderRadius: "8px", 
      background: darkMode ? "#293548" : "#f1f5f9", 
      border: `1px solid ${currentTheme.border}`, 
      textAlign: "center"
    },
    statVal: { display: "block", fontSize: "16px", fontWeight: "700", color: currentTheme.text, marginTop: "2px" },
    
    bigLabelBox: {
      textAlign: "center", padding: isDesktop ? "16px 0" : "12px 0", background: darkMode ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)", borderRadius: "8px", border: `1px dashed ${currentTheme.border}`,
      flexGrow: 0, minHeight: "60px", display: "flex", alignItems: "center", justifyContent: "center"
    },
    labelText: { fontSize: isDesktop ? "32px" : "28px", fontWeight: "700", color: currentTheme.primary, letterSpacing: "-0.5px" },
    inactiveText: { fontSize: "14px", fontWeight: "500", color: currentTheme.textDim },

    footer: {
      textAlign: "center",
      fontSize: "12px",
      color: currentTheme.textDim,
      flexShrink: 0,
      borderTop: `1px solid ${currentTheme.border}`,
      paddingTop: "12px",
      width: isDesktop ? "70%" : "100%",
      margin: "0 auto",
      fontWeight: "500"
    }
  };

  return (
    <div style={s.app}>
      {/* Top Navbar */}
      <div style={s.navbar}>
        <div style={s.brand}>
          <div style={s.brandDot} />
          <span>SIBI</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: currentTheme.textDim, fontWeight: "500" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? currentTheme.green : currentTheme.red, display: "inline-block" }} />
            {isDesktop && (connected ? "System Connected" : "System Disconnected")}
          </div>
          
          <button onClick={() => setDarkMode(!darkMode)} style={s.toggleMode} aria-label="Toggle Theme">
            {darkMode ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* Grid Layout Container */}
      <div style={s.layout}>
        
        {/* KOLOM KIRI */}
        <div style={s.leftColumn}>
          
          {/* CARD KAMERA */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Camera Selection</h2>
            <select
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: `1px solid ${currentTheme.border}`, background: currentTheme.inputBg, color: currentTheme.text, fontSize: "14px", outline: "none", cursor: "pointer" }}
            >
              <option value="user">Front Camera (Primary)</option>
              <option value="environment">Back Camera (Secondary)</option>
            </select>

            {/* Tombol Install PWA */}
            {installPrompt && !installed && (
              <button onClick={handleInstall} style={s.btnInstall}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                Install Application
              </button>
            )}
          </div>
            <div style={s.card}>
              <h2 style={s.cardTitle}>Practice Mode</h2>

              <input
                value={practiceInput}
                onChange={(e) => setPracticeInput(e.target.value)}
                placeholder="Masukkan kata, contoh: TARI"
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "6px",
                  border: `1px solid ${currentTheme.border}`,
                  background: currentTheme.inputBg,
                  color: currentTheme.text,
                  boxSizing: "border-box",
                  marginBottom: "10px"
                }}
              />

              <button
                onClick={startPractice}
                disabled={!connected}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "6px",
                  border: "none",
                  background: currentTheme.primary,
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Start Practice
              </button>

              {practiceActive && (
                <div style={{ marginTop: "16px" }}>
                  <div
                    style={{
                      fontSize: "12px",
                      color: currentTheme.textDim,
                      marginBottom: "8px"
                    }}
                  >
                    TARGET WORD
                  </div>

                  <div
                    style={{
                      fontSize: "28px",
                      fontWeight: 700,
                      letterSpacing: "4px",
                      marginBottom: "12px"
                    }}
                  >
                    {practiceWord}
                  </div>
                    
                  {!practiceCompleted && (
                    <>
                      <div
                        style={{
                          fontSize: "12px",
                          color: currentTheme.textDim
                        }}
                      >
                        Expected Letter
                      </div>

                      <div
                        style={{
                          fontSize: "42px",
                          fontWeight: 700,
                          color: currentTheme.primary,
                          marginBottom: "12px"
                        }}
                      >
                        {expectedLetter}
                      </div>

                      {gestureImage && (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "center",
                            marginTop: "8px"
                          }}
                        >
                          <img
                            src={gestureImage}
                            alt={`Gesture ${expectedLetter}`}
                            style={{
                              width: "180px",
                              maxWidth: "100%",
                              borderRadius: "12px",
                              border: `1px solid ${currentTheme.border}`,
                              background: "#fff",
                              objectFit: "contain"
                            }}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {practiceCompleted && (
                    <div
                      style={{
                        marginTop: "10px",
                        color: currentTheme.green,
                        fontWeight: 700,
                        fontSize: "18px"
                      }}
                    >
                      ✓ COMPLETED
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: "12px",
                      height: "8px",
                      background: darkMode ? "#334155" : "#e2e8f0",
                      borderRadius: "999px",
                      overflow: "hidden"
                    }}
                  >
                    <div
                      style={{
                        width: `${practiceProgress}%`,
                        height: "100%",
                        background: currentTheme.primary,
                        transition: "0.3s"
                      }}
                    />
                  </div>

                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "12px",
                      color: currentTheme.textDim
                    }}
                  >
                    {practiceProgress.toFixed(0)}%
                  </div>
                </div>
              )}
            </div>
          {/* CARD STATISTICS (Dipendekkan secara optimal & presisi) */}
          <div style={s.statsCardWrapper}>
            <h2 style={s.cardTitle}>Real-time Statistics</h2>
            <div style={s.statsGrid}>
              <div style={s.statCard}>
                <span style={{ fontSize: "10px", color: currentTheme.textDim, fontWeight: "600", textTransform: "uppercase" }}>Objects</span>
                <span style={s.statVal}>{detections.length}</span>
              </div>
              <div style={s.statCard}>
                <span style={{ fontSize: "10px", color: currentTheme.textDim, fontWeight: "600", textTransform: "uppercase" }}>FPS</span>
                <span style={s.statVal}>{fps}</span>
              </div>
              <div style={s.statCard}>
                <span style={{ fontSize: "10px", color: currentTheme.textDim, fontWeight: "600", textTransform: "uppercase" }}>Confidence</span>
                <span style={s.statVal}>
                  {detections[0] ? `${(detections[0].confidence * 100).toFixed(0)}%` : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* CARD DETECTION HISTORY */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Detection History</h2>
            {history.length > 0 ? (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {history.map((h, i) => (
                  <span 
                    key={h.ts} 
                    style={{ 
                      padding: "6px 12px", 
                      borderRadius: "6px", 
                      background: i === history.length - 1 ? currentTheme.primaryLight : (darkMode ? "#334155" : "#f1f5f9"), 
                      color: i === history.length - 1 ? currentTheme.primary : currentTheme.text, 
                      fontSize: "12px", 
                      fontWeight: "600" 
                    }}
                  >
                    {h.label}
                  </span>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: currentTheme.textDim, fontStyle: "italic", fontWeight: "500" }}>
                Waiting for detections...
              </div>
            )}
          </div>

        </div>

        {/* KOLOM KANAN */}
        <div style={{ ...s.card, ...s.rightColumn, display: "flex", flexDirection: "column", gap: "20px", height: isDesktop ? "100%" : "auto", minHeight: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <div>
              <h2 style={{ ...s.cardTitle, margin: 0, color: currentTheme.text, fontSize: "16px", textTransform: "none", letterSpacing: "normal" }}>SIBI Analytics Module</h2>
              <p style={{ fontSize: "13px", color: currentTheme.textDim, margin: "4px 0 0 0", fontWeight: "500" }}>Real-time Indonesian Sign Language Recognition</p>
            </div>
            
            <button style={s.btnAction(cameraOn)} onClick={cameraOn ? stopCamera : startCamera}>
              {cameraOn ? (
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              )}
              {cameraOn ? "Stop Stream" : "Start Camera"}
            </button>
          </div>

          {/* Screen Workspace Monitor */}
          <div style={s.videoArea}>
            <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraOn ? "block" : "none" }} muted playsInline />
            
            {!cameraOn && (
              <div style={{ textAlign: "center", padding: "0 16px" }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={currentTheme.textDim} strokeWidth="1.5" style={{ marginBottom: "12px" }}>
                  <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
                <div style={{ fontSize: "13px", fontWeight: "600", color: currentTheme.textDim, textTransform: "uppercase", letterSpacing: "1px" }}>Camera Standby</div>
              </div>
            )}

            {/* Bounding Box */}
            {cameraOn && detections.map((det, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${det.bbox.x * 100}%`,
                  top: `${det.bbox.y * 100}%`,
                  width: `${det.bbox.w * 100}%`,
                  height: `${det.bbox.h * 100}%`,
                  border: `2px solid ${currentTheme.primary}`,
                  borderRadius: "4px",
                  pointerEvents: "none"
                }}
              >
                <span style={{ position: "absolute", top: "-22px", left: "-2px", background: currentTheme.primary, color: "#fff", fontSize: "10px", padding: "2px 6px", fontWeight: "600", borderRadius: "4px" }}>
                  {det.label}
                </span>
              </div>
            ))}
          </div>

          {/* Big Output Teks */}
          <div style={s.bigLabelBox}>
            {lastLabel ? (
              <div style={s.labelText}>
                {lastLabel}
              </div>
            ) : (
              <div style={s.inactiveText}>
                {cameraOn ? "Scanning Stream..." : "Engine Inactive"}
              </div>
            )}
          </div>
        </div>

      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Footer */}
      <div style={s.footer}>
        SIBI AI System v1.1 • Enterprise Solution 2026
      </div>
    </div>
  );
}