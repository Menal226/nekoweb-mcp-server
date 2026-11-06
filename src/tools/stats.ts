import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { nekoweb, NekowebError } from "../api.js";
import { json, READ_ONLY, resolveDomain, responseFormatField, SESSION_NOTE, siteField, text } from "./common.js";

const DAY_MS = 86_400_000;

export interface StatsSnapshot {
    time: number;
    views: number;
    followers: number;
    updates: number;
}

// The chart data is embedded as JavaScript arrays of daily snapshots: timestamps and running totals.
export function parseStats(html: string): StatsSnapshot[] | undefined {
    const array = (name: string) => {
        const match = html.match(new RegExp(`const ${name} = \\[([\\d.,\\s-]*)\\]`));
        return match
            ? match[1]
                  .split(",")
                  .filter(value => value.trim())
                  .map(Number)
            : undefined;
    };
    const [dates, views, followers, updates] = ["dates", "viewsData", "followersData", "updatesData"].map(array);
    if (!dates || !views || !followers || !updates) return undefined;
    if (![views, followers, updates].every(values => values.length === dates.length)) return undefined;
    return dates.map((time, i) => ({ time, views: views[i], followers: followers[i], updates: updates[i] }));
}

type Metric = "views" | "followers" | "updates";
const METRICS: Metric[] = ["views", "followers", "updates"];

interface StatsRow {
    label: string;
    end: StatsSnapshot;
    gained?: Record<Metric, number>;
    days?: number;
}

const gain = (from: StatsSnapshot, to: StatsSnapshot) =>
    Object.fromEntries(METRICS.map(metric => [metric, to[metric] - from[metric]])) as Record<Metric, number>;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoTime = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

function rows(snapshots: StatsSnapshot[], monthly: boolean): StatsRow[] {
    if (!monthly) {
        return snapshots.map((end, i) => {
            const prev = snapshots[i - 1];
            const days = prev ? Math.round((end.time - prev.time) / DAY_MS) : undefined;
            return { label: isoTime(end.time), end, gained: prev && gain(prev, end), days };
        });
    }
    const months = new Map<string, StatsSnapshot>();
    for (const snapshot of snapshots) months.set(dayOf(snapshot.time).slice(0, 7), snapshot);
    const ends = [...months.entries()];
    return ends.map(([label, end], i) => ({ label, end, gained: gain(i ? ends[i - 1][1] : snapshots[0], end) }));
}

const cell = (row: StatsRow, metric: Metric) => {
    const change = row.gained?.[metric];
    return change === undefined ? `${row.end[metric]}` : `${row.end[metric]} (${change >= 0 ? "+" : ""}${change})`;
};

const PERIOD_NAMES = { month: "the last month", year: "the last year", all: "all time" };

function formatStats(domain: string, period: keyof typeof PERIOD_NAMES, snapshots: StatsSnapshot[]): string {
    if (snapshots.length === 0) return `Nekoweb has no statistics for ${domain} over ${PERIOD_NAMES[period]} yet.`;
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const total = gain(first, last);
    const monthly = snapshots.length > 62;
    const table = rows(snapshots, monthly);
    const lines = [
        `# Statistics for ${domain} over ${PERIOD_NAMES[period]}`,
        "",
        `${snapshots.length} daily snapshots from ${dayOf(first.time)} to ${dayOf(last.time)} (UTC).`,
        "",
        "| | Views | Followers | Updates |",
        "|---|---|---|---|",
        `| Latest total | ${last.views} | ${last.followers} | ${last.updates} |`,
        `| Gained | ${METRICS.map(metric => `${total[metric] >= 0 ? "+" : ""}${total[metric]}`).join(" | ")} |`,
        "",
        monthly
            ? "## By month\n\nTotals at the end of each month, with the change during the month in brackets. Use response_format 'json' for every day."
            : "## By day\n\nTotals at each snapshot, with the change since the previous snapshot in brackets.",
        "",
        `| ${monthly ? "Month" : "Recorded (UTC)"} | Views | Followers | Updates |`,
        "|---|---|---|---|",
        ...table.map(row => {
            const label = row.days && row.days > 1 ? `${row.label} (${row.days} days)` : row.label;
            return `| ${label} | ${METRICS.map(metric => cell(row, metric)).join(" | ")} |`;
        })
    ];
    if (table.some(row => row.days && row.days > 1)) {
        lines.push("", "Some days have no snapshot; the change after a gap covers all the days marked.");
    }
    return lines.join("\n");
}

export function registerStatsTools(server: McpServer): void {
    server.registerTool(
        "nekoweb_get_stats_history",
        {
            title: "Get stats history",
            description: `Get the day-by-day history of one of your Nekoweb sites' views, followers and updates, the data behind the charts on its statistics page. Shows the running totals and how much each grew per day.

${SESSION_NOTE}

'period' picks how far back to look. Every account can see 'month'; Nekoweb only shows 'year' and 'all' on paid tiers, and returns an error otherwise. For current totals only, nekoweb_get_site_info is quicker and needs no session token.

Examples:
  - "How did my views grow this month?" -> {}
  - "Show my follower growth over the last year" -> { period: "year" }
  - "Raw daily numbers for my other site" -> { site: "second.nekoweb.org", response_format: "json" }`,
            inputSchema: z.strictObject({
                site: siteField,
                period: z
                    .enum(["month", "year", "all"])
                    .default("month")
                    .describe(
                        "'month' (default, about the last 30 days), 'year', or 'all' for all time. 'year' and 'all' need a paid tier."
                    ),
                response_format: responseFormatField
            }),
            annotations: READ_ONLY
        },
        async ({ site, period, response_format }, ctx) => {
            const domain = await resolveDomain(site, ctx.mcpReq.signal);
            let html: string;
            try {
                html = await nekoweb.getStatsPage(domain, period, ctx.mcpReq.signal);
            } catch (error) {
                if (error instanceof NekowebError && /tier/i.test(error.message)) {
                    throw new NekowebError(`${error.message} Try period "month", which every account can see.`);
                }
                throw error;
            }
            const snapshots = parseStats(html);
            if (!snapshots)
                throw new NekowebError(`Couldn't find the statistics on the stats page of ${domain}; Nekoweb may have changed the page.`);
            if (response_format === "json") {
                return json({
                    site: domain,
                    period,
                    snapshots: rows(snapshots, false).map(row => ({
                        recorded_at: new Date(row.end.time).toISOString(),
                        views: row.end.views,
                        followers: row.end.followers,
                        updates: row.end.updates,
                        ...(row.gained && { gained: row.gained, days: row.days })
                    }))
                });
            }
            return text(formatStats(domain, period, snapshots));
        }
    );
}
