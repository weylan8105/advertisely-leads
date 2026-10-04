"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChartPoint = { day: string; received: number; contacted: number; set: number };

export function LeadPerformanceChart({ data = [] }: { data?: ChartPoint[] }) {
  return (
    <div className="w-full h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="recv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#dc2626" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cont" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#991b1b" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#991b1b" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="set" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="day" stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              background: "rgba(10,15,31,0.95)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Area type="monotone" dataKey="received" stroke="#dc2626" fill="url(#recv)" strokeWidth={2} />
          <Area type="monotone" dataKey="contacted" stroke="#991b1b" fill="url(#cont)" strokeWidth={2} />
          <Area type="monotone" dataKey="set" stroke="#a78bfa" fill="url(#set)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
