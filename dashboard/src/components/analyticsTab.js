import React, { useMemo } from 'react';
import { useFirestore } from '../hooks/useFirestore';

/**
 * AnalyticsTab component
 * Displays 4 key metric stat cards derived from live Firestore data:
 * 1. Total fans inside (from gate scans)
 * 2. Average crowd density across all zones
 * 3. Active incidents (SOS + security + fraud alerts)
 * 4. Volunteer coverage ratio
 *
 * All data is sourced from Firestore via real-time listeners.
 *
 * @returns {JSX.Element}
 */
const AnalyticsTab = () => {
  const { data: zones } = useFirestore('zones');
  const { data: gateScanStats } = useFirestore('gate_scan_stats');
  const { data: sosList } = useFirestore('sos', { where: [['status', '==', 'active']] });
  const { data: securityAlerts } = useFirestore('security_alerts', {
    where: [['status', '==', 'active']],
  });
  const { data: fraudAlerts } = useFirestore('fraud_alerts', {
    where: [['status', '==', 'active']],
  });
  const { data: volunteers } = useFirestore('volunteers');
  const { data: auditEvents } = useFirestore('audit_log', {
    orderBy: ['timestamp', 'desc'],
    limit: 200,
  });

  /**
   * Derives the 4 key metrics from live Firestore collections.
   */
  const metrics = useMemo(() => {
    // --- Metric 1: Total fans inside ---
    const totalFans = (() => {
      if (gateScanStats && gateScanStats.length > 0) {
        return gateScanStats.reduce((sum, g) => sum + (g.scansIn || 0), 0);
      }
      // Fallback: estimate from zone densities
      if (zones && zones.length > 0) {
        const avgDensity = zones.reduce((s, z) => s + (z.density || 0), 0) / zones.length;
        return Math.round((avgDensity / 100) * 35000);
      }
      return 0;
    })();

    // --- Metric 2: Average crowd density ---
    const avgDensity = (() => {
      if (!zones || zones.length === 0) return 0;
      const sum = zones.reduce((s, z) => s + (z.density || 0), 0);
      return Math.round(sum / zones.length);
    })();

    const peakZone = (() => {
      if (!zones || zones.length === 0) return null;
      return zones.reduce((max, z) => (!max || z.density > max.density ? z : max), null);
    })();

    // --- Metric 3: Active incidents ---
    const activeSOS = (sosList || []).length;
    const activeSecAlerts = (securityAlerts || []).length;
    const activeFraud = (fraudAlerts || []).length;
    const totalIncidents = activeSOS + activeSecAlerts + activeFraud;

    // --- Metric 4: Volunteer coverage ---
    const totalVols = (volunteers || []).length;
    const availableVols = (volunteers || []).filter((v) => v.status === 'available').length;
    const assignedVols = (volunteers || []).filter((v) => v.status === 'assigned').length;
    const respondingVols = (volunteers || []).filter((v) => v.status === 'responding').length;

    // --- Bonus: Agent actions in last hour ---
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const recentAgentActions = (auditEvents || []).filter((ev) => {
      const ts = ev.timestamp?.toDate ? ev.timestamp.toDate().getTime() : new Date(ev.timestamp).getTime();
      return ts > oneHourAgo;
    }).length;

    return {
      totalFans,
      avgDensity,
      peakZone,
      totalIncidents,
      activeSOS,
      activeSecAlerts,
      activeFraud,
      totalVols,
      availableVols,
      assignedVols,
      respondingVols,
      recentAgentActions,
    };
  }, [zones, gateScanStats, sosList, securityAlerts, fraudAlerts, volunteers, auditEvents]);

  /**
   * Determines density risk colour.
   * @param {number} density
   * @returns {string} Tailwind colour class
   */
  const densityColor = (density) => {
    if (density >= 75) return 'text-red-400';
    if (density >= 50) return 'text-amber-400';
    return 'text-green-400';
  };

  /**
   * Determines incident severity colour.
   * @param {number} count
   * @returns {string}
   */
  const incidentColor = (count) => {
    if (count >= 5) return 'text-red-400';
    if (count >= 2) return 'text-amber-400';
    return 'text-green-400';
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-white font-bold text-lg tracking-wide mb-2">Live Analytics</h2>

      {/* Top 4 stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Card 1 — Total fans */}
        <StatCard
          icon="👥"
          label="Fans Inside"
          value={metrics.totalFans.toLocaleString('en-IN')}
          subtext={`of 35,000 capacity`}
          valueClass="text-blue-400"
          detail={`${Math.round((metrics.totalFans / 35000) * 100)}% full`}
          detailClass={metrics.totalFans / 35000 > 0.85 ? 'text-red-400' : 'text-gray-400'}
        />

        {/* Card 2 — Average density */}
        <StatCard
          icon="🌡️"
          label="Avg Density"
          value={`${metrics.avgDensity}%`}
          subtext={
            metrics.peakZone
              ? `Peak: Zone ${metrics.peakZone.zoneId || metrics.peakZone.id} at ${metrics.peakZone.density}%`
              : 'Across 12 zones'
          }
          valueClass={densityColor(metrics.avgDensity)}
          detail={
            metrics.avgDensity >= 75
              ? 'CRITICAL'
              : metrics.avgDensity >= 50
              ? 'ELEVATED'
              : 'NORMAL'
          }
          detailClass={densityColor(metrics.avgDensity)}
        />

        {/* Card 3 — Active incidents */}
        <StatCard
          icon="🚨"
          label="Active Incidents"
          value={metrics.totalIncidents}
          subtext={`SOS: ${metrics.activeSOS} · Security: ${metrics.activeSecAlerts} · Fraud: ${metrics.activeFraud}`}
          valueClass={incidentColor(metrics.totalIncidents)}
          detail={metrics.totalIncidents === 0 ? 'All clear' : 'Requires attention'}
          detailClass={metrics.totalIncidents === 0 ? 'text-green-400' : 'text-red-400'}
        />

        {/* Card 4 — Volunteer coverage */}
        <StatCard
          icon="🦺"
          label="Volunteers"
          value={`${metrics.availableVols}/${metrics.totalVols}`}
          subtext={`Assigned: ${metrics.assignedVols} · Responding: ${metrics.respondingVols}`}
          valueClass="text-cyan-400"
          detail={
            metrics.totalVols > 0
              ? `${Math.round((metrics.availableVols / metrics.totalVols) * 100)}% available`
              : 'No data'
          }
          detailClass="text-gray-400"
        />
      </div>

      {/* Zone density breakdown */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-white font-semibold text-sm mb-3">Zone Density Breakdown</h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {(zones || [])
            .slice()
            .sort((a, b) => (a.zoneId || a.id || 0) - (b.zoneId || b.id || 0))
            .map((zone) => {
              const id = zone.zoneId || zone.id;
              const d = zone.density || 0;
              const trend = zone.trend || 'stable';
              const trendIcon = trend === 'increasing' ? '↑' : trend === 'decreasing' ? '↓' : '→';
              const trendColor =
                trend === 'increasing'
                  ? 'text-red-400'
                  : trend === 'decreasing'
                  ? 'text-green-400'
                  : 'text-gray-400';
              const barColor =
                d >= 75 ? 'bg-red-500' : d >= 50 ? 'bg-amber-500' : 'bg-green-500';

              return (
                <div key={id} className="bg-gray-700 rounded p-2 flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-300 font-mono">Z{id}</span>
                    <span className={`text-xs font-bold ${trendColor}`}>{trendIcon}</span>
                  </div>
                  {/* Bar */}
                  <div className="w-full bg-gray-600 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-700 ${barColor}`}
                      style={{ width: `${d}%` }}
                    />
                  </div>
                  <span className={`text-xs font-bold ${densityColor(d)}`}>{d}%</span>
                </div>
              );
            })}
          {(!zones || zones.length === 0) &&
            Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="bg-gray-700 rounded p-2 animate-pulse h-14" />
            ))}
        </div>
      </div>

      {/* Agent activity summary */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-white font-semibold text-sm mb-3">Agent Activity (Last Hour)</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-sm text-gray-300">
              <span className="font-bold text-white">{metrics.recentAgentActions}</span> logged events
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-gray-400">Simulators running</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * StatCard renders a single metric card with icon, value, subtext, and detail.
 *
 * @param {{ icon: string, label: string, value: string|number, subtext: string,
 *           valueClass: string, detail: string, detailClass: string }} props
 * @returns {JSX.Element}
 */
const StatCard = ({ icon, label, value, subtext, valueClass, detail, detailClass }) => (
  <div className="bg-gray-800 rounded-lg p-4 flex flex-col gap-1 border border-gray-700 hover:border-gray-500 transition-colors">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-xl">{icon}</span>
      <span className="text-xs text-gray-400 uppercase tracking-wide font-semibold">{label}</span>
    </div>
    <span className={`text-3xl font-bold leading-none ${valueClass}`}>{value}</span>
    <span className="text-xs text-gray-500 leading-snug mt-1">{subtext}</span>
    {detail && (
      <span className={`text-xs font-semibold mt-1 ${detailClass}`}>{detail}</span>
    )}
  </div>
);

export default AnalyticsTab;