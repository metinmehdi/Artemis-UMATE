// SILVER layer transform: Overpass JSON (raw) -> one clean metro network table.
// Pure function (no file access), so the tests can feed it small hand-made inputs.

// Official Baku Metro line colours (the OSM data only says "red", "green", ...).
export const OFFICIAL_COLOURS = { 1: '#EE1D23', 2: '#00AB5B', 3: '#8E177C' };
export const LINE_NAMES_EN = { 1: 'Red line', 2: 'Green line', '2B': 'Green line shuttle', 3: 'Purple line' };

// Trailing words that some OSM names carry but signs do not ("20 Yanvar st.").
const NAME_SUFFIXES = [/\s+st\.?$/i, /\s+station$/i, /\s+stansiyası$/i, /\s+metro(su)?$/i];

export function cleanName(name) {
  let out = String(name || '').trim().replace(/\s+/g, ' ');
  for (const re of NAME_SUFFIXES) out = out.replace(re, '');
  return out;
}

// Fallback only: Azerbaijani Latin -> simple English transliteration.
const TRANSLIT = { ə: 'a', Ə: 'A', ç: 'ch', Ç: 'Ch', ş: 'sh', Ş: 'Sh', ğ: 'gh', Ğ: 'Gh', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ü: 'u', Ü: 'U', x: 'kh', X: 'Kh', q: 'g', Q: 'G', c: 'j', C: 'J' };
export function transliterate(az) {
  return [...az].map((ch) => TRANSLIT[ch] ?? ch).join('');
}

export function slug(en) {
  return en
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * @param {object} raw      Overpass JSON ({ elements: [...] })
 * @param {object} namesEn  { "<cleaned Azerbaijani name>": "<English name>" }
 * @returns {{ network: object, quality: { errors: string[], warnings: string[] } }}
 */
export function buildNetwork(raw, namesEn = {}, { osmTimestamp = null } = {}) {
  const errors = [];
  const warnings = [];
  const byKey = new Map((raw.elements || []).map((e) => [e.type + '/' + e.id, e]));
  const relations = (raw.elements || []).filter((e) => e.type === 'relation' && e.tags?.route === 'subway');
  if (relations.length === 0) errors.push('no subway route relations in the raw data');

  const stations = new Map(); // name_az -> station
  const missingOsmEn = new Set();
  const cleaned = new Set();

  function stationFor(member, routeName) {
    const el = byKey.get(member.type + '/' + member.ref);
    if (!el) {
      errors.push(`${routeName}: stop ${member.type}/${member.ref} is missing from the raw data`);
      return null;
    }
    const tags = el.tags || {};
    if (!tags.name) {
      errors.push(`${routeName}: stop ${member.type}/${member.ref} has no name`);
      return null;
    }
    const nameAz = cleanName(tags.name);
    if (nameAz !== tags.name.trim()) cleaned.add(`"${tags.name}" -> "${nameAz}"`);
    let st = stations.get(nameAz);
    if (!st) {
      let nameEn = namesEn[nameAz];
      let source = 'hand-checked list';
      if (!nameEn && tags['name:en']) {
        nameEn = cleanName(tags['name:en']);
        source = 'OpenStreetMap name:en';
      }
      if (!nameEn) {
        nameEn = transliterate(nameAz);
        source = 'automatic transliteration';
        warnings.push(`no English name for "${nameAz}", transliterated to "${nameEn}"`);
      }
      if (!tags['name:en']) missingOsmEn.add(nameAz);
      st = { id: slug(nameEn), name_az: nameAz, name_en: nameEn, name_en_source: source, lines: new Set(), osm_nodes: new Set(), _lat: [], _lon: [] };
      stations.set(nameAz, st);
    }
    st.osm_nodes.add(member.ref);
    if (typeof el.lat === 'number') {
      st._lat.push(el.lat);
      st._lon.push(el.lon);
    }
    return st;
  }

  const routes = [];
  for (const rel of relations) {
    const ref = String(rel.tags.ref || '?');
    const name = rel.tags.name || `relation ${rel.id}`;
    const stops = [];
    for (const m of rel.members || []) {
      if (!m.role?.startsWith('stop')) continue;
      const st = stationFor(m, name);
      if (!st) continue;
      if (stops[stops.length - 1] !== st.id) stops.push(st.id);
      st.lines.add(ref);
    }
    if (stops.length < 2) {
      errors.push(`${name}: fewer than 2 stops`);
      continue;
    }
    routes.push({ osm_id: rel.id, line: ref, name, osm_colour: rel.tags.colour || null, stops });
  }

  // Every route should have a twin that runs the same stops backwards.
  for (const r of routes) {
    const twin = routes.find((o) => o !== r && o.line === r.line && o.stops.join() === [...r.stops].reverse().join());
    if (!twin) warnings.push(`${r.name}: no route in the opposite direction with the same stops`);
  }

  // Line table: the longest route of each line defines the station order.
  const lines = [];
  for (const ref of [...new Set(routes.map((r) => r.line))].sort()) {
    const own = routes.filter((r) => r.line === ref);
    const main = [...own].sort((a, b) => b.stops.length - a.stops.length || a.osm_id - b.osm_id)[0];
    const colour = OFFICIAL_COLOURS[ref] || null;
    if (!colour) warnings.push(`line ${ref}: no official colour on file, OSM says "${main.osm_colour}"`);
    lines.push({
      ref,
      name_en: LINE_NAMES_EN[ref] || `Line ${ref}`,
      colour,
      osm_colour: main.osm_colour,
      stations: main.stops,
      routes: own
        .sort((a, b) => a.osm_id - b.osm_id)
        .map((r) => ({ osm_id: r.osm_id, from: r.stops[0], to: r.stops[r.stops.length - 1], stops: r.stops })),
    });
  }

  const ids = new Map();
  const stationList = [...stations.values()]
    .map((s) => {
      if (ids.has(s.id)) errors.push(`two stations share the id "${s.id}" ("${ids.get(s.id)}" and "${s.name_az}")`);
      ids.set(s.id, s.name_az);
      const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(6) : null);
      const lat = avg(s._lat);
      const lon = avg(s._lon);
      if (lat === null) errors.push(`"${s.name_az}" has no coordinates`);
      return {
        id: s.id,
        name_az: s.name_az,
        name_en: s.name_en,
        name_en_source: s.name_en_source,
        lat,
        lon,
        lines: [...s.lines].sort(),
        osm_nodes: [...s.osm_nodes].sort((a, b) => a - b),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  if (missingOsmEn.size) warnings.push(`${missingOsmEn.size} stations have no name:en in OpenStreetMap: ${[...missingOsmEn].sort().join(', ')}`);
  for (const c of [...cleaned].sort()) warnings.push(`name cleaned: ${c}`);

  return {
    network: {
      city: 'Baku',
      source: { raw: 'data/raw/osm/baku-metro.json', osm_timestamp: osmTimestamp, licence: 'ODbL 1.0, (c) OpenStreetMap contributors' },
      lines,
      stations: stationList,
    },
    quality: { errors, warnings },
  };
}
