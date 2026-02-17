import { useEffect, useMemo, useState } from "react";
import { LOT_MAP_POINTS } from "./lotMapPoints";

const PDF_BY_SOURCE_FILE = {
  "Deschutes Heights Phase 1 Deeds": "Deschutes Heights Phase 1 Deeds.pdf",
  "Deschutes Heights 4414 Deeds": "Deschutes Heights 4414 Deeds.pdf",
  "Deschutes Heights Phase 2 Deeds": "Deschutes Heights Phase 2 Deeds.pdf",
};

const LOT_MAP_IMAGE = `${import.meta.env.BASE_URL}images/lot-map.jpg`;
const AUTO_SELECT_DISTANCE = 0.028;
const HOVER_PREVIEW_DISTANCE = 0.08;
const POINT_OVERRIDE_STORAGE_KEY = "lotMapPointOverrides.v2";
const MAP_GEO_BOUNDS = {
  southLat: 46.97199,
  northLat: 46.97811,
  westLon: -122.87976,
  eastLon: -122.86695,
};

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
    return Number.MIN_SAFE_INTEGER;
  }
  const [month, day, year] = String(value).split("/");
  if (!month || !day || !year) {
    return Number.MIN_SAFE_INTEGER;
  }
  return Number(`${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`);
}

const PARTY_STOPWORDS = new Set([
  "A",
  "AN",
  "AND",
  "AS",
  "AT",
  "BY",
  "CO",
  "COMPANY",
  "CORP",
  "CORPORATION",
  "COUNTY",
  "DEVELOPMENT",
  "ESTATE",
  "FOR",
  "FROM",
  "IN",
  "INC",
  "INCORPORATED",
  "IS",
  "L",
  "LIABILITY",
  "LIMITED",
  "LLC",
  "LP",
  "MARRIED",
  "OF",
  "PERSON",
  "STATE",
  "THE",
  "TITLE",
  "TO",
  "TRUST",
  "WASHINGTON",
  "WOMAN",
  "MAN",
  "WIFE",
  "HUSBAND",
  "COUPLE",
]);

function normalizeParty(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function partyTokens(value) {
  const norm = normalizeParty(value);
  if (!norm) {
    return [];
  }
  return norm.split(" ").filter((token) => token.length > 1 && !PARTY_STOPWORDS.has(token));
}

function partyMatch(left, right) {
  const a = normalizeParty(left);
  const b = normalizeParty(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 10 && (a.includes(b) || b.includes(a))) {
    return true;
  }
  const tokensA = partyTokens(left);
  const tokensB = partyTokens(right);
  if (!tokensA.length || !tokensB.length) {
    return false;
  }
  const setB = new Set(tokensB);
  const overlap = tokensA.filter((token) => setB.has(token)).length;
  const coverageA = overlap / tokensA.length;
  const coverageB = overlap / tokensB.length;
  if (coverageA >= 0.6 && coverageB >= 0.6) {
    return true;
  }
  return overlap >= 2 && Math.max(coverageA, coverageB) >= 0.8;
}

function sameDayOldnessScore(conveyance) {
  const grantor = normalizeParty(conveyance.grantor);
  const grantee = normalizeParty(conveyance.grantee);
  const deedType = String(conveyance.deedType || "").toUpperCase();
  let score = 0;

  if (grantor.includes("SO UK")) {
    score -= 40;
  }
  if (grantor.includes("THURSTON COUNTY TITLE")) {
    score -= 25;
  }
  if (grantee.includes("LOTUS HOUSE")) {
    score -= 10;
  }
  if (grantor.includes("LOTUS HOUSE")) {
    score += 10;
  }
  if (deedType.includes("QUIT")) {
    score -= 4;
  }
  return score;
}

function sortSameDayConveyancesNewestFirst(group) {
  if (group.length <= 1) {
    return group;
  }

  const n = group.length;
  const out = Array.from({ length: n }, () => new Set());
  const indegree = new Array(n).fill(0);

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) {
        continue;
      }
      if (partyMatch(group[i].grantee, group[j].grantor)) {
        if (!out[i].has(j)) {
          out[i].add(j);
          indegree[j] += 1;
        }
      }
    }
  }

  const queue = [];
  for (let i = 0; i < n; i += 1) {
    if (indegree[i] === 0) {
      queue.push(i);
    }
  }
  queue.sort((a, b) => sameDayOldnessScore(group[a]) - sameDayOldnessScore(group[b]));

  const oldestToNewest = [];
  while (queue.length) {
    const current = queue.shift();
    oldestToNewest.push(group[current]);
    for (const next of out[current]) {
      indegree[next] -= 1;
      if (indegree[next] === 0) {
        queue.push(next);
      }
    }
    queue.sort((a, b) => sameDayOldnessScore(group[a]) - sameDayOldnessScore(group[b]));
  }

  if (oldestToNewest.length < n) {
    const consumed = new Set(oldestToNewest.map((row) => row.__idx));
    const leftovers = group
      .filter((row) => !consumed.has(row.__idx))
      .sort((a, b) => sameDayOldnessScore(a) - sameDayOldnessScore(b));
    oldestToNewest.push(...leftovers);
  }

  return oldestToNewest.reverse();
}

function sortConveyancesNewestFirst(conveyances) {
  if (!Array.isArray(conveyances) || !conveyances.length) {
    return [];
  }
  const withIndex = conveyances.map((row, idx) => ({ ...row, __idx: idx }));
  const byDate = new Map();
  for (const row of withIndex) {
    const dateKey = String(row.date || "");
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, []);
    }
    byDate.get(dateKey).push(row);
  }

  const sortedDates = [...byDate.keys()].sort((a, b) => parseDateKey(b) - parseDateKey(a));
  const finalRows = [];
  for (const dateKey of sortedDates) {
    const sameDateRows = byDate.get(dateKey);
    const ordered = sortSameDayConveyancesNewestFirst(sameDateRows);
    finalRows.push(...ordered.map(({ __idx, ...row }) => row));
  }
  return finalRows;
}

function parseLotNumber(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function readLotFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return parseLotNumber(params.get("lot"));
}

function readDebugFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = (params.get("debug") || "").toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function clamp01(value) {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function mapLatLonToImagePoint(lat, lon) {
  const x = (lon - MAP_GEO_BOUNDS.westLon) / (MAP_GEO_BOUNDS.eastLon - MAP_GEO_BOUNDS.westLon);
  const y = (MAP_GEO_BOUNDS.northLat - lat) / (MAP_GEO_BOUNDS.northLat - MAP_GEO_BOUNDS.southLat);
  return {
    x: clamp01(x),
    y: clamp01(y),
    inBounds: x >= 0 && x <= 1 && y >= 0 && y <= 1,
  };
}

function readAscii(view, offset, length) {
  let output = "";
  for (let i = 0; i < length; i += 1) {
    const code = view.getUint8(offset + i);
    if (code === 0) {
      break;
    }
    output += String.fromCharCode(code);
  }
  return output;
}

function bytesPerType(type) {
  if (type === 1 || type === 2 || type === 7) {
    return 1;
  }
  if (type === 3) {
    return 2;
  }
  if (type === 4 || type === 9) {
    return 4;
  }
  if (type === 5 || type === 10) {
    return 8;
  }
  return 0;
}

function readRational(view, offset, littleEndian) {
  const numerator = view.getUint32(offset, littleEndian);
  const denominator = view.getUint32(offset + 4, littleEndian);
  if (!denominator) {
    return 0;
  }
  return numerator / denominator;
}

function parseExifGpsFromArrayBuffer(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return null;
  }

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    const segmentLength = view.getUint16(offset + 2, false);
    if (segmentLength < 2) {
      break;
    }

    if (marker === 0xe1) {
      const app1Start = offset + 4;
      if (app1Start + 6 <= view.byteLength && readAscii(view, app1Start, 6) === "Exif") {
        const tiffStart = app1Start + 6;
        const endianness = readAscii(view, tiffStart, 2);
        const littleEndian = endianness === "II";
        if (endianness !== "II" && endianness !== "MM") {
          return null;
        }
        if (view.getUint16(tiffStart + 2, littleEndian) !== 0x2a) {
          return null;
        }

        const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
        const ifd0Absolute = tiffStart + ifd0Offset;
        if (ifd0Absolute + 2 > view.byteLength) {
          return null;
        }
        const ifd0Count = view.getUint16(ifd0Absolute, littleEndian);
        let gpsIfdOffset = null;

        for (let i = 0; i < ifd0Count; i += 1) {
          const entry = ifd0Absolute + 2 + i * 12;
          if (entry + 12 > view.byteLength) {
            break;
          }
          const tag = view.getUint16(entry, littleEndian);
          if (tag === 0x8825) {
            gpsIfdOffset = view.getUint32(entry + 8, littleEndian);
            break;
          }
        }

        if (gpsIfdOffset === null) {
          return null;
        }

        const gpsIfdAbsolute = tiffStart + gpsIfdOffset;
        if (gpsIfdAbsolute + 2 > view.byteLength) {
          return null;
        }
        const gpsCount = view.getUint16(gpsIfdAbsolute, littleEndian);

        let latRef = "";
        let lonRef = "";
        let latValues = null;
        let lonValues = null;

        for (let i = 0; i < gpsCount; i += 1) {
          const entry = gpsIfdAbsolute + 2 + i * 12;
          if (entry + 12 > view.byteLength) {
            break;
          }

          const tag = view.getUint16(entry, littleEndian);
          const type = view.getUint16(entry + 2, littleEndian);
          const count = view.getUint32(entry + 4, littleEndian);
          const valueOrOffset = view.getUint32(entry + 8, littleEndian);
          const valueBytes = bytesPerType(type) * count;
          const valueOffset = valueBytes <= 4 ? entry + 8 : tiffStart + valueOrOffset;
          if (valueOffset < 0 || valueOffset + valueBytes > view.byteLength) {
            continue;
          }

          if (tag === 0x0001 && type === 2) {
            latRef = readAscii(view, valueOffset, count);
          } else if (tag === 0x0003 && type === 2) {
            lonRef = readAscii(view, valueOffset, count);
          } else if (tag === 0x0002 && type === 5 && count >= 3) {
            latValues = [
              readRational(view, valueOffset, littleEndian),
              readRational(view, valueOffset + 8, littleEndian),
              readRational(view, valueOffset + 16, littleEndian),
            ];
          } else if (tag === 0x0004 && type === 5 && count >= 3) {
            lonValues = [
              readRational(view, valueOffset, littleEndian),
              readRational(view, valueOffset + 8, littleEndian),
              readRational(view, valueOffset + 16, littleEndian),
            ];
          }
        }

        if (!latValues || !lonValues) {
          return null;
        }
        const latSign = String(latRef).trim().toUpperCase() === "S" ? -1 : 1;
        const lonSign = String(lonRef).trim().toUpperCase() === "W" ? -1 : 1;
        const latitude = latSign * (latValues[0] + latValues[1] / 60 + latValues[2] / 3600);
        const longitude = lonSign * (lonValues[0] + lonValues[1] / 60 + lonValues[2] / 3600);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }
        return { latitude, longitude };
      }
    }

    offset += 2 + segmentLength;
  }

  return null;
}

async function readGpsFromPhoto(file) {
  const buffer = await file.arrayBuffer();
  return parseExifGpsFromArrayBuffer(buffer);
}

function readPointOverridesFromStorage() {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(POINT_OVERRIDE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
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
  const [debugMode, setDebugMode] = useState(() => readDebugFromUrl());
  const [pointOverrides, setPointOverrides] = useState(() => readPointOverridesFromStorage());
  const [calibrateLot, setCalibrateLot] = useState(null);
  const [debugMessage, setDebugMessage] = useState("");
  const [dataset, setDataset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hoverSelection, setHoverSelection] = useState(null);
  const [clickChoice, setClickChoice] = useState(null);
  const [photoOverlay, setPhotoOverlay] = useState(null);
  const [photoStatus, setPhotoStatus] = useState("");

  useEffect(() => {
    const urlLot = readLotFromUrl();
    if (urlLot !== null) {
      setQuery(String(urlLot));
      setActiveLot(urlLot);
    }
    setDebugMode(readDebugFromUrl());
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setDebugMode(readDebugFromUrl());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!debugMode) {
      setCalibrateLot(null);
      setDebugMessage("");
    }
  }, [debugMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(POINT_OVERRIDE_STORAGE_KEY, JSON.stringify(pointOverrides));
  }, [pointOverrides]);

  const mapPoints = useMemo(
    () =>
      LOT_MAP_POINTS.map((point) => {
        const override = pointOverrides[String(point.lot)];
        if (!override) {
          return point;
        }
        return {
          ...point,
          x: typeof override.x === "number" ? override.x : point.x,
          y: typeof override.y === "number" ? override.y : point.y,
        };
      }),
    [pointOverrides],
  );

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

  const clickableMapPoints = useMemo(() => mapPoints, [mapPoints]);

  const activeMapPoint = useMemo(() => mapPoints.find((point) => point.lot === activeLot) ?? null, [activeLot, mapPoints]);

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
    const withIndex = lotRecord.conveyances.map((row, idx) => ({ ...row, __idx: idx }));
    const byDate = new Map();
    for (const row of withIndex) {
      const dateKey = String(row.date || "");
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, []);
      }
      byDate.get(dateKey).push(row);
    }

    const sortedDates = [...byDate.keys()].sort((a, b) => parseDateKey(b) - parseDateKey(a));
    const finalRows = [];
    for (const dateKey of sortedDates) {
      const sameDateRows = byDate.get(dateKey);
      const ordered = sortSameDayConveyancesNewestFirst(sameDateRows);
      finalRows.push(...ordered.map(({ __idx, ...row }) => row));
    }
    return finalRows;
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

    if (debugMode && calibrateLot !== null) {
      setPointOverrides((prev) => ({
        ...prev,
        [String(calibrateLot)]: { x: clamp01(clickX), y: clamp01(clickY) },
      }));
      setDebugMessage(`Moved lot ${calibrateLot}.`);
      return;
    }

    const ranked = clickableMapPoints
      .map((point) => {
        const dx = point.x - clickX;
        const dy = point.y - clickY;
        return {
          lot: point.lot,
          x: point.x,
          y: point.y,
          distance: Math.sqrt(dx * dx + dy * dy),
        };
      })
      .sort((a, b) => a.distance - b.distance);

    const best = ranked[0];
    const second = ranked[1];
    if (!best) {
      return;
    }

    const confidentByDistance = best.distance <= AUTO_SELECT_DISTANCE;
    const confidentBySeparation = second ? best.distance / second.distance <= 0.72 : true;

    if (confidentByDistance || confidentBySeparation) {
      setSelectedLot(best.lot);
      setClickChoice(null);
      return;
    }

    setClickChoice({
      x: clickX,
      y: clickY,
      options: ranked.slice(0, 5).map((entry) => entry.lot),
    });
  };

  const handleMapMouseMove = (event) => {
    if (!clickableMapPoints.length) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    let best = null;
    for (const point of clickableMapPoints) {
      const dx = point.x - x;
      const dy = point.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (!best || distance < best.distance) {
        best = { lot: point.lot, x: point.x, y: point.y, distance };
      }
    }

    if (best && best.distance <= HOVER_PREVIEW_DISTANCE) {
      setHoverSelection(best);
    } else {
      setHoverSelection(null);
    }
  };

  const handleMapMouseLeave = () => {
    setHoverSelection(null);
  };

  const copyMapPoints = async () => {
    const sorted = [...mapPoints].sort((a, b) => a.lot - b.lot);
    const json = JSON.stringify(sorted, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setDebugMessage("Copied full lot point map to clipboard.");
    } catch {
      setDebugMessage("Failed to copy points to clipboard.");
    }
  };

  const resetOverrides = () => {
    setPointOverrides({});
    setCalibrateLot(null);
    setDebugMessage("Reset lot point overrides.");
  };

  const clearPhotoOverlay = () => {
    setPhotoOverlay((prev) => {
      if (prev?.url) {
        URL.revokeObjectURL(prev.url);
      }
      return null;
    });
    setPhotoStatus("");
  };

  const handlePhotoUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setPhotoStatus("Reading photo GPS metadata...");

    try {
      const gps = await readGpsFromPhoto(file);
      if (!gps) {
        setPhotoOverlay((prev) => {
          if (prev?.url) {
            URL.revokeObjectURL(prev.url);
          }
          return null;
        });
        setPhotoStatus("No GPS metadata found. Use a geotagged JPEG photo with location enabled.");
        return;
      }

      const mappedPoint = mapLatLonToImagePoint(gps.latitude, gps.longitude);
      const objectUrl = URL.createObjectURL(file);
      setPhotoOverlay((prev) => {
        if (prev?.url) {
          URL.revokeObjectURL(prev.url);
        }
        return {
          name: file.name,
          url: objectUrl,
          latitude: gps.latitude,
          longitude: gps.longitude,
          x: mappedPoint.x,
          y: mappedPoint.y,
          inBounds: mappedPoint.inBounds,
        };
      });
      setPhotoStatus(
        mappedPoint.inBounds
          ? "Photo placed on map from GPS metadata."
          : "Photo GPS appears outside current map bounds, so it was clamped to the map edge.",
      );
    } catch {
      setPhotoOverlay((prev) => {
        if (prev?.url) {
          URL.revokeObjectURL(prev.url);
        }
        return null;
      });
      setPhotoStatus("Could not read GPS metadata from that file.");
    }
  };

  useEffect(
    () => () => {
      if (photoOverlay?.url) {
        URL.revokeObjectURL(photoOverlay.url);
      }
    },
    [photoOverlay],
  );

  return (
    <div className="min-h-screen text-zinc-900">
      <div className="mx-auto max-w-none px-2 py-3 sm:px-3 lg:px-4">
        <section className="relative mt-1">
          <div className="pointer-events-none absolute left-2 top-2 z-10 sm:left-3 sm:top-3">
            <div className="pointer-events-auto w-[min(24rem,90vw)] rounded-xl border border-zinc-200 bg-white/95 p-2.5 shadow-xl backdrop-blur sm:p-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Deschutes Heights HOA</p>
              <h1 className="mt-1 text-balance text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl">
                Conveyance Chain + Assessment Explorer
              </h1>
              <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                Search by lot number or click the map to load a lot instantly.
              </p>
              <form className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submitLookup}>
                <label className="flex-1">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-zinc-500">Lot Number</span>
                  <input
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base outline-none ring-emerald-500 transition focus:ring-2"
                    placeholder="Enter lot (e.g., 67)"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
                >
                  Find Lot
                </button>
              </form>
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Click any lot on the map to auto-search. If selection is ambiguous, you can choose from suggested lots. Link: <code>?lot=67</code>
              </p>
              <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50/80 p-1.5">
                <label className="block text-[10px] uppercase tracking-[0.16em] text-zinc-500">Geotagged Photo</label>
                <input
                  type="file"
                  accept="image/jpeg,image/jpg"
                  onChange={handlePhotoUpload}
                  className="mt-1 block w-full cursor-pointer text-[11px] text-zinc-700 file:mr-2 file:rounded-md file:border-0 file:bg-zinc-900 file:px-2 file:py-1 file:text-[11px] file:font-medium file:text-white hover:file:bg-zinc-700"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Upload a geotagged photo to place it on the map. Then click nearby lots to inspect ownership.
                </p>
                {photoOverlay && (
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <p className="truncate text-[11px] text-zinc-700">
                      {photoOverlay.name} ({photoOverlay.latitude.toFixed(5)}, {photoOverlay.longitude.toFixed(5)})
                    </p>
                    <button
                      type="button"
                      onClick={clearPhotoOverlay}
                      className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                    >
                      Clear
                    </button>
                  </div>
                )}
                {photoStatus && <p className="mt-1 text-[11px] text-zinc-600">{photoStatus}</p>}
              </div>
              {!loading && !error && lotRecord && (
                <div className="mt-2 hidden grid-cols-2 gap-2 lg:grid">
                  <div className="rounded-lg border border-zinc-200 bg-white p-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Lot</p>
                    <p className="mt-0.5 text-base font-semibold text-zinc-900">{lotRecord.lot}</p>
                    <p className="text-xs text-zinc-600">Phase {lotRecord.phase}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white p-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Conveyances</p>
                    <p className="mt-0.5 text-base font-semibold text-zinc-900">{sortedConveyances.length}</p>
                    <p className="text-xs text-zinc-600">Assessment rows: {lotStats.assessedCount}</p>
                  </div>
                </div>
              )}
              {debugMode && (
                <div className="mt-1 space-y-1.5 rounded-md border border-sky-200 bg-sky-50/70 p-1.5">
                  <p className="text-[11px] text-sky-800">
                    Debug mode: click a blue lot badge, then click the map to reposition it (<code>?debug=true</code>).
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded-md border border-sky-300 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100"
                      onClick={copyMapPoints}
                    >
                      Copy points JSON
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-sky-300 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100"
                      onClick={resetOverrides}
                    >
                      Reset overrides
                    </button>
                    {calibrateLot !== null && (
                      <span className="text-[11px] text-sky-800">
                        Calibrating lot <strong>{calibrateLot}</strong>
                      </span>
                    )}
                  </div>
                  {debugMessage && <p className="text-[11px] text-sky-700">{debugMessage}</p>}
                </div>
              )}
            </div>
          </div>
          <div
            onClick={handleMapClick}
            onMouseMove={handleMapMouseMove}
            onMouseLeave={handleMapMouseLeave}
            className="relative block w-full cursor-crosshair overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 shadow-lg shadow-zinc-900/5 lg:ml-auto lg:w-1/2"
          >
            <img
              src={LOT_MAP_IMAGE}
              alt="Deschutes Heights lot number map"
              className="block w-full"
              draggable="false"
            />
            {photoOverlay && (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)]"
                style={{ left: `${photoOverlay.x * 100}%`, top: `${photoOverlay.y * 100}%` }}
              >
                <div className="overflow-hidden rounded-md border border-white/90 bg-white/95 p-1 shadow-lg shadow-zinc-900/20">
                  <img src={photoOverlay.url} alt={photoOverlay.name} className="h-14 w-14 rounded object-cover" />
                </div>
                <span className="mx-auto mt-1 block h-2.5 w-2.5 rounded-full border border-white bg-rose-600 shadow" />
              </div>
            )}
            {debugMode &&
              clickableMapPoints.map((point) => (
                <span
                  key={`debug-${point.lot}`}
                  role="button"
                  tabIndex={0}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border px-1.5 py-0 text-[10px] font-semibold shadow-sm ${
                    calibrateLot === point.lot
                      ? "border-emerald-700 bg-emerald-300/55 text-emerald-950"
                      : "border-sky-500/80 bg-sky-300/35 text-sky-900"
                  }`}
                  style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setCalibrateLot(point.lot);
                    setDebugMessage(`Selected lot ${point.lot} for calibration.`);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setCalibrateLot(point.lot);
                      setDebugMessage(`Selected lot ${point.lot} for calibration.`);
                    }
                  }}
                >
                  {point.lot}
                </span>
              ))}
            {activeMapPoint && (
              <span
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white shadow"
                style={{ left: `${activeMapPoint.x * 100}%`, top: `${activeMapPoint.y * 100}%` }}
              >
                {activeMapPoint.lot}
              </span>
            )}
            {hoverSelection && (
              <span
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-500 bg-white/95 px-2 py-0.5 text-xs font-semibold text-emerald-700 shadow"
                style={{ left: `${hoverSelection.x * 100}%`, top: `${hoverSelection.y * 100}%` }}
              >
                {hoverSelection.lot}
              </span>
            )}
            {clickChoice && (
              <div
                className="absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-200 bg-white/96 p-2 shadow-xl backdrop-blur"
                style={{ left: `${clickChoice.x * 100}%`, top: `${clickChoice.y * 100}%` }}
                onClick={(event) => event.stopPropagation()}
              >
                <p className="mb-1 text-[11px] text-zinc-600">Pick lot:</p>
                <div className="flex flex-wrap gap-1.5">
                  {clickChoice.options.map((lot) => (
                    <button
                      key={lot}
                      type="button"
                      className="rounded-md bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white hover:bg-zinc-700"
                      onClick={() => {
                        setSelectedLot(lot);
                        setClickChoice(null);
                      }}
                    >
                      {lot}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {loading && <p className="mt-2 text-sm text-zinc-600">Loading data...</p>}
        {!loading && error && <p className="mt-2 text-sm text-rose-700">{error}</p>}

        {!loading && !error && activeLot === null && (
          <p className="mt-2 text-sm text-zinc-600">Enter a lot number to view chain-of-title and assessment history.</p>
        )}

        {!loading && !error && activeLot !== null && !lotRecord && activeMapPoint && (
          <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">No recorded transfer found for lot {activeLot} in current source data.</p>
            <p className="mt-1">Likely owner is still SO UK INVESTMENT LLC, pending evidence of a later conveyance.</p>
          </div>
        )}

        {!loading && !error && activeLot !== null && !lotRecord && !activeMapPoint && (
          <p className="mt-2 text-sm text-zinc-700">
            No lot record found for <strong>{activeLot}</strong>.
          </p>
        )}

        {!loading && !error && lotRecord && (
          <section className="mt-2 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:hidden">
              <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Lot</p>
                <p className="mt-2 text-2xl font-semibold">{lotRecord.lot}</p>
                <p className="mt-1 text-sm text-zinc-600">Phase {lotRecord.phase}</p>
              </article>
              <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Conveyances</p>
                <p className="mt-2 text-2xl font-semibold">{sortedConveyances.length}</p>
                <p className="mt-1 text-sm text-zinc-600">Assessment rows: {lotStats.assessedCount}</p>
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
