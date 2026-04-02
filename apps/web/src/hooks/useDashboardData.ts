import { useState, useEffect } from 'react';
import { api } from '../api';
import type { InstancePublic, UsageTimeseries, GroupChat, BurnRateApiData } from '@aquarium/shared';

export interface KPITrend {
  value: number;
  type: 'absolute' | 'percent';
}

export interface KPIData {
  activeAssistants: number;
  messageGroups: number;
  todaySpend: number;
  apiCalls: number;
  trends: {
    activeAssistants: KPITrend;
    messageGroups: KPITrend;
    todaySpend: KPITrend;
    apiCalls: KPITrend;
  };
}

export interface ChartDataPoint {
  date: string;
  value: number;
}

export type ActivityIcon = 'message' | 'bot' | 'group' | 'billing';

export interface ActivityItem {
  id: string;
  icon: ActivityIcon;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  instanceId: string;
  instanceName: string;
}

export interface DashboardData {
  kpi: KPIData;
  chartData: ChartDataPoint[];
  activities: ActivityItem[];
  loading: boolean;
  error: string | null;
}

const STORAGE_KEY_ASSISTANTS = 'dashboard-prev-activeAssistants';
const STORAGE_KEY_GROUPS = 'dashboard-prev-messageGroups';
const CNY_RATE = 7.2;

function loadPrev(key: string): { value: number; date: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePrev(key: string, value: number): void {
  const today = new Date().toISOString().split('T')[0];
  localStorage.setItem(key, JSON.stringify({ value, date: today }));
}

function computeAbsoluteTrend(current: number, storageKey: string): KPITrend {
  const prev = loadPrev(storageKey);
  const today = new Date().toISOString().split('T')[0];

  if (prev && prev.date !== today) {
    savePrev(storageKey, current);
    return { value: current - prev.value, type: 'absolute' };
  }

  if (!prev) {
    savePrev(storageKey, current);
  }

  return { value: 0, type: 'absolute' };
}

export function useDashboardData(): DashboardData {
  const [kpi, setKpi] = useState<KPIData>({
    activeAssistants: 0,
    messageGroups: 0,
    todaySpend: 0,
    apiCalls: 0,
    trends: {
      activeAssistants: { value: 0, type: 'absolute' },
      messageGroups: { value: 0, type: 'absolute' },
      todaySpend: { value: 0, type: 'percent' },
      apiCalls: { value: 0, type: 'percent' },
    },
  });
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        const now = new Date();
        const fourteenDaysAgo = new Date(now);
        fourteenDaysAgo.setDate(now.getDate() - 14);
        const startDate = fourteenDaysAgo.toISOString().split('T')[0];
        const todayDate = now.toISOString().split('T')[0];
        const sevenDaysAgoDate = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];

        const [instances, groupChats, timeseries, burnRate, activityData] = await Promise.all([
          api.get<InstancePublic[]>('/instances').catch(() => []),
          api.get<GroupChat[]>('/group-chats').catch(() => []),
          import.meta.env.VITE_EDITION !== 'ce'
            ? api.get<UsageTimeseries[]>(`/usage/timeseries?startDate=${startDate}`).catch(() => [])
            : Promise.resolve([]),
          import.meta.env.VITE_EDITION !== 'ce'
            ? api.get<BurnRateApiData>('/usage/burn-rate').catch(() => null)
            : Promise.resolve(null),
          api.get<ActivityItem[]>('/dashboard/activity').catch(() => []),
        ]);

        if (cancelled) return;

        const activeAssistants = instances.length;
        const messageGroups = groupChats.length;

        const todayTimeseries = timeseries.filter(entry => entry.date === todayDate);
        const todaySpendUsd = todayTimeseries.reduce((sum, entry) => sum + entry.spendUsd, 0);
        const todaySpend = todaySpendUsd * CNY_RATE;

        const totalRequestCount = timeseries.reduce(
          (sum, entry) => sum + (entry.requestCount ?? 0), 0,
        );

        let spendTrend: KPITrend = { value: 0, type: 'percent' };
        const burnRateData = burnRate?.burnRate;
        if (burnRateData && burnRateData.dailyRate30d > 0.01) {
          const pct = Math.round(((burnRateData.dailyRate7d - burnRateData.dailyRate30d) / burnRateData.dailyRate30d) * 100);
          spendTrend = { value: pct, type: 'percent' };
        }

        let apiCallsTrend: KPITrend = { value: 0, type: 'percent' };
        const recentWeek = timeseries.filter(e => e.date >= sevenDaysAgoDate);
        const prevWeek = timeseries.filter(e => e.date < sevenDaysAgoDate);
        const recentCount = recentWeek.reduce((s, e) => s + (e.requestCount ?? 0), 0);
        const prevCount = prevWeek.reduce((s, e) => s + (e.requestCount ?? 0), 0);
        if (prevCount > 0) {
          const pct = Math.round(((recentCount - prevCount) / prevCount) * 100);
          apiCallsTrend = { value: pct, type: 'percent' };
        }

        const dailyMap = new Map<string, number>();
        for (const entry of timeseries) {
          const existing = dailyMap.get(entry.date) ?? 0;
          dailyMap.set(entry.date, existing + (entry.requestCount ?? 0));
        }
        const chart = Array.from(dailyMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, value]) => ({
            date: date.slice(5),
            value,
          }));

        if (!cancelled) {
          setKpi({
            activeAssistants,
            messageGroups,
            todaySpend: Math.round(todaySpend * 100) / 100,
            apiCalls: totalRequestCount,
            trends: {
              activeAssistants: computeAbsoluteTrend(activeAssistants, STORAGE_KEY_ASSISTANTS),
              messageGroups: computeAbsoluteTrend(messageGroups, STORAGE_KEY_GROUPS),
              todaySpend: spendTrend,
              apiCalls: apiCallsTrend,
            },
          });
          setChartData(chart);
          setActivities(activityData);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => { cancelled = true; };
  }, []);

  return { kpi, chartData, activities, loading, error };
}
