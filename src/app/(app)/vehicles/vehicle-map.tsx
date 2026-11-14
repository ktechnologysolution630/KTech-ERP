'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LiveState } from '@/domain/vehicle';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  state: LiveState;
  /** Short text on the pin, e.g. the plate */
  label: string;
  /** Shown when the pin is tapped; plain text lines */
  details: string[];
  href?: string;
}

const COLOR: Record<LiveState, string> = { MOVING: '#059669', STOPPED: '#2563eb', NO_SIGNAL: '#9ca3af', WAITING: '#9ca3af' };
const BANGKOK: [number, number] = [13.7563, 100.5018];

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * OpenStreetMap with the vehicles that are out and, when given, the route one of them drove.
 * Leaflet touches `window`, so it is loaded only in the browser. The view is fitted to the vehicles
 * the first time they appear, then left alone so a person panning the map is not pulled back.
 */
export function VehicleMap({ markers, route, selectedId, onSelect, className = 'h-[420px]' }: { markers: MapMarker[]; route?: [number, number][]; selectedId?: string | null; onSelect?: (id: string) => void; className?: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const layers = useRef<{ pins: LayerGroup; path: LayerGroup } | null>(null);
  const fitted = useRef(false);
  const leaflet = useRef<typeof import('leaflet') | null>(null);
  const latest = useRef({ markers, route, selectedId, onSelect });

  const draw = () => {
    const L = leaflet.current;
    if (!L || !map.current || !layers.current) return;
    const { markers: ms, route: r, selectedId: sel, onSelect: pick } = latest.current;
    layers.current.pins.clearLayers();
    layers.current.path.clearLayers();
    if (r && r.length > 1) {
      L.polyline(r, { color: '#2453d4', weight: 4, opacity: 0.8 }).addTo(layers.current.path);
      L.circleMarker(r[0]!, { radius: 6, color: '#fff', weight: 2, fillColor: '#64748b', fillOpacity: 1 }).bindTooltip('จุดเริ่ม').addTo(layers.current.path);
    }
    for (const m of ms) {
      const color = COLOR[m.state];
      const icon = L.divIcon({
        className: '',
        iconSize: [0, 0],
        html: `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center">
          <div style="background:${color};color:#fff;font:600 11px/1.2 sans-serif;padding:2px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3);${m.id === sel ? 'outline:2px solid #f59e0b' : ''}">${escape(m.label)}</div>
          <div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;margin-top:2px;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div></div>`,
      });
      const pin = L.marker([m.lat, m.lng], { icon, title: m.label });
      const link = m.href ? `<br/><a href="${escape(m.href)}" style="color:#2453d4;font-weight:600">เปิดรายการ</a>` : '';
      pin.bindPopup(`<div style="font:12px/1.5 sans-serif"><strong>${escape(m.label)}</strong><br/>${m.details.map(escape).join('<br/>')}${link}</div>`);
      if (pick) pin.on('click', () => pick(m.id));
      pin.addTo(layers.current.pins);
    }
    if (!fitted.current) {
      const points: [number, number][] = [...ms.map((m): [number, number] => [m.lat, m.lng]), ...(r ?? [])];
      if (points.length === 1) map.current.setView(points[0]!, 15);
      else if (points.length > 1) map.current.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
      if (points.length > 0) fitted.current = true;
    }
  };

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !box.current || map.current) return;
      leaflet.current = L;
      map.current = L.map(box.current, { zoomControl: true }).setView(BANGKOK, 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map.current);
      layers.current = { pins: L.layerGroup().addTo(map.current), path: L.layerGroup().addTo(map.current) };
      draw();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layers.current = null;
      fitted.current = false;
    };
  }, []);

  // New data replaces the pins and the route; the map itself stays
  useEffect(() => {
    latest.current = { markers, route, selectedId, onSelect };
    draw();
  }, [markers, route, selectedId, onSelect]);

  return <div ref={box} role="application" aria-label="แผนที่ตำแหน่งรถ" className={`z-0 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${className}`} />;
}
