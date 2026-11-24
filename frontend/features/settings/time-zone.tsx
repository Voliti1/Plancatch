"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/features/auth/provider";
import { useUnsavedNavigation } from "@/lib/unsaved-changes";
import {
  clockTime,
  formatDateTime,
  gmtOffset,
  localInput,
  preferredZone,
  SEOUL,
  timeZones,
  zoneName,
  zonedInputToUtc,
} from "@/lib/date/time-zones";
import "./time-zone.css";

const key = "plancatch.guest-time-zone";
const guestChange = "plancatch:guest-time-zone";
let guestFallback = SEOUL;

function readGuestZone() {
  try {
    return preferredZone(localStorage.getItem(key));
  } catch {
    return guestFallback;
  }
}

function subscribeGuestZone(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(guestChange, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(guestChange, notify);
  };
}

const defaultZone = () => SEOUL;

export function useTimeZone() {
  const { user } = useAuth();
  return preferredZone(user?.time_zone);
}

export function useScheduleTime() {
  const zone = useTimeZone();
  return {
    zone,
    zoneLabel: zoneName(zone),
    formatLocal: (value: string) => formatDateTime(value, zone),
    toLocalInput: (value: string) => localInput(value, zone),
    fromLocalInput: (value: string) => zonedInputToUtc(value, zone),
  };
}

export function TimeZoneControl() {
  const { user, saveTimeZone } = useAuth();
  const { confirmLeave } = useUnsavedNavigation();
  const guestZone = useSyncExternalStore(
    subscribeGuestZone,
    readGuestZone,
    defaultZone,
  );
  const [now, setNow] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const zone = user ? preferredZone(user.time_zone) : guestZone;

  useEffect(() => {
    const update = () => setNow(new Date());
    const frame = window.requestAnimationFrame(update);
    const interval = window.setInterval(update, 1000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, []);

  async function select(next: string) {
    if (saving || zone === next || (user && !confirmLeave())) return;
    setError("");
    if (!user) {
      guestFallback = next;
      try {
        localStorage.setItem(key, next);
      } catch {}
      window.dispatchEvent(new Event(guestChange));
      return;
    }
    setSaving(true);
    try {
      await saveTimeZone(next);
    } catch {
      setError("시간대를 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="time-zone-control">
      {now && (
        <div className="time-zone-clocks" aria-label="현재 시각">
          <span>
            한국 <time>{clockTime(now, SEOUL)}</time>
          </span>
          {zone !== SEOUL && (
            <span>
              {zoneName(zone)} <time>{clockTime(now, zone)}</time>
            </span>
          )}
        </div>
      )}
      <span className="timezone time-zone-select">
        {zone} · {zoneName(zone)}
        <select
          aria-label="기준 시간대 변경"
          value={zone}
          disabled={saving}
          onChange={(event) => void select(event.currentTarget.value)}
        >
          {timeZones.map(([id, name]) => (
            <option key={id} value={id}>
              {now ? `(${gmtOffset(now, id)}) ` : ""}
              {name} · {id}
            </option>
          ))}
        </select>
      </span>
      {error && (
        <span className="time-zone-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
