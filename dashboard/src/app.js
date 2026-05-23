/**
 * @fileoverview Root application component for the CrowdCommand command dashboard.
 * Manages top-level layout, tab navigation, Firebase connection, and match phase state.
 * All child components receive live data via Firestore onSnapshot hooks.
 */

import React, { useState, useEffect, useCallback } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db, initMessaging, getFunctionsBaseUrl } from "./firebase";
import "./App.css";

import CrowdHeatmap from "./components/CrowdHeatmap";
import AlertFeed from "./components/AlertFeed";
import GatePanel from "./components/GatePanel";
import SOSTracker from "./components/SOSTracker";
import VolunteerMap from "./components/VolunteerMap";
import WeatherWidget from "./components/WeatherWidget";
import LEDBoard from "./components/LEDBoard";
import EvacPlanModal from "./components/EvacPlanModal";
import AuditTrail from "./components/AuditTrail";
import AnalyticsTab from "./components/AnalyticsTab";
import DemoControls from "./components/DemoControls";

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  app: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    width: "100%",
    background: "#0a0a1a",
    color: "#f1f5f9",
    fontFamily: "'Inter', sans-serif",
    overflow: "auto",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 20px",
    minHeight: "56px",
    background: "#131729",
    borderBottom: "1px solid #252c44",
    flexShrink: 0,
    zIndex: 10,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  logo: {
    fontSize: "18px",
    fontWeight: 800,
    letterSpacing: "-0.3px",
    color: "#f1f5f9",
  },
  logoAccent: {
    color: "#3b82f6",
  },
  headerDivider: {
    width: "1px",
    height: "20px",
    background: "#334155",
  },
  stadiumLabel: {
    fontSize: "12px",
    color: "#94a3b8",
    letterSpacing: "0.05em",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  phaseBadge: {
    padding: "3px 10px",
    borderRadius: "20px",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  liveIndicator: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "11px",
    color: "#22c55e",
    fontWeight: 500,
  },
  liveDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: "#22c55e",
    animation: "pulse 2s infinite",
  },
  timestamp: {
    fontSize: "11px",
    color: "#64748b",
    fontFamily: "'JetBrains Mono', monospace",
  },
  tabs: {
    display: "block",
    padding: "10px 20px 0",
    background: "#131729",
    borderBottom: "1px solid #252c44",
    flexShrink: 0,
  },
  tabsInner: {
    display: "flex",
    gap: "4px",
    width: "100%",
    maxWidth: "1460px",
    margin: "0 auto",
    overflowX: "auto",
  },
  tab: {
    padding: "9px 16px",
    fontSize: "13px",
    fontWeight: 600,
    color: "#93a0bd",
    background: "#101629",
    border: "1px solid #222a43",
    borderBottom: "none",
    cursor: "pointer",
    transition: "all 0.2s ease",
    borderRadius: "9px 9px 0 0",
    letterSpacing: "0.02em",
    whiteSpace: "nowrap",
  },
  tabActive: {
    color: "#e2ebff",
    background: "linear-gradient(180deg, #26365d 0%, #18213a 100%)",
    borderColor: "#334a80",
    boxShadow: "inset 0 -2px 0 #55a6ff",
  },
  body: {
    flex: 1,
    overflow: "auto",
    position: "relative",
    padding: "16px 20px 20px",
    background: "#0a0a1a",
  },
  bodyInner: {
    width: "100%",
    maxWidth: "1460px",
    margin: "0 auto",
    height: "calc(100vh - 136px)",
    minHeight: 540,
  },
  endMatchBtn: {
    padding: "5px 14px",
    background: "#dc2626",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.02em",
  },
};

// ─── Phase badge colours ──────────────────────────────────────────────────────

const PHASE_STYLES = {
  "pre-match":  { background: "#1e3a5f", color: "#60a5fa" },
  "in-match":   { background: "#14532d", color: "#4ade80" },
  "halftime":   { background: "#431407", color: "#fb923c" },
  "post-match": { background: "#3b0764", color: "#c084fc" },
};

// ─── Tabs config ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",  label: "Overview" },
  { id: "crowd",     label: "Crowd & Gates" },
  { id: "security",  label: "Security & SOS" },
  { id: "analytics", label: "Analytics" },
  { id: "audit",     label: "Audit Trail" },
];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Root application component. Sets up all Firestore listeners and renders
 * the tab-based dashboard layout.
 *
 * @returns {JSX.Element}
 */
export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [matchPhase, setMatchPhase] = useState("pre-match");
  const [zones, setZones] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [evacPlan, setEvacPlan] = useState(null);
  const [now, setNow] = useState(new Date());
  const [connectionStatus, setConnectionStatus] = useState("connecting");

  // ── Clock tick ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Hide initial loader once app mounts ─────────────────────────────────────
  useEffect(() => {
    const loader = document.getElementById("initial-loader");
    if (loader) {
      loader.classList.add("hidden");
      setTimeout(() => loader.remove(), 400);
    }
    initMessaging();
  }, []);

  // ── Firestore: match state ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "matchState"),
      (snap) => {
        if (snap.exists()) {
          setMatchPhase(snap.data().phase || "pre-match");
        }
        setConnectionStatus("live");
      },
      (err) => {
        console.error("[App] matchState listener error:", err.message);
        setConnectionStatus("error");
      }
    );
    return unsub;
  }, []);

  // ── Firestore: zones ────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "zones"),
      (snap) => {
        setZones(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => console.error("[App] zones listener error:", err.message)
    );
    return unsub;
  }, []);

  // ── Firestore: active alerts ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "alerts"),
      (snap) => {
        const active = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((a) => a.status === "active")
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() || 0;
            const tb = b.createdAt?.toMillis?.() || 0;
            return tb - ta;
          });
        setAlerts(active);
      },
      (err) => console.error("[App] alerts listener error:", err.message)
    );
    return unsub;
  }, []);

  // ── Firestore: evacuation plan ──────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "evacuation", "current"),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.status === "pending_confirmation") {
            setEvacPlan(data);
          } else {
            setEvacPlan(null);
          }
        } else {
          setEvacPlan(null);
        }
      },
      (err) => console.error("[App] evacuation listener error:", err.message)
    );
    return unsub;
  }, []);

  // ── End match handler ───────────────────────────────────────────────────────
  const handleEndMatch = useCallback(async () => {
    if (!window.confirm("End the match and begin wave exit staggering?")) return;
    try {
      const base = getFunctionsBaseUrl();
      await fetch(`${base}/endMatch`, { method: "POST" });
    } catch (err) {
      console.error("[App] endMatch error:", err.message);
    }
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const phaseStyle = PHASE_STYLES[matchPhase] || PHASE_STYLES["pre-match"];
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={styles.app}>
      {/* ── Global keyframe injection ── */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes sosPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
        }
        button:hover { opacity: 0.85; }
      `}</style>

      {/* ── Header ── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>
            Crowd<span style={styles.logoAccent}>Command</span>
          </div>
          <div style={styles.headerDivider} />
          <div style={styles.stadiumLabel}>M. Chinnaswamy Stadium · Bengaluru</div>
        </div>

        <div style={styles.headerRight}>
          {/* Live indicator */}
          <div style={styles.liveIndicator}>
            <div
              style={{
                ...styles.liveDot,
                background: connectionStatus === "error" ? "#ef4444" : "#22c55e",
              }}
            />
            {connectionStatus === "error" ? "Reconnecting" : "Live"}
          </div>

          {/* Clock */}
          <div style={styles.timestamp}>{timeStr}</div>

          {/* Match phase badge */}
          <div style={{ ...styles.phaseBadge, ...phaseStyle }}>
            {matchPhase}
          </div>

          {/* End match button — only visible during in-match phase */}
          {matchPhase === "in-match" && (
            <button style={styles.endMatchBtn} onClick={handleEndMatch}>
              End Match
            </button>
          )}

          {/* Active alert count badge */}
          {alerts.length > 0 && (
            <div
              style={{
                padding: "3px 10px",
                background: "#450a0a",
                color: "#fca5a5",
                borderRadius: "20px",
                fontSize: "11px",
                fontWeight: 600,
              }}
            >
              {alerts.length} alert{alerts.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </header>

      {/* ── Tab bar ── */}
      <nav style={styles.tabs}>
        <div style={styles.tabsInner}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              style={{
                ...styles.tab,
                ...(activeTab === tab.id ? styles.tabActive : {}),
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Tab content ── */}
      <main style={styles.body}>
        <div style={styles.bodyInner}>
          {activeTab === "overview" && (
            <OverviewTab zones={zones} alerts={alerts} matchPhase={matchPhase} />
          )}
          {activeTab === "crowd" && (
            <CrowdTab zones={zones} matchPhase={matchPhase} />
          )}
          {activeTab === "security" && (
            <SecurityTab zones={zones} />
          )}
          {activeTab === "analytics" && (
            <AnalyticsTab />
          )}
          {activeTab === "audit" && (
            <AuditTrail />
          )}
        </div>
      </main>

      {/* ── Evacuation plan modal — rendered over all tabs ── */}
      {evacPlan && (
        <EvacPlanModal plan={evacPlan} onClose={() => setEvacPlan(null)} />
      )}

      {/* ── Demo controls — always visible ── */}
      <DemoControls matchPhase={matchPhase} />
    </div>
  );
}

// ─── Tab layout components ────────────────────────────────────────────────────

/**
 * Overview tab — heatmap, alert feed, weather, LED board, and zone stats.
 *
 * @param {{ zones: Array, alerts: Array, matchPhase: string }} props
 * @returns {JSX.Element}
 */
function OverviewTab({ zones, alerts, matchPhase }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 340px",
        gridTemplateRows: "1fr 180px",
        gap: "8px",
        height: "100%",
        background: "transparent",
      }}
    >
      {/* Heatmap — spans both rows on the left */}
      <div style={{ gridRow: "1 / 3", background: "#12182b", overflow: "hidden", borderRadius: 12, border: "1px solid #222a43" }}>
        <CrowdHeatmap zones={zones} matchPhase={matchPhase} />
      </div>

      {/* Alert feed */}
      <div style={{ background: "#12182b", overflow: "hidden", borderRadius: 12, border: "1px solid #222a43" }}>
        <AlertFeed alerts={alerts} />
      </div>

      {/* Weather + LED board stacked */}
      <div
        style={{
          background: "#12182b",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          overflow: "hidden",
          borderRadius: 12,
          border: "1px solid #222a43",
          padding: 8,
        }}
      >
        <WeatherWidget />
        <LEDBoard matchPhase={matchPhase} />
      </div>
    </div>
  );
}

/**
 * Crowd & Gates tab — full heatmap + gate panel side by side.
 *
 * @param {{ zones: Array, matchPhase: string }} props
 * @returns {JSX.Element}
 */
function CrowdTab({ zones, matchPhase }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 360px",
        gap: "8px",
        height: "100%",
        background: "transparent",
      }}
    >
      <div style={{ background: "#12182b", overflow: "hidden", borderRadius: 12, border: "1px solid #222a43" }}>
        <CrowdHeatmap zones={zones} matchPhase={matchPhase} showControls />
      </div>
      <div style={{ background: "#12182b", overflow: "hidden", borderRadius: 12, border: "1px solid #222a43", padding: 10 }}>
        <GatePanel zones={zones} />
      </div>
    </div>
  );
}

/**
 * Security & SOS tab — SOS tracker map + volunteer map side by side.
 *
 * @param {{ zones: Array }} props
 * @returns {JSX.Element}
 */
function SecurityTab({ zones }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "8px",
        height: "100%",
        background: "transparent",
      }}
    >
      <div style={{ background: "#12182b", overflow: "hidden", borderRadius: 12, border: "1px solid #222a43", padding: 10 }}>
        <SOSTracker zones={zones} />
      </div>
      <div style={{ background: "#12182b", overflow: "hidden", borderRadius: 12, border: "1px solid #222a43", padding: 10 }}>
        <VolunteerMap zones={zones} />
      </div>
    </div>
  );
}