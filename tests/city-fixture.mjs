// Overpass's compact output: way coordinates plus relation references, without node records.
export function compactCityMap(data) {
  const nodes = new Map(data.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  return { elements: data.elements.filter(e => e.type !== 'node').map(e => e.type === 'way'
    ? { ...e, geometry: e.nodes.map(id => { const { lat, lon } = nodes.get(id); return { lat, lon }; }) }
    : structuredClone(e)) };
}
