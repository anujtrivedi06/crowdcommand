# CrowdCommand — AI-Native Stadium Crowd Management Platform

> **Live Dashboard:** [https://crowdcommand.web.app](https://crowdcommand.web.app)  
> **Fan PWA:** [https://crowdcommand-fan.web.app](https://crowdcommand-fan.web.app?fanId=demo&gateId=3)  
> **Demo scenario walkthrough:** [Jump to Demo Section](#6-demo-scenario-walkthrough)

CrowdCommand is a multi-agent AI platform that unifies ticketing, crowd flow, security, weather, and emergency response into a single real-time command interface for stadium operators. Built for M. Chinnaswamy Stadium, Bengaluru (capacity: 35,000), it replaces fragmented radio communication and manual monitoring with a coordinated AI system where five specialist agents continuously reason over live sensor data, call each other via Firestore signals, and surface actionable decisions — with human confirmation required for irreversible actions like evacuation. When a crush begins forming at Gate 3, CrowdCommand detects it in seconds, reroutes fans, dispatches volunteers, updates the LED boards, notifies the crowd, and logs every decision for post-event accountability — all without a human having to notice the problem first.

---

## 1. Project Overview

Stadium operations during large events are a coordination nightmare: gate operators, security teams, medical staff, and venue managers work in silos, communicating via radio with no shared situational awareness. CrowdCommand solves this by deploying five specialised AI agents — Ticketing, Crowd Flow, Security, Weather, and Emergency — each monitoring its domain in real time and communicating structured signals through a central Orchestrator powered by Gemini. The Orchestrator synthesises all signals into prioritised action plans, executes safe actions automatically, and surfaces dangerous decisions to operators with full AI reasoning before requiring human confirmation. The result is a command centre where a single operator can manage 35,000 fans across 12 stadium zones with confidence that no critical event will be missed.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FIREBASE HOSTING                              │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐ │
│  │   Command Dashboard       │  │   Fan PWA                        │ │
│  │   crowdcommand.web.app    │  │   crowdcommand-fan.web.app       │ │
│  │   React + Google Maps     │  │   React PWA, Hindi/Kannada/EN    │ │
│  └──────────┬───────────────┘  └──────────────┬───────────────────┘ │
└─────────────│────────────────────────────────────│───────────────────┘
              │  onSnapshot listeners               │  REST calls + FCM
              ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CLOUD FIRESTORE                                 │
│  zones/  alerts/  sos/  actions/  agent_signals/  audit_log/        │
│  volunteers/  evacuation/  config/  fraud_alerts/  security_alerts/  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  onWrite triggers + Scheduled Functions
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   FIREBASE CLOUD FUNCTIONS                           │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    ORCHESTRATOR AGENT                        │    │
│  │         Gemini 1.5 Flash — synthesises all signals           │    │
│  │         Writes ActionPlan → Firestore actions/current        │    │
│  └──────────┬──────────┬──────────┬──────────┬────────────────┘    │
│             │          │          │          │                       │
│  ┌──────────▼──┐  ┌────▼────┐  ┌─▼──────┐  ┌▼──────────┐         │
│  │  Ticketing  │  │  Crowd  │  │Security│  │  Weather  │          │
│  │   Agent     │  │  Flow   │  │ Agent  │  │  Agent    │          │
│  │  Gemini ✓   │  │  Agent  │  │Gemini ✓│  │ Gemini ✓  │          │
│  └─────────────┘  │ Gemini ✓│  └────────┘  └───────────┘          │
│                   └─────────┘                                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              EMERGENCY AGENT — Gemini ✓                       │   │
│  │  Evacuation planning, SOS cluster detection, evac confirmation │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Simulators: sensorSimulator / gateSimulator / weatherSimulator      │
│  Routers: dashboardRoutes / fanRoutes / sosRoutes / analyticsRoutes  │
└─────────────────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
┌─────────────────────┐        ┌────────────────────────┐
│   VERTEX AI          │        │  GOOGLE MAPS PLATFORM  │
│   Gemini 1.5 Flash   │        │  Exit routing, zone    │
│   All 5 agents +     │        │  overlays, SOS pins    │
│   Orchestrator       │        └────────────────────────┘
└─────────────────────┘
              │
              ▼
┌─────────────────────┐
│  FIREBASE CLOUD     │
│  MESSAGING (FCM)    │
│  Fan notifications  │
│  Volunteer alerts   │
│  Wave exit pushes   │
└─────────────────────┘
```

---

## 3. Agent Descriptions

### Ticketing Agent
The Ticketing Agent monitors the `gate_scans` Firestore collection for fraudulent entry patterns. It checks three conditions on every gate scan: duplicate QR code reuse (same ticket scanned more than once), device rate limiting (more than 5 scans from the same device within 60 seconds, indicating a cloned-ticket operation), and zone mismatch (a fan scanning at a gate outside their assigned zone block). When any flag fires, it writes a structured fraud alert to `fraud_alerts` with the specific violation type, gate number, and fan ID, which surfaces immediately in the command dashboard as an amber alert. The agent uses rule-based logic for speed rather than calling Gemini — fraud detection must be near-instantaneous and deterministic.

### Crowd Flow Agent
The Crowd Flow Agent is the busiest agent in the system. It triggers on every write to the `zones` collection, reads the last 5 density readings from each zone's history subcollection, and calculates per-zone rate-of-change. When any zone exceeds 4 density points per reading (indicating a forming crush), it calls Gemini with the full stadium context — all 12 zone densities, rates of change, match phase, weather status, and active volunteer count. Gemini returns a structured surge prediction: affected zones, estimated minutes to critical, recommended rerouting actions, and risk level. This prediction is written to `alerts` and displayed instantly in the dashboard. The agent also handles gate rerouting: when a gate hits 80% capacity, it identifies the nearest alternative gate, writes a rerouting action, and triggers FCM push notifications to redirect fans.

### Security Agent
The Security Agent runs on a 30-second scheduled interval, calling the Vision AI mock scoring function for all 12 zones. In production mode, it would call the real Google Vision AI API with CCTV frame data; in the demo environment, it uses a deterministic mock that generates realistic anomaly scores (15% chance of non-normal labels including crowd_surge, abandoned_object, and aggression, with scores between 0.7 and 0.95). When a zone's anomaly score exceeds the 0.7 threshold, the agent calls Gemini with the zone context and anomaly label to reason about severity and recommended response. High-severity findings are escalated to the orchestrator via `agent_signals`; medium-severity findings write directly to `security_alerts` for operator awareness without interrupting the action flow.

### Weather Agent
The Weather Agent monitors `weather_events` for conditions that affect fan safety and crowd dynamics. When a weather event arrives (rain, lightning, or heatwave), it calls Gemini with the current zone configuration and volunteer positions to assess risk level. For medium-or-above risk, it writes a `weather_reroute` signal to `agent_signals`, which the orchestrator picks up and converts into a fan-facing rerouting instruction directing fans toward covered zones. The agent also considers the interaction between weather and crowd density — a rainstorm during peak post-match egress is far more dangerous than during pre-match entry — and factors this compound risk into its Gemini prompt.

### Emergency Agent
The Emergency Agent handles the highest-stakes decisions in the system. It triggers when a document is written to `emergency_triggers`, which happens either via the SOS cluster detector (3+ simultaneous SOSes in a 50m radius within 2 minutes) or via operator-initiated emergency declaration. It calls Gemini with the complete stadium state — all zone densities, all gate statuses, all volunteer locations, and the trigger reason — and Gemini returns a full evacuation plan: which exits to open and close, volunteer assignments by ID, a PA announcement script, and a fan-app message. Crucially, this plan is written with status `pending_confirmation` and displayed to the operator before any action executes. The operator must press Confirm to activate it. This human-in-the-loop requirement is a deliberate design decision (see Section 7) and cannot be bypassed programmatically.

### Orchestrator
The Orchestrator is the central coordinator. It listens to `agent_signals` via Firestore onSnapshot and collects all signals from the last 60 seconds when a new one arrives. It then calls Gemini with the full multi-agent context — current match phase, all zone densities, active alert counts, active SOS count, weather status, and all recent signals — and asks Gemini to synthesise a prioritised ActionPlan. The ActionPlan specifies: priority (1-5), action type, target zones, fan-facing message, staff-facing message, full AI rationale, and whether human confirmation is required. Low-priority safe actions execute immediately; high-priority or dangerous actions surface to the operator via the EvacPlanModal. This design means the system can handle simultaneous crowd surge + security alert + weather event as a unified response rather than three competing notifications.

---

## 4. Google Cloud Products Used

| Product | Purpose | Where in code |
|---|---|---|
| **Firebase Hosting** | Hosts both the command dashboard and fan PWA as static sites | `firebase.json` hosting targets; deployed via `firebase deploy` |
| **Cloud Firestore** | Central real-time data store for all agent signals, zone data, alerts, SOS events, and audit trail | `functions/services/firestoreService.js`; all agents read/write here |
| **Firebase Cloud Functions** | Runs all backend logic — agents, simulators, routers, orchestrator | `functions/index.js` exports; all agent files in `functions/agents/` |
| **Firebase Cloud Messaging (FCM)** | Push notifications to fans (gate changes, wave exit) and volunteers (task dispatch, SOS response) | `functions/services/notificationService.js` |
| **Firebase Scheduled Functions** | Drives sensorSimulator (every 1 min), CCTV scoring (every 30 sec), SOS cluster detection (every 1 min) | `functions/simulators/`; `functions/agents/securityAgent.js` |
| **Vertex AI — Gemini 1.5 Flash** | Powers all 5 agents and the orchestrator for reasoning, surge prediction, evacuation planning, and risk assessment | `functions/services/geminiService.js`; called from all agent files |
| **Google Maps Platform** | Zone polygon overlays on heatmap, exit route calculation for SOS, volunteer location pins | `functions/services/mapsService.js`; `dashboard/src/components/CrowdHeatmap.js` |
| **Google Vision AI** | CCTV anomaly detection (mocked in demo; real API call controlled by `USE_MOCK_VISION` flag) | `functions/services/visionService.js` |

---

## 5. Feature List

- **Real-time crowd density heatmap** — Live Google Maps overlay with 12 colour-coded zone polygons (green/amber/red), updated every 5 seconds via Firestore onSnapshot
- **Predictive surge forecasting** — Gemini analyses rate-of-change across zones and predicts time-to-critical with recommended actions
- **Dynamic gate rerouting** — Automatic fan notification and LED board update when gate capacity exceeds 80%
- **Auto evacuation protocol** — Gemini generates full evacuation plan; human confirmation required before execution
- **Weather-triggered rerouting** — Weather agent detects rain/lightning/heatwave and reroutes fans to covered zones via orchestrator
- **Volunteer task auto-dispatch** — Nearest available volunteers dispatched to choke points via GPS-based proximity matching
- **SOS button with exit routing** — Fan PWA SOS trigger returns personalised exit route within 3 seconds, avoids high-density zones
- **SOS cluster detection** — Scheduled function detects 3+ concurrent SOSes within 50m and auto-triggers evacuation protocol
- **Post-match wave exit staggering** — Zones released in 3 waves over 8 minutes to prevent post-match crush
- **Fan PWA with multilingual support** — Full UI in English, Hindi, and Kannada with PWA install prompt
- **Immutable audit trail** — Every agent action, operator decision, and AI rationale logged to Firestore with timestamp
- **Ticketing fraud detection** — Real-time duplicate ticket, device rate, and zone mismatch detection
- **CCTV anomaly detection** — Scheduled Vision AI scoring with mock for demo; real API in production
- **DemoControls panel** — One-click triggers for all demo scenarios with clean reset capability

---

## 6. Demo Scenario Walkthrough

*This is the exact sequence for Phase 2 live presentation. Total time: ~4 minutes.*

**Step 1 — Dashboard baseline (30 seconds)**  
Open [https://crowdcommand.web.app](https://crowdcommand.web.app). The heatmap shows all 12 zones with live colour-coded density — mostly green with a few amber zones reflecting pre-match arrivals. The alert feed shows normal sensor heartbeats. The audit trail tab shows the simulator writing zone data every minute. Match phase indicator shows "PRE-MATCH" in the top bar. Point out the 5 agent status indicators all showing green.

**Step 2 — Surge prediction and gate rerouting (60 seconds)**  
Press **"Trigger surge at Gate 3"** in the DemoControls panel. Within 5 seconds: Zone 3 on the heatmap turns red. The alert feed shows a new surge prediction alert with Gemini's full reasoning — "Zone 3 density at 85%, increasing at 4.2 points/reading, estimated 3 minutes to critical. Recommend immediate rerouting to Gate 4." The LEDBoard panel in the dashboard updates to show "GATE 3 FULL — PLEASE USE GATE 4." A gate rerouting action appears in the audit trail. On a second browser tab showing the fan PWA (pre-opened at `?fanId=demo&gateId=3`), the MyGate screen updates to show the alternate gate instruction.

**Step 3 — SOS emergency response (60 seconds)**  
Press **"Trigger SOS (demo fan)"** in DemoControls. The SOSTracker panel shows a pulsing red dot appearing at the centre of Zone 5. The alert feed shows a new security escalation. Switch to the fan PWA tab — the SOSActive screen shows an exit route rendered on a Google Maps embed, a "Security is on the way" message with a pulsing indicator, and a security responder dot beginning to animate toward the fan's position. Back on the dashboard, the security personnel nearest to Zone 5 show status "responding" in the VolunteerMap. The audit trail shows the SOS event, route calculation, and volunteer assignment logged with full timestamps.

**Step 4 — Weather-driven rerouting (30 seconds)**  
Press **"Trigger weather alert"** in DemoControls. The WeatherWidget in the top bar turns amber and shows "RAIN — Medium Risk" with Gemini's risk assessment beneath it: "Rainfall detected. Zones 1, 3, 5 are open-air. Rerouting fans to covered Zones 7, 9, 11." The fan PWA ExitGuide updates the displayed route. A weather rerouting action appears in the audit trail showing the orchestrator synthesised the weather signal with the existing surge condition before choosing a response.

**Step 5 — Post-match wave staggering (30 seconds)**  
Press **"End match"** (top bar button, visible when match phase is in-match — trigger a match start first via DemoControls if needed). The match phase indicator changes to "POST-MATCH." Wave 1 triggers immediately: Zones 1–4 show "EXIT NOW — USE GATE A/B" on the LEDBoard, and fans in those zones receive FCM push notifications. Wave 2 shows a 4-minute countdown for Zones 5–8. Wave 3 shows an 8-minute countdown for Zones 9–12. The LEDBoard cycles through each wave message on a 10-second loop.

**Step 6 — Audit trail accountability (30 seconds)**  
Click the **AuditTrail** tab. Show the complete chronological log of every action from Steps 1–5: blue entries for agent actions, amber for operator decisions, red for emergency events, green for resolutions. Each entry shows the timestamp, responsible agent, Gemini's reasoning excerpt, and outcome. This is the accountability story — every AI decision is traceable and explainable.

**Step 7 — Reset for next judge (15 seconds)**  
Press **"Reset demo"** in DemoControls. All zone densities reset to pre-match baseline (15–35%), all active alerts and SOSes clear, match phase returns to "PRE-MATCH", LEDBoard shows welcome message. System is ready for the next demo run.

---

## 7. Design Decisions

**Firebase over Cloud Run**  
Cloud Run requires managing container lifecycle, cold start latency, and scaling configuration — all of which add operational complexity that isn't needed here. Firebase Cloud Functions with Firestore triggers give us event-driven execution with zero infrastructure management and sub-second trigger latency on Firestore writes. For a stadium operations system where every second matters, eliminating cold-start unpredictability was the right tradeoff.

**Firestore as the agent communication bus (replacing Pub/Sub)**  
Pub/Sub is the canonical Google choice for event-driven microservices, but it adds subscription management complexity and doesn't give us the real-time dashboard updates we need without a separate Firestore sync layer. By using Firestore `agent_signals` as the communication bus — agents write signals, the orchestrator listens via onSnapshot — we get both the event-driven agent coordination AND the real-time dashboard update in a single write. The tradeoff is that Firestore isn't built for high-throughput messaging (Pub/Sub handles millions of messages per second vs Firestore's practical limit of a few hundred writes per second per collection), but at stadium scale (12 zones, 5 agents, ~60 signals per minute) this is entirely sufficient.

**Human confirmation required for evacuation**  
The system deliberately prevents automatic evacuation execution. Even when Gemini generates a complete, high-confidence evacuation plan, it is written with `status: "pending_confirmation"` and requires an operator to press Confirm before any action executes. This is a safety-critical design decision: false positives in evacuation triggers (e.g., a momentary sensor spike misread as a crush event) could cause a panic-induced secondary emergency worse than the original. The cost of 20–30 seconds of human review is far lower than the cost of an incorrectly triggered evacuation of 35,000 people. Judges should note that this constraint is enforced in code — there is no API path that bypasses the confirmation check.

**Gemini fallback behaviour**  
Every Gemini call in `geminiService.js` is wrapped in try/catch with a hardcoded safe-default response for each agent. If the Gemini API is unavailable or returns invalid JSON, the system never crashes — instead it returns a conservative fallback (e.g., the crowd flow agent returns risk_level "medium" with recommendation "manual inspection required"). This means the system degrades gracefully to a human-supervised mode rather than failing open or closed. The fallback behaviour is logged in the audit trail so operators know when AI reasoning was unavailable.

**Gemini 1.5 Flash over Pro**  
Speed matters more than raw reasoning power in a real-time crowd safety system. Flash responds in ~1–2 seconds vs Pro's ~5–10 seconds, which is the difference between detecting a forming crush before it becomes dangerous and detecting it too late. The structured JSON prompting approach (system prompt + explicit schema) compensates for any reasoning depth difference by constraining the output format.

**Mock Vision AI in demo mode**  
Vision AI is only called with real CCTV frames when `USE_MOCK_VISION=false` in config. During the demo and always-on hosting, the mock generates realistic anomaly scores deterministically. This was a deliberate choice: live Vision AI calls require real camera feeds and introduce latency variability that could make the demo unreliable. The mock is documented honestly, and the real integration path is fully implemented and can be enabled with a single config flag.

---

## 8. Known Limitations and Production Roadmap

| What is simulated | How it would work in production |
|---|---|
| IoT zone density sensors (Scheduled Function writing random values) | Physical pressure sensors, computer vision footfall counters, or WiFi probe counting deployed in each zone, feeding a real-time IoT pipeline |
| CCTV anomaly detection (deterministic mock) | Real Vision AI API with live CCTV feeds, requiring camera infrastructure and a frame extraction pipeline |
| Weather data (simulated events) | Integration with India Meteorological Department API or Google Weather API for real forecast and radar data |
| Fan GPS in SOS (browser Geolocation API) | Production apps would use native iOS/Android SDK for more accurate positioning; web Geolocation can be ±50–100m |
| Volunteer locations (static seeded data) | Mobile app for field staff with background GPS reporting, similar to delivery driver tracking |
| FCM push notifications (functional but not end-to-end tested at scale) | Full FCM integration with topic subscriptions per zone; tested at load in staging environment |
| 20 seeded volunteers | Real volunteer management integration with stadium operations software (e.g., EventsAir or custom HR system) |
| Post-match wave staggering (timer-based) | Integration with ticketing system to target push notifications to specific fan accounts by seat location |
| Gemini reasoning (single-turn) | Multi-turn agent conversations with persistent context; retrieval-augmented generation using historical incident data |

---

## 9. Setup Instructions

### Prerequisites
- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`
- Google Cloud project with Vertex AI, Maps Platform, and Vision AI APIs enabled
- Firebase project with Firestore, Cloud Functions, Hosting, and FCM enabled

### Local development

```bash
git clone https://github.com/your-repo/crowdcommand
cd crowdcommand

# Copy and fill in environment variables
cp .env.example functions/.env

# Install function dependencies
cd functions && npm install

# Install dashboard dependencies
cd ../dashboard && npm install

# Install fan PWA dependencies
cd ../fan-pwa && npm install

# Start Firebase emulators (Firestore + Functions)
cd .. && firebase emulators:start

# In separate terminal — start dashboard
cd dashboard && npm start

# In separate terminal — start fan PWA
cd fan-pwa && npm start
```

### Deploy to Firebase

```bash
# Build both frontends
cd dashboard && npm run build
cd ../fan-pwa && npm run build

# Deploy everything
cd .. && firebase deploy
```

### Seed demo data

```bash
# Run the seeder to populate volunteers, zones, and config
cd functions && node scripts/seedDemoData.js
```

The simulator Scheduled Functions will start running automatically on deploy and keep all data live.