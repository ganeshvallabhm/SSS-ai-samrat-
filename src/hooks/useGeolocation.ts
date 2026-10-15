import { useCallback, useEffect, useRef, useState } from 'react';

export type GeoError = 'denied' | 'unavailable' | 'timeout' | null;

export interface GeoState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  error: GeoError;
  locating: boolean;
}

export interface UseGeolocationReturn extends GeoState {
  retry: () => void;
  /** accuracy < 50m = good, < 100m = weak, else poor */
  quality: 'good' | 'weak' | 'poor' | 'locating';
  /** Human readable chip label */
  chipLabel: string;
  /** Whether GPS is good enough to shoot (≤50 m) */
  readyToShoot: boolean;
}

function mapGeoError(err: GeolocationPositionError): GeoError {
  if (err.code === err.PERMISSION_DENIED) return 'denied';
  if (err.code === err.POSITION_UNAVAILABLE) return 'unavailable';
  if (err.code === err.TIMEOUT) return 'timeout';
  return 'unavailable';
}

export function useGeolocation(): UseGeolocationReturn {
  const watchIdRef = useRef<number | null>(null);
  const [geo, setGeo] = useState<GeoState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    error: null,
    locating: true,
  });

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo(s => ({ ...s, error: 'unavailable', locating: false }));
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    setGeo(s => ({ ...s, error: null, locating: true }));

    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        setGeo({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          error: null,
          locating: false,
        });
      },
      err => {
        setGeo(s => ({ ...s, error: mapGeoError(err), locating: false }));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
    );
  }, []);

  useEffect(() => {
    startWatch();
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [startWatch]);

  const retry = useCallback(() => {
    startWatch();
  }, [startWatch]);

  const acc = geo.accuracy;
  const quality: UseGeolocationReturn['quality'] =
    geo.locating ? 'locating'
    : acc === null ? 'poor'
    : acc <= 50 ? 'good'
    : acc <= 100 ? 'weak'
    : 'poor';

  const chipLabel =
    geo.locating ? 'Locating…'
    : acc === null ? 'No GPS'
    : acc <= 50 ? `GPS good ±${Math.round(acc)} m`
    : acc <= 100 ? `Weak GPS ±${Math.round(acc)} m`
    : `Poor GPS ±${Math.round(acc)} m`;

  const readyToShoot = quality === 'good';

  return { ...geo, retry, quality, chipLabel, readyToShoot };
}
