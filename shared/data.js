// Loads the trip data (built by the data pipeline) in the browser.
export async function loadTripData(scenario = 'metro-trip') {
  const get = async (p) => {
    const r = await fetch(p, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return r.json();
  };
  const [network, rules, scen] = await Promise.all([
    get('/data/city/baku/network.json'),
    get('/data/city/baku/rules.json'),
    get(`/data/scenario/${scenario}.json`),
  ]);
  return { network, rules, scenario: scen };
}
