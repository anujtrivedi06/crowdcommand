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

  const valueColor = (kind, value) => {
    if (kind === 'density') {
      if (value > 75) return '#f87171';
      if (value >= 50) return '#fbbf24';
      return '#22d3ee';
    }

    if (kind === 'incidents') {
      if (value >= 5) return '#f87171';
      if (value >= 2) return '#fbbf24';
      return '#22d3ee';
    }

    return '#22d3ee';
  };

  const styles = {
    shell: {
      height: '100%',
      overflowY: 'auto',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    },
    heading: {
      margin: 0,
      color: '#e4ebff',
      fontSize: 18,
      fontWeight: 800,
      letterSpacing: 0.2,
    },
    cardGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 12,
    },
    card: {
      background: '#1a1a2e',
      border: '1px solid #2a2a4a',
      borderRadius: 12,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minHeight: 152,
    },
    label: {
      color: '#93a5c4',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      fontWeight: 700,
    },
    value: {
      fontSize: 32,
      fontWeight: 800,
      lineHeight: 1.05,
    },
    subtext: {
      color: '#9cb0cf',
      fontSize: 12,
      lineHeight: 1.45,
    },
    detail: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: 0.2,
    },
    panel: {
      background: '#151b30',
      border: '1px solid #283150',
      borderRadius: 12,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    },
    panelTitle: {
      margin: 0,
      color: '#e4ebff',
      fontSize: 15,
      fontWeight: 700,
    },
    zoneList: {
      margin: 0,
      padding: 0,
      listStyle: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    },
    zoneRowTop: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    zoneName: {
      color: '#dbe5ff',
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: 0.2,
    },
    zonePercent: {
      fontSize: 13,
      fontWeight: 700,
    },
    barTrack: {
      width: '100%',
      background: '#2b3555',
      borderRadius: 999,
      height: 9,
      overflow: 'hidden',
    },
    barFill: {
      height: '100%',
      borderRadius: 999,
      transition: 'width 420ms ease',
    },
    rowMeta: {
      marginTop: 4,
      color: '#93a5c4',
      fontSize: 11,
      lineHeight: 1.3,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: '50%',
      display: 'inline-block',
      marginRight: 8,
    },
  };

  const zoneEntries = (zones || [])
    .slice()
    .sort((a, b) => String(a.zoneId || a.id).localeCompare(String(b.zoneId || b.id)));

  return (
    <div style={styles.shell}>
      <h2 style={styles.heading}>Live Analytics</h2>

      <section style={styles.cardGrid}>
        <StatCard
          label="Fans Inside"
          value={metrics.totalFans.toLocaleString('en-IN')}
          valueColor={valueColor('normal', metrics.totalFans)}
          subtext="of 35,000 capacity"
          detail={`${Math.round((metrics.totalFans / 35000) * 100)}% full`}
          detailColor={metrics.totalFans / 35000 > 0.85 ? '#fbbf24' : '#9cb0cf'}
          styles={styles}
        />

        <StatCard
          label="Avg Density"
          value={`${metrics.avgDensity}%`}
          valueColor={valueColor('density', metrics.avgDensity)}
          subtext={
            metrics.peakZone
              ? `Peak: ${metrics.peakZone.zoneId || metrics.peakZone.id} at ${metrics.peakZone.density || 0}%`
              : 'Across all active zones'
          }
          detail={metrics.avgDensity > 75 ? 'Critical' : metrics.avgDensity >= 50 ? 'Elevated' : 'Normal'}
          detailColor={valueColor('density', metrics.avgDensity)}
          styles={styles}
        />

        <StatCard
          label="Active Incidents"
          value={metrics.totalIncidents}
          valueColor={valueColor('incidents', metrics.totalIncidents)}
          subtext={`SOS ${metrics.activeSOS} · Security ${metrics.activeSecAlerts} · Fraud ${metrics.activeFraud}`}
          detail={metrics.totalIncidents === 0 ? 'All clear' : 'Needs attention'}
          detailColor={metrics.totalIncidents === 0 ? '#22d3ee' : '#f87171'}
          styles={styles}
        />

        <StatCard
          label="Volunteers"
          value={`${metrics.availableVols}/${metrics.totalVols}`}
          valueColor={valueColor('normal', metrics.availableVols)}
          subtext={`Assigned ${metrics.assignedVols} · Responding ${metrics.respondingVols}`}
          detail={
            metrics.totalVols > 0
              ? `${Math.round((metrics.availableVols / metrics.totalVols) * 100)}% available`
              : 'No data'
          }
          detailColor="#9cb0cf"
          styles={styles}
        />
      </section>

      <section style={styles.panel}>
        <h3 style={styles.panelTitle}>Zone Density Breakdown</h3>

        <ul style={styles.zoneList}>
          {zoneEntries.map((zone) => {
            const zoneId = zone.zoneId || zone.id || 'zone';
            const density = Math.max(0, Math.min(100, zone.density || 0));
            const trend = zone.trend || 'stable';
            const color = density > 75 ? '#ef4444' : density >= 50 ? '#f59e0b' : '#22c55e';

            return (
              <li key={zoneId}>
                <div style={styles.zoneRowTop}>
                  <span style={styles.zoneName}>{String(zoneId).replace('_', ' ').toUpperCase()}</span>
                  <span style={{ ...styles.zonePercent, color }}>{density}%</span>
                </div>
                <div style={styles.barTrack}>
                  <div style={{ ...styles.barFill, width: `${density}%`, background: color }} />
                </div>
                <div style={styles.rowMeta}>Trend: {trend}</div>
              </li>
            );
          })}

          {zoneEntries.length === 0 && (
            <li style={{ color: '#93a5c4', fontSize: 12 }}>Waiting for zone telemetry...</li>
          )}
        </ul>
      </section>

      <section style={styles.panel}>
        <h3 style={styles.panelTitle}>Agent Activity (Last Hour)</h3>
        <div style={{ color: '#9cb0cf', fontSize: 13, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <span>
            <span style={{ ...styles.dot, background: '#22d3ee' }} />
            <strong style={{ color: '#e4ebff' }}>{metrics.recentAgentActions}</strong> logged events
          </span>
          <span>
            <span style={{ ...styles.dot, background: '#22c55e' }} />
            Simulators running
          </span>
        </div>
      </section>
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
const StatCard = ({ label, value, subtext, detail, valueColor, detailColor, styles }) => (
  <article style={styles.card}>
    <span style={styles.label}>{label}</span>
    <span style={{ ...styles.value, color: valueColor }}>{value}</span>
    <span style={styles.subtext}>{subtext}</span>
    {detail ? <span style={{ ...styles.detail, color: detailColor }}>{detail}</span> : null}
  </article>
);

export default AnalyticsTab;