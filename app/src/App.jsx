import { useEffect, useMemo, useState } from "react";
import { LOT_MAP_POINTS } from "./lotMapPoints";

const PDF_BY_SOURCE_FILE = {
  "Deschutes Heights Phase 1 Deeds": "Deschutes Heights Phase 1 Deeds.pdf",
  "Deschutes Heights 4414 Deeds": "Deschutes Heights 4414 Deeds.pdf",
  "Deschutes Heights Phase 2 Deeds": "Deschutes Heights Phase 2 Deeds.pdf",
};

const LOT_MAP_IMAGE = `${import.meta.env.BASE_URL}images/lot-map.jpg`;
const MAX_MAP_SNAP_DISTANCE = 0.045;

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatMoney(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) {
    return "-";
  }
  return MONEY.format(numberValue);
}

function parseDateKey(value) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }
  const [month, day, year] = String(value).split("/");
  if (!month || !day || !year) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(`${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`);
}

function parseLotNumber(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function readLotFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return parseLotNumber(params.get("lot"));
}

function writeLotToUrl(lot) {
  const url = new URL(window.location.href);
  if (lot === null) {
    url.searchParams.delete("lot");
  } else {
    url.searchParams.set("lot", String(lot));
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.replaceState({}, "", next);
  }
}

function pdfLinks(sourceFile, sourcePages) {
  const pdfName = PDF_BY_SOURCE_FILE[sourceFile];
  if (!pdfName || !Array.isArray(sourcePages) || sourcePages.length === 0) {
    return [];
  }
  const encodedName = encodeURIComponent(pdfName).replace(/%2F/g, "/");
  return sourcePages.map((page) => ({
    label: `p.${page}`,
    href: `${import.meta.env.BASE_URL}pdfs/${encodedName}#page=${page}`,
  }));
}

export default function App() {
  const [query, setQuery] = useState("");
  const [activeLot, setActiveLot] = useState(() => readLotFromUrl());
  const [dataset, setDataset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const urlLot = readLotFromUrl();
    if (urlLot !== null) {
      setQuery(String(urlLot));
      setActiveLot(urlLot);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const dataResp = await fetch(`${import.meta.env.BASE_URL}data/conveyance_assessment_data.json`);
        if (!dataResp.ok) {
          throw new Error("Failed to load conveyance data.");
        }
        const dataJson = await dataResp.json();
        setDataset(dataJson);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load data.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    writeLotToUrl(activeLot);
  }, [activeLot]);

  const availableLots = useMemo(() => {
    const set = new Set();
    for (const lot of dataset?.lots ?? []) {
      set.add(Number(lot.lot));
    }
    return set;
  }, [dataset]);

  const clickableMapPoints = useMemo(
    () => LOT_MAP_POINTS.filter((point) => availableLots.has(point.lot)),
    [availableLots],
  );

  const activeMapPoint = useMemo(
    () => LOT_MAP_POINTS.find((point) => point.lot === activeLot) ?? null,
    [activeLot],
  );

  const lotRecord = useMemo(() => {
    if (activeLot === null || !dataset?.lots) {
      return null;
    }
    return dataset.lots.find((lot) => Number(lot.lot) === Number(activeLot)) || null;
  }, [activeLot, dataset]);

  const sortedConveyances = useMemo(() => {
    if (!lotRecord?.conveyances) {
      return [];
    }
    return [...lotRecord.conveyances].sort((a, b) => parseDateKey(a.date) - parseDateKey(b.date));
  }, [lotRecord]);

  const lotStats = useMemo(() => {
    const stats = {
      expected: 0,
      collected: 0,
      assessedCount: 0,
    };
    for (const conveyance of sortedConveyances) {
      const assessment = conveyance.assessment;
      if (!assessment) {
        continue;
      }
      stats.assessedCount += 1;
      const expectedValue = Number(assessment.expectedAmount || 0);
      const collectedValue = Number(assessment.collectedAmount || 0);
      stats.expected += expectedValue;
      stats.collected += collectedValue;
    }
    return stats;
  }, [sortedConveyances]);

  const setSelectedLot = (lot) => {
    const parsed = parseLotNumber(lot);
    if (parsed === null) {
      setActiveLot(null);
      return;
    }
    setQuery(String(parsed));
    setActiveLot(parsed);
  };

  const submitLookup = (event) => {
    event.preventDefault();
    setSelectedLot(query);
  };

  const handleMapClick = (event) => {
    if (!clickableMapPoints.length) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = (event.clientX - rect.left) / rect.width;
    const clickY = (event.clientY - rect.top) / rect.height;

    let best = null;
    for (const point of clickableMapPoints) {
      const dx = point.x - clickX;
      const dy = point.y - clickY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (!best || distance < best.distance) {
        best = { lot: point.lot, distance };
      }
    }

    if (best && best.distance <= MAX_MAP_SNAP_DISTANCE) {
      setSelectedLot(best.lot);
    }
  };

  return (
    <div className="min-h-screen text-zinc-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="mt-2">
          <div
            onClick={handleMapClick}
            className="relative block w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 shadow-lg shadow-zinc-900/5 lg:w-1/2"
          >
            <img
              src={LOT_MAP_IMAGE}
              alt="Deschutes Heights lot number map"
              className="block w-full"
              draggable="false"
            />
            <div
              className="absolute left-2 top-2 z-10 w-[min(34rem,95vw)] rounded-xl border border-zinc-200 bg-white/96 p-3 shadow-xl backdrop-blur sm:left-3 sm:top-3 sm:p-4"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Deschutes Heights HOA</p>
              <h1 className="mt-1 text-balance text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
                Conveyance Chain + Assessment Explorer
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">
                Search by lot number or click the map to load a lot instantly.
              </p>
              <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submitLookup}>
                <label className="flex-1">
                  <span className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-zinc-500">Lot Number</span>
                  <input
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base outline-none ring-emerald-500 transition focus:ring-2"
                    placeholder="Enter lot (e.g., 67)"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700"
                >
                  Find Lot
                </button>
              </form>
              <p className="mt-2 text-xs text-zinc-500">
                Click any lot on the map to auto-search. Direct link: <code>?lot=67</code>
              </p>
            </div>
            {activeMapPoint && (
              <span
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white shadow"
                style={{ left: `${activeMapPoint.x * 100}%`, top: `${activeMapPoint.y * 100}%` }}
              >
                {activeMapPoint.lot}
              </span>
            )}
          </div>
        </section>

        {loading && <p className="mt-4 text-sm text-zinc-600">Loading data...</p>}
        {!loading && error && <p className="mt-4 text-sm text-rose-700">{error}</p>}

        {!loading && !error && activeLot === null && (
          <p className="mt-4 text-sm text-zinc-600">Enter a lot number to view chain-of-title and assessment history.</p>
        )}

        {!loading && !error && activeLot !== null && !lotRecord && (
          <p className="mt-4 text-sm text-zinc-700">
            No lot record found for <strong>{activeLot}</strong>.
          </p>
        )}

        {!loading && !error && lotRecord && (
          <section className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Lot</p>
                <p className="mt-2 text-2xl font-semibold">{lotRecord.lot}</p>
                <p className="mt-1 text-sm text-zinc-600">Phase {lotRecord.phase}</p>
              </article>
              <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Conveyances</p>
                <p className="mt-2 text-2xl font-semibold">{sortedConveyances.length}</p>
                <p className="mt-1 text-sm text-zinc-600">With assessment rows: {lotStats.assessedCount}</p>
              </article>
              <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Expected</p>
                <p className="mt-2 text-2xl font-semibold">{formatMoney(lotStats.expected)}</p>
                <p className="mt-1 text-sm text-zinc-600">Linked assessments: {lotStats.assessedCount}</p>
              </article>
              <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Collected</p>
                <p className="mt-2 text-2xl font-semibold">{formatMoney(lotStats.collected)}</p>
                <p className="mt-1 text-sm text-zinc-600">Gap: {formatMoney(lotStats.expected - lotStats.collected)}</p>
              </article>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-lg shadow-zinc-900/5">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="bg-zinc-100/70 text-xs uppercase tracking-[0.16em] text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Deed</th>
                    <th className="px-4 py-3 text-left">Grantor</th>
                    <th className="px-4 py-3 text-left">Grantee</th>
                    <th className="px-4 py-3 text-left">Expected</th>
                    <th className="px-4 py-3 text-left">Collected</th>
                    <th className="px-4 py-3 text-left">GL Link</th>
                    <th className="px-4 py-3 text-left">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {sortedConveyances.map((conveyance, index) => {
                    const assessment = conveyance.assessment;
                    const links = pdfLinks(conveyance.sourceFile, conveyance.sourcePages);
                    return (
                      <tr key={`${conveyance.date}-${index}`} className="align-top">
                        <td className="px-4 py-3 font-medium text-zinc-900">{conveyance.date || "-"}</td>
                        <td className="px-4 py-3">{conveyance.deedType || "-"}</td>
                        <td className="px-4 py-3 text-zinc-700">{conveyance.grantor || "-"}</td>
                        <td className="px-4 py-3 text-zinc-700">{conveyance.grantee || "-"}</td>
                        <td className="px-4 py-3">{formatMoney(assessment?.expectedAmount)}</td>
                        <td className="px-4 py-3">{formatMoney(assessment?.collectedAmount)}</td>
                        <td className="px-4 py-3 text-xs text-zinc-600">
                          {assessment?.glDate ? (
                            <div>
                              <p className="font-medium text-zinc-800">{assessment.glDate}</p>
                              <p className="mt-1 max-w-xs">{assessment.glDescription || "Collection entry"}</p>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-700">
                          <p>{conveyance.sourceFile || "-"}</p>
                          {links.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {links.map((link) => (
                                <a
                                  key={link.href}
                                  href={link.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-md bg-emerald-100 px-2 py-0.5 font-medium text-emerald-900 transition hover:bg-emerald-200"
                                >
                                  {link.label}
                                </a>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-zinc-500">No page reference</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {lotRecord.unmatchedCrossRows?.length > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">Unmatched cross-reference rows for lot {lotRecord.lot}</p>
                <ul className="mt-2 space-y-1">
                  {lotRecord.unmatchedCrossRows.map((row) => (
                    <li key={row.crossReferenceRowId}>
                      {row.deedDate || "Unknown date"} | {row.matchStatus || "Unmatched"} | {row.glDescription || "No GL description"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
