"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { cellToBoundary, isValidCell } from 'h3-js';
import { swarmClusters } from '@/lib/swarm/logic';
import { clusterName, clusterReview, type TerritoryReview } from '@/lib/swarm/territory';
import type { SwarmProspect } from "@/lib/swarm/types";
import "leaflet/dist/leaflet.css";

export function SwarmMap({ prospects, batchId, onSelect, reviews = [], onCluster }: { prospects: SwarmProspect[]; batchId: string; onSelect: (id: string) => void; reviews?: TerritoryReview[]; onCluster?: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef('');
  const drawn = useRef('');
  const onPick = useRef(onSelect);
  const onArea = useRef(onCluster);
  const [error, setError] = useState('');
  useEffect(() => { onPick.current = onSelect; }, [onSelect]);
  useEffect(() => { onArea.current = onCluster; }, [onCluster]);
  useEffect(() => {
    const signature = JSON.stringify([reviews, prospects.map((p) => [p.id, p.business.coordinates, p.opportunity, p.business.name, p.business.address])]);
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
      for (const group of swarmClusters(prospects)) {
        if (!isValidCell(group.id)) continue;
        const reviewed = clusterReview(group.cards, reviews.find(r=>r.key===group.id));
        const content = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = clusterName(group.cards);
        const status = document.createElement('p'); status.textContent = reviewed.newCount ? `${reviewed.newCount} new since review` : reviewed.reviewed ? 'Already looked at' : 'Not reviewed';
        const button = document.createElement('button'); button.className = 'sw-map-link'; button.textContent = `View ${group.cards.length} businesses`; button.addEventListener('click',()=>onArea.current?.(group.id));
        content.append(title,status,button);
        L.polygon(cellToBoundary(group.id), { color: reviewed.reviewed ? '#8e9786' : '#6c8558', weight: 1, fillOpacity: reviewed.reviewed ? .12 : .04, dashArray: reviewed.reviewed ? '4 5' : undefined }).bindPopup(content).addTo(layer.current!);
      }
      const coordinates: [number, number][] = [];
      for (const prospect of prospects) {
        const { lat, lng } = prospect.business.coordinates;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        coordinates.push([lat, lng]);
        const content = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = prospect.business.name;
        const address = document.createElement('button'); address.textContent = prospect.business.address; address.className = 'sw-map-address'; address.setAttribute('aria-label', `Copy address: ${prospect.business.address}`);
        address.addEventListener('click', () => { void navigator.clipboard.writeText(prospect.business.address).then(() => { address.textContent = 'Address copied'; }).catch(() => { address.textContent = 'Copy unavailable'; }); });
        const button = document.createElement('button'); button.textContent = 'View prospect'; button.className = 'sw-map-link'; button.addEventListener('click', () => onPick.current(prospect.id));
        content.append(title, address, button);
        L.marker([lat, lng], { title: prospect.business.name, icon: L.divIcon({ className: `sw-map-marker ${prospect.opportunity === 'high' ? 'high' : prospect.opportunity === 'contact_needed' ? 'contact-needed' : ''}`, html: '<span></span>', iconSize: [18, 18] }) }).bindPopup(content).addTo(layer.current!);
      }
      if (coordinates.length && fitted.current !== batchId) { map.current.fitBounds(L.latLngBounds(coordinates), { padding: [35, 35], maxZoom: 15 }); fitted.current = batchId; }
      map.current.invalidateSize();
      drawn.current = signature;
    }).catch(() => setError('The map could not load. Use Prospects or Clusters to browse these results.'));
    return () => { disposed = true; };
  }, [prospects, batchId, reviews]);
  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);
  return <div className="sw-map-wrap"><div ref={container} className="sw-map" aria-label="Map of discovered prospects" /><div className="sw-map-legend"><span><i className="high"/>High priority</span><span><i/>Review</span><span><i className="contact-needed"/>Find contact</span><span>Dashed areas · already looked at</span></div>{error && <p role="status">{error}</p>}</div>;
}
