/**
 * Findings over a satellite image of the field, with the offline plot as its
 * fallback.
 *
 * ── Why a satellite image now, when charts.tsx argues against one ───────────
 * The plot in `FieldMap` was built on two worries: that imagery would imply
 * more precision than a ~2.5 m handheld fix has, and that a map needing a
 * download would be the one screen that broke in a field. Both are handled
 * here rather than avoided:
 *
 *   Precision. Every finding is drawn as a circle of the fix's real error
 *   radius in metres, not as a pin, so zooming in shows the circle growing to
 *   cover several plants instead of pointing at one. The caption says so.
 *
 *   No signal. If no image tile loads within a few seconds (no internet, or
 *   the phone is on the pod's WiFi, which has none) the WebView is replaced by
 *   the offline plot, with a line saying why. The positions are identical;
 *   only the picture underneath is missing.
 *
 * What the image buys is recognition: a farmer finds their own field, bund and
 * tree line in it, which a graticule never gives them.
 *
 * ── Why a WebView and not react-native-maps ─────────────────────────────────
 * react-native-maps on Android needs a Google Maps API key baked into the
 * native build. Leaflet in a WebView with Esri's imagery tiles needs no key,
 * so the map works in Expo Go and in a dev build alike. Leaflet itself comes
 * from the CDN: when there is internet for the tiles there is internet for the
 * script, and when there is not, the fallback takes over either way.
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

import type { Tone } from './components.tsx';
import { chart, color, radius, space, type } from './theme.ts';

export type GeoPoint = {
  lat: number;
  lon: number;
  tone: Tone;
  /** Shown in the popup when the circle is tapped. */
  label: string;
  sub?: string;
  /** Passed back through `onOpen` when the popup's link is tapped. */
  id?: string;
};

/** The pod's stated fix error, CEP. See `gps.accuracy_note` on the wire. */
export const FIX_RADIUS_M = 2.5;

/** How long to wait for a first tile before deciding there is no imagery. */
const TILE_TIMEOUT_MS = 7000;

const TONE_STROKE: Record<Tone, string> = {
  bad: '#FF5A4E',
  warn: '#FFB020',
  good: '#4ADE80',
  unknown: '#CBD5E1',
  neutral: '#FFFFFF',
};

type Phase = 'loading' | 'ok' | 'offline';

export function SatelliteMap({
  points,
  height = 280,
  radiusM = FIX_RADIUS_M,
  fallback,
  onOpen,
}: {
  points: GeoPoint[];
  height?: number;
  radiusM?: number;
  /** What to show when no imagery loads. Usually the offline `FieldMap`. */
  fallback: ReactNode;
  onOpen?: (id: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const html = useMemo(() => buildHtml(points, radiusM, !!onOpen), [points, radiusM, onOpen]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { type?: string; id?: string } = {};
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'tiles-ok') setPhase('ok');
    if (msg.type === 'offline') setPhase((p) => (p === 'ok' ? p : 'offline'));
    if (msg.type === 'open' && msg.id && onOpen) onOpen(msg.id);
  };

  if (phase === 'offline') {
    return (
      <View>
        {fallback}
        <Text style={[type.small, { color: color.unknown, marginTop: space.sm }]}>
          No internet, so no satellite image. The positions are the same; only the picture
          underneath is missing.
        </Text>
      </View>
    );
  }

  return (
    <View style={[s.frame, { height }]}>
      <WebView
        source={{ html, baseUrl: 'https://aegis.local/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        onError={() => setPhase('offline')}
        onHttpError={() => setPhase('offline')}
        // The page scrolls; the map must not steal that. No nestedScrollEnabled:
        // on Android it stops the page taking any gesture that starts on the map,
        // which trapped the thumb there. Pinch and the +/- buttons still zoom.
        scrollEnabled={false}
        style={{ backgroundColor: chart.grid }}
        javaScriptEnabled
        domStorageEnabled
        // Tiles and the Leaflet script are cached like any web page, so a
        // field viewed once with signal can show again with a weak one.
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
      />
      {phase === 'loading' ? (
        <View style={s.loading} pointerEvents="none">
          <ActivityIndicator color={color.primary} />
          <Text style={[type.small, { color: color.mutedForeground, marginTop: space.xs }]}>
            Loading satellite image
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function buildHtml(points: GeoPoint[], radiusM: number, linkable: boolean): string {
  const data = points.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    stroke: TONE_STROKE[p.tone],
    label: p.label,
    sub: p.sub ?? '',
    id: p.id ?? '',
  }));

  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #map { margin: 0; height: 100%; background: #2b2f2b; }
  .leaflet-popup-content { font: 13px/1.35 sans-serif; margin: 10px 12px; }
  .leaflet-popup-content b { font-size: 14px; }
  .leaflet-popup-content a { color: #2E7D32; font-weight: 600; text-decoration: none; }
  .leaflet-control-attribution { font-size: 9px; }
  /* Let a vertical swipe on the map scroll the page. */
  .leaflet-container { touch-action: pan-y pinch-zoom !important; }
</style>
</head><body>
<div id="map"></div>
<script>
  function post(m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  var gotTile = false;
  setTimeout(function () { if (!gotTile) post({ type: 'offline' }); }, ${TILE_TIMEOUT_MS});
</script>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"
  onerror="post({ type: 'offline' })"></script>
<script>
  // Labels are pod data: escaped for the script tag here, for HTML below.
  var points = ${JSON.stringify(data).replace(/</g, '\\u003c')};
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  var radius = ${radiusM};
  var map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    // Dragging would fight the page scroll; pinch and the +/- buttons zoom.
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: true,
    touchZoom: true,
    maxZoom: 20,
  });
  var tiles = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 19, maxZoom: 20, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics' }
  ).addTo(map);
  tiles.on('tileload', function () { if (!gotTile) { gotTile = true; post({ type: 'tiles-ok' }); } });
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

  var group = [];
  points.forEach(function (p) {
    // The true error circle, in metres: grows as you zoom, never a pin.
    var c = L.circle([p.lat, p.lon], {
      radius: radius, color: p.stroke, weight: 2, fillColor: p.stroke, fillOpacity: 0.28,
    }).addTo(map);
    // A fixed-size dot so the finding is visible when zoomed out.
    var d = L.circleMarker([p.lat, p.lon], {
      radius: 4, color: '#000', weight: 1, fillColor: p.stroke, fillOpacity: 1,
    }).addTo(map);
    var html = '<b>' + esc(p.label) + '</b>' + (p.sub ? '<br>' + esc(p.sub) : '') +
      (${linkable} && p.id ? '<br><a href="#" data-id="' + esc(p.id) + '">Open scan</a>' : '');
    c.bindPopup(html); d.bindPopup(html);
    group.push([p.lat, p.lon]);
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-id]');
    if (a) { e.preventDefault(); post({ type: 'open', id: a.getAttribute('data-id') }); }
  });
  if (group.length === 1) map.setView(group[0], 19);
  else map.fitBounds(group, { padding: [36, 36], maxZoom: 19 });
</script>
</body></html>`;
}

const s = StyleSheet.create({
  frame: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: chart.grid,
  },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248,245,240,0.85)',
  },
});
