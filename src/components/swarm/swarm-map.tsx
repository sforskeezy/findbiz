"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { Coordinates } from "@/lib/types";
import type { SwarmProspect } from "@/lib/swarm/types";
import "leaflet/dist/leaflet.css";

export function SwarmMap({ prospects, batchId, onSelect, numbered = false, origin }: { prospects: SwarmProspect[]; batchId: string; onSelect: (id: string) => void; numbered?: boolean; origin?: Coordinates }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef('');
  const drawn = useRef('');
  const onPick = useRef(onSelect);
  const [error, setError] = useState('');
  useEffect(() => { onPick.current = onSelect; }, [onSelect]);
  useEffect(() => {
    const signature = JSON.stringify([numbered, origin, prospects.map((p) => [p.id, p.business.coordinates, p.opportunity, p.business.name, p.business.address])]);
    if (map.current && drawn.current === signature) return;
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !container.current) return;
      if (!map.current) {
        map.current = L.map(container.current, { scrollWheelZoom: true }).setView([39, -96], 4);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map.current).on('tileerror', () => setError('Some map tiles could not load. Prospect pins are still available.'));
        layer.current = L.layerGroup().addTo(map.current);
      }
      layer.current?.clearLayers();
      const coordinates: [number, number][] = [];
      for (const [index, prospect] of prospects.entries()) {
        const { lat, lng } = prospect.business.coordinates;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        coordinates.push([lat, lng]);
        const content = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = prospect.business.name;
        const address = document.createElement('p'); address.textContent = prospect.business.address;
        const button = document.createElement('button'); button.textContent = 'View prospect'; button.className = 'sw-map-link'; button.addEventListener('click', () => onPick.current(prospect.id));
        content.append(title, address, button);
        L.marker([lat, lng], { title: prospect.business.name, icon: L.divIcon({ className: `sw-map-marker ${prospect.opportunity === 'high' ? 'high' : prospect.opportunity === 'contact_needed' ? 'contact-needed' : ''} ${numbered ? 'numbered' : ''}`, html: numbered ? `<span>${index + 1}</span>` : '<span></span>', iconSize: numbered ? [28, 28] : [18, 18] }) }).bindPopup(content).addTo(layer.current!);
      }
      if (numbered && coordinates.length) {
        const line: [number, number][] = origin ? [[origin.lat, origin.lng], ...coordinates] : coordinates;
        L.polyline(line, { color: '#4877dc', weight: 3, opacity: .75, dashArray: '6 8', interactive: false }).addTo(layer.current!);
        if (origin) coordinates.push([origin.lat, origin.lng]);
      }
      if (coordinates.length && fitted.current !== batchId) { map.current.fitBounds(L.latLngBounds(coordinates), { padding: [35, 35], maxZoom: 15 }); fitted.current = batchId; }
      map.current.invalidateSize();
      drawn.current = signature;
    }).catch(() => setError('The map could not load. Use Prospects or Clusters to browse these results.'));
    return () => { disposed = true; };
  }, [prospects, batchId, numbered, origin]);
  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);
  return <div className="sw-map-wrap"><div ref={container} className="sw-map" aria-label="Map of discovered prospects" />{!numbered && <div className="sw-map-legend"><span><i className="high"/>High priority</span><span><i/>Review</span><span><i className="contact-needed"/>Find contact</span></div>}{error && <p role="status">{error}</p>}</div>;
}
