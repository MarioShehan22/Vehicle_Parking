import {useEffect, useState} from "react";
import api from '../config/axios.js';

async function fetchSessions({ limit = 10, page = 1, status = "", search = "" } = {}) {
    const params = { limit, page };
    if (status) params.status = status;
    if (search) params.search = search;

    const { data } = await api.get("api/session", { params });
    return {
        events: Array.isArray(data?.events) ? data.events : [],
        total: typeof data?.total === "number" ? data.total : (data?.events?.length || 0),
    };
}

function formatDate(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    return isNaN(d) ? String(ts) : d.toLocaleString();
}

function calcDurationMinutes(a, b) {
    if (!a || !b) return null;
    const start = new Date(a).getTime();
    const end = new Date(b).getTime();
    if (isNaN(start) || isNaN(end)) return null;
    return Math.max(0, Math.round((end - start) / 60000));
}

function SessionsPanel() {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");

    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("");
    const [limit, setLimit] = useState(10);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    const totalPages = Math.max(1, Math.ceil((total || 0) / (limit || 10)));

    async function load() {
        setLoading(true);
        setErr("");
        try {
            const { events, total: t } = await fetchSessions({ limit, page, status, search });
            setSessions(events);
            setTotal(t || events.length);
        } catch (e) {
            setErr(e.message || "Failed to load sessions");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [limit, page, status]);

    function onSubmit(e) {
        e.preventDefault();
        setPage(1);
        load();
    }

    return (
        <div className="mt-8">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-xl font-bold">🧾 Parking Sessions</h2>
                <button
                    onClick={load}
                    className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                    Refresh
                </button>
            </div>

            <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                    className="border rounded px-3 py-2"
                    placeholder="Search by vehicle/slot…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select
                    className="border rounded px-3 py-2"
                    value={status}
                    onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                >
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="closed">Closed</option>
                </select>
                <select
                    className="border rounded px-3 py-2"
                    value={limit}
                    onChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(1); }}
                >
                    <option value={10}>10 / page</option>
                    <option value={20}>20 / page</option>
                    <option value={50}>50 / page</option>
                </select>
                <button type="submit" className="px-3 py-2 rounded bg-gray-800 text-white hover:bg-gray-900">
                    Search
                </button>
            </form>

            <div className="mt-3">
                {loading && <p>⏳ Loading sessions…</p>}
                {err && <p className="text-red-600">⚠️ {err}</p>}
            </div>

            <div className="mt-4 overflow-x-auto bg-white rounded shadow">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-100 text-left">
                    <tr>
                        <th className="px-4 py-2">Vehicle</th>
                        <th className="px-4 py-2">Slot</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2">Entry</th>
                        <th className="px-4 py-2">Exit</th>
                        <th className="px-4 py-2">Duration</th>
                        <th className="px-4 py-2">Created</th>
                    </tr>
                    </thead>
                    <tbody>
                    {sessions.length === 0 && !loading && (
                        <tr><td className="px-4 py-3" colSpan={7}><em>No sessions found.</em></td></tr>
                    )}
                    {sessions.map((s) => {
                        const id = s._id || `${s.vehicleId}-${s.entryTime || ""}`;
                        const mins = calcDurationMinutes(s.entryTime, s.exitTime);
                        return (
                            <tr key={id} className="border-t">
                                <td className="px-4 py-3">{s.vehicleId || "-"}</td>
                                <td className="px-4 py-3">{s.slotId || s.spaceId || "-"}</td>
                                <td className="px-4 py-3">
                    <span className={
                        "px-2 py-1 rounded text-xs " +
                        (s.status === "active"
                            ? "bg-green-100 text-green-700"
                            : s.status === "closed"
                                ? "bg-gray-200 text-gray-800"
                                : "bg-yellow-100 text-yellow-800")
                    }>
                      {s.status || "-"}
                    </span>
                                </td>
                                <td className="px-4 py-3">{formatDate(s.entryTime)}</td>
                                <td className="px-4 py-3">{formatDate(s.exitTime)}</td>
                                <td className="px-4 py-3">{mins !== null ? `${mins} min` : "-"}</td>
                                <td className="px-4 py-3">{formatDate(s.createdAt)}</td>
                            </tr>
                        );
                    })}
                    </tbody>
                </table>
            </div>

            <div className="mt-4 flex items-center gap-2">
                <button
                    className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                >
                    ◀ Prev
                </button>
                <span className="px-2">
          Page <b>{page}</b> / {totalPages}
        </span>
                <button
                    className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages || loading}
                >
                    Next ▶
                </button>
            </div>
        </div>
    );
}
export default SessionsPanel;