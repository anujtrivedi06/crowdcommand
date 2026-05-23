import React, { useEffect, useRef, useState } from 'react';
import { useDocument, useWaveSequence } from '../hooks/useFirestore';

/**
 * Default messages shown on the LED board when no override is active.
 * Cycles through these in rotation during normal operation.
 * @type {string[]}
 */
const DEFAULT_MESSAGES = [
  'WELCOME TO M. CHINNASWAMY STADIUM',
  'PLEASE FOLLOW STEWARD INSTRUCTIONS',
  'ENJOY THE MATCH — STAY SAFE',
  'EMERGENCY EXITS MARKED IN GREEN',
  'THANK YOU FOR VISITING CROWDCOMMAND STADIUM',
];

/**
 * Wave phase messages keyed by wave number and zone range.
 * @type {Object}
 */
const WAVE_MESSAGES = {
  1: 'ZONES 1–4: PLEASE PROCEED TO EXITS NOW — HAVE A SAFE JOURNEY',
  2: 'ZONES 5–8: YOUR EXIT GATES ARE NOW OPEN — PLEASE MOVE CALMLY',
  3: 'ZONES 9–12: THANK YOU FOR YOUR PATIENCE — EXITS NOW OPEN FOR ALL',
};

/**
 * Returns the display colour class for a message priority.
 * @param {string} priority - 'emergency' | 'warning' | 'info' | 'normal'
 * @returns {{ text: string, bg: string, glow: string }}
 */
function priorityColour(priority) {
  const map = {
    emergency: { text: 'text-red-400', bg: 'bg-red-950', glow: 'shadow-red-900' },
    warning: { text: 'text-amber-400', bg: 'bg-amber-950', glow: 'shadow-amber-900' },
    info: { text: 'text-blue-400', bg: 'bg-blue-950', glow: 'shadow-blue-900' },
    normal: { text: 'text-green-400', bg: 'bg-black', glow: 'shadow-green-950' },
  };
  return map[priority] || map.normal;
}

/**
 * MarqueeText — animates a single text string scrolling left to right
 * like a real LED display board.
 *
 * @param {object} props
 * @param {string} props.text - The message to display.
 * @param {string} props.colourClass - Tailwind text colour class.
 * @param {number} [props.speed=60] - Pixels per second scroll speed.
 */
function MarqueeText({ text, colourClass, speed = 60 }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const animRef = useRef(null);
  const posRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    const containerWidth = container.offsetWidth;
    const textWidth = textEl.offsetWidth;

    // Start just off the right edge
    posRef.current = containerWidth;
    textEl.style.transform = `translateX(${posRef.current}px)`;

    let last = null;

    const animate = (ts) => {
      if (last === null) last = ts;
      const delta = (ts - last) / 1000; // seconds
      last = ts;

      posRef.current -= speed * delta;

      // Reset to start once fully scrolled off left
      if (posRef.current < -(textWidth + 20)) {
        posRef.current = containerWidth + 20;
      }

      textEl.style.transform = `translateX(${posRef.current}px)`;
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [text, speed]);

  return (
    <div ref={containerRef} className="overflow-hidden relative w-full" style={{ height: '1.6em' }}>
      <span
        ref={textRef}
        className={`absolute whitespace-nowrap font-mono font-bold tracking-widest ${colourClass}`}
        style={{ willChange: 'transform', display: 'inline-block' }}
      >
        {text}
      </span>
    </div>
  );
}

/**
 * LEDBoard — simulates the stadium's LED announcement board. Shows
 * live agent-driven messages from Firestore, cycling through default
 * messages during idle periods. Reflects gate reroutes, weather alerts,
 * wave exit instructions, and evacuation PA scripts.
 *
 * @returns {JSX.Element}
 */
export default function LEDBoard() {
  const { data: ledDoc } = useDocument('config/led_board');
  const { data: evacDoc } = useDocument('evacuation/current');
  const { waveSequence } = useWaveSequence();

  const [defaultIdx, setDefaultIdx] = useState(0);
  const [currentMessage, setCurrentMessage] = useState(DEFAULT_MESSAGES[0]);
  const [priority, setPriority] = useState('normal');
  const [subMessages, setSubMessages] = useState([]);
  const [blinkActive, setBlinkActive] = useState(false);

  // Cycle default messages every 8 seconds when no override
  useEffect(() => {
    const interval = setInterval(() => {
      setDefaultIdx((i) => (i + 1) % DEFAULT_MESSAGES.length);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  // Determine active message priority: evacuation > wave > led_board override > default
  useEffect(() => {
    // 1. Evacuation PA script takes highest priority
    if (evacDoc?.status === 'executing' && evacDoc?.pa_announcement_script) {
      setCurrentMessage(evacDoc.pa_announcement_script.toUpperCase());
      setPriority('emergency');
      setBlinkActive(true);
      setSubMessages(
        evacDoc.fan_app_message ? [`FAN APP: ${evacDoc.fan_app_message.toUpperCase()}`] : []
      );
      return;
    }

    // 2. Wave exit staggering messages
    if (waveSequence?.activeWave) {
      const waveMsg = WAVE_MESSAGES[waveSequence.activeWave];
      if (waveMsg) {
        setCurrentMessage(waveMsg);
        setPriority('info');
        setBlinkActive(false);
        setSubMessages(
          waveSequence.nextWaveCountdown
            ? [`NEXT WAVE IN: ${waveSequence.nextWaveCountdown} MIN`]
            : []
        );
        return;
      }
    }

    // 3. Operator / agent override from Firestore
    if (ledDoc?.message && ledDoc?.active !== false) {
      setCurrentMessage(ledDoc.message.toUpperCase());
      setPriority(ledDoc.priority || 'normal');
      setBlinkActive(ledDoc.priority === 'emergency' || ledDoc.priority === 'warning');
      setSubMessages(ledDoc.subMessages || []);
      return;
    }

    // 4. Default cycling messages
    setCurrentMessage(DEFAULT_MESSAGES[defaultIdx]);
    setPriority('normal');
    setBlinkActive(false);
    setSubMessages([]);
  }, [evacDoc, waveSequence, ledDoc, defaultIdx]);

  const colours = priorityColour(priority);
  const scrollSpeed = priority === 'emergency' ? 90 : priority === 'warning' ? 75 : 55;

  return (
    <div className={`rounded-lg border border-gray-700 overflow-hidden ${colours.bg} shadow-inner`}>
      {/* Board header bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${blinkActive ? 'animate-pulse bg-red-500' : 'bg-green-500'}`} />
          <span className="text-xs text-gray-500 font-mono uppercase tracking-widest">
            Stadium PA / LED Board
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Simulated LED pixel indicators */}
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full ${
                blinkActive
                  ? i % 2 === 0 ? 'bg-red-500' : 'bg-red-900'
                  : priority === 'info'
                  ? i % 3 === 0 ? 'bg-blue-400' : 'bg-blue-900'
                  : i % 2 === 0 ? 'bg-green-500' : 'bg-green-900'
              }`}
              style={blinkActive ? { animationDelay: `${i * 80}ms` } : {}}
            />
          ))}
        </div>
      </div>

      {/* Main scrolling message */}
      <div className="px-3 py-3" style={{ background: 'rgba(0,0,0,0.7)' }}>
        <div className={`text-lg font-mono font-bold tracking-widest ${colours.text} drop-shadow-lg`}
          style={{ textShadow: priority === 'emergency' ? '0 0 8px #ef4444' : priority === 'warning' ? '0 0 6px #f59e0b' : '0 0 6px #22c55e' }}
        >
          <MarqueeText
            text={`\u25B6  ${currentMessage}  \u25C0\u25C0\u25C0`}
            colourClass={colours.text}
            speed={scrollSpeed}
          />
        </div>

        {/* Sub-messages */}
        {subMessages.map((msg, i) => (
          <div key={i} className="mt-1">
            <MarqueeText
              text={`   ${msg}   `}
              colourClass="text-yellow-500"
              speed={45}
            />
          </div>
        ))}
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between px-3 py-1 bg-gray-900 border-t border-gray-700">
        <span className={`text-xs font-mono uppercase ${colours.text} opacity-70`}>
          {priority === 'emergency' ? '⚠ EMERGENCY' : priority === 'warning' ? '⚡ ALERT' : priority === 'info' ? 'ℹ INFO' : '● NORMAL'}
        </span>
        <span className="text-xs text-gray-700 font-mono">
          {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
    </div>
  );
}