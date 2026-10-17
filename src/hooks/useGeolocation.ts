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
  getCurrentPosition: () => Promise<GeoState>;
  /** accuracy < 50m = good, < 100m = weak, else poor */
  quality: 'good' | 'weak' | 'poor' | 'locating';
  /** Human readable chip label */
  chipLabel: string;
  /** Whether GPS coordinates are available */
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

  const getCurrentPosition = useCallback((): Promise<GeoState> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        const fallback: GeoState = {
          latitude: null,
          longitude: null,
          accuracy: null,
          error: 'unavailable',
          locating: false,
        };
        setGeo(fallback);
        resolve(fallback);
        return;
      }

      setGeo(s => ({ ...s, locating: true, error: null }));

      navigator.geolocation.getCurrentPosition(
        pos => {
          const fresh: GeoState = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            error: null,
            locating: false,
          };
          setGeo(fresh);
          resolve(fresh);
        },
        err => {
          // If high accuracy timed out, retry with standard accuracy before giving up
          if (err.code === err.TIMEOUT) {
            navigator.geolocation.getCurrentPosition(
              fallbackPos => {
                const fresh: GeoState = {
                  latitude: fallbackPos.coords.latitude,
                  longitude: fallbackPos.coords.longitude,
                  accuracy: fallbackPos.coords.accuracy,
                  error: null,
                  locating: false,
                };
                setGeo(fresh);
                resolve(fresh);
              },
              fallbackErr => {
                const failed: GeoState = {
                  latitude: null,
                  longitude: null,
                  accuracy: null,
                  error: mapGeoError(fallbackErr),
                  locating: false,
                };
                setGeo(failed);
                resolve(failed);
              },
              { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 }
            );
            return;
          }

          const failed: GeoState = {
            latitude: null,
            longitude: null,
            accuracy: null,
            error: mapGeoError(err),
            locating: false,
          };
          setGeo(failed);
          resolve(failed);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 }
      );
    });
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo(s => ({ ...s, error: 'unavailable', locating: false }));
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    // Call getCurrentPosition explicitly for prompt coordinates
    void getCurrentPosition();

    // Also watch position for real-time updates as user moves
    try {
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
    } catch {
      // Fallback if watchPosition fails
    }
  }, [getCurrentPosition]);

  useEffect(() => {
    startTracking();
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [startTracking]);

  const retry = useCallback(() => {
    startTracking();
  }, [startTracking]);

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

  const readyToShoot = geo.latitude !== null && geo.longitude !== null;

  return { ...geo, retry, getCurrentPosition, quality, chipLabel, readyToShoot };
}
