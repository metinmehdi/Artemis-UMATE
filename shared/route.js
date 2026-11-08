// Baku Metro Red line (order from Icherisheher to Hazi Aslanov). Azerbaijani names are shown
// on signs exactly as in the real metro; English transliterations are used for speech/UI.
// Phase 1 replaces this hand-written list with data built from OpenStreetMap.
export const RED_LINE = {
  id: 'red',
  color: '#ee1d23',
  stations: [
    { az: 'İçərişəhər', en: 'Icherisheher' },
    { az: 'Sahil', en: 'Sahil' },
    { az: '28 May', en: '28 May' },
    { az: 'Gənclik', en: 'Ganjlik' },
    { az: 'Nəriman Nərimanov', en: 'Nariman Narimanov' },
    { az: 'Ulduz', en: 'Ulduz' },
    { az: 'Koroğlu', en: 'Koroglu' },
    { az: 'Qara Qarayev', en: 'Gara Garayev' },
    { az: 'Neftçilər', en: 'Neftchilar' },
    { az: 'Xalqlar Dostluğu', en: 'Khalglar Dostlugu' },
    { az: 'Əhmədli', en: 'Ahmadli' },
    { az: 'Həzi Aslanov', en: 'Hazi Aslanov' },
  ],
};

// Next stops from `from` in each direction (closest first).
export function nextStops(line, fromEn) {
  const i = line.stations.findIndex((s) => s.en === fromEn);
  return {
    towardsStart: line.stations.slice(0, i).reverse(),
    towardsEnd: line.stations.slice(i + 1),
  };
}

// Which direction to take from `from` to `to`, and how many stops.
export function planTrip(line, fromEn, toEn) {
  const a = line.stations.findIndex((s) => s.en === fromEn);
  const b = line.stations.findIndex((s) => s.en === toEn);
  const terminus = b < a ? line.stations[0] : line.stations[line.stations.length - 1];
  return { terminus, stops: Math.abs(b - a), towardsStart: b < a };
}
