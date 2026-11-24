"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { localInput } from "@/lib/date/time-zones";
import { canChangeTime } from "./calendar-actions";
import { addDays } from "./dates";
import { calendarSlot, wallMinutes, type TimetableEvent } from "./time-layout";

export const SLOT_MINUTES = 15;
export const HOUR_HEIGHT = 56;
const TIME_AXIS_WIDTH = 52;

type Drop = { day: string; minute: number; edge?: "previous" | "next" };
type Drag = {
  event: TimetableEvent;
  day: string;
  pointer: number;
  x: number;
  y: number;
  grab: number;
  position: { x: number; y: number };
  moved: boolean;
  drop: Drop | null;
};

export function useCalendarDrag(
  blocked: boolean,
  singleDay: boolean,
  zone: string,
  onMove: (event: TimetableEvent, start: string, end: string | null) => void,
) {
  const scroller = useRef<HTMLElement>(null);
  const gesture = useRef<Drag | null>(null);
  const frame = useRef(0);
  const ignoreClickUntil = useRef(0);
  const [preview, setPreview] = useState<{
    event: TimetableEvent;
    drop: Drop | null;
  } | null>(null);

  function finish() {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const drag = gesture.current;
    gesture.current = null;
    if (drag?.moved) {
      ignoreClickUntil.current = Date.now() + 350;
      setPreview(null);
    }
    return drag;
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function track(canScroll = true) {
    const drag = gesture.current;
    const surface = scroller.current;
    if (!drag || !surface) return;
    const { x, y } = drag.position;
    const viewport = surface.getBoundingClientRect();
    const withinGrid =
      x >= viewport.left &&
      x < viewport.right &&
      y >= viewport.top + 54 &&
      y < viewport.bottom;
    let edge: Drop["edge"];
    if (singleDay && withinGrid) {
      const rail = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-day-drop-edge]");
      if (rail && surface.contains(rail)) {
        edge = rail.dataset.dayDropEdge === "previous" ? "previous" : "next";
      }
    }
    if (
      canScroll &&
      !edge &&
      x >= viewport.left &&
      x <= viewport.right &&
      y >= viewport.top &&
      y <= viewport.bottom
    ) {
      surface.scrollBy({
        top: y > viewport.bottom - 36 ? 12 : y < viewport.top + 72 ? -12 : 0,
        left: x > viewport.right - 32 ? 12 : x < viewport.left + 55 ? -12 : 0,
      });
    }
    let destination: Drop | null = null;
    if (edge && drag.event.start) {
      destination = {
        edge,
        day: addDays(drag.day, edge === "previous" ? -1 : 1),
        minute: wallMinutes(localInput(drag.event.start, zone)),
      };
    } else if (withinGrid && x >= viewport.left + TIME_AXIS_WIDTH) {
      for (const column of surface.querySelectorAll<HTMLElement>(
        "[data-calendar-day]",
      )) {
        const bounds = column.getBoundingClientRect();
        if (
          x < bounds.left ||
          x >= bounds.right ||
          y < bounds.top ||
          y >= bounds.bottom
        )
          continue;
        const raw = ((y - bounds.top - drag.grab) / HOUR_HEIGHT) * 60;
        destination = {
          day: column.dataset.calendarDay!,
          minute: Math.min(
            1440 - SLOT_MINUTES,
            Math.max(0, Math.round(raw / SLOT_MINUTES) * SLOT_MINUTES),
          ),
        };
        break;
      }
    }
    if (
      !drag.moved ||
      destination?.edge !== drag.drop?.edge ||
      destination?.day !== drag.drop?.day ||
      destination?.minute !== drag.drop?.minute
    ) {
      drag.drop = destination;
      setPreview({ event: drag.event, drop: destination });
    }
    frame.current = requestAnimationFrame(() => track());
  }

  function pointerDown(
    pointer: PointerEvent<HTMLButtonElement>,
    event: TimetableEvent,
    day: string,
  ) {
    ignoreClickUntil.current = 0;
    if (
      pointer.button !== 0 ||
      !pointer.isPrimary ||
      blocked ||
      !canChangeTime(event) ||
      !event.start ||
      localInput(event.start, zone).slice(0, 10) !== day
    )
      return;
    const { pointerId, clientX, clientY } = pointer;
    gesture.current = {
      event,
      day,
      pointer: pointerId,
      x: clientX,
      y: clientY,
      grab: clientY - pointer.currentTarget.getBoundingClientRect().top,
      position: { x: clientX, y: clientY },
      moved: false,
      drop: null,
    };
    pointer.currentTarget.setPointerCapture(pointerId);
  }

  function pointerMove(pointer: PointerEvent<HTMLButtonElement>) {
    const drag = gesture.current;
    if (!drag || drag.pointer !== pointer.pointerId) return;
    drag.position = { x: pointer.clientX, y: pointer.clientY };
    if (
      !drag.moved &&
      Math.hypot(pointer.clientX - drag.x, pointer.clientY - drag.y) < 5
    )
      return;
    if (!drag.moved) {
      setPreview({ event: drag.event, drop: null });
      drag.moved = true;
      track();
    }
  }

  function pointerUp(pointer: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointer !== pointer.pointerId) return;
    if (gesture.current.moved) {
      gesture.current.position = { x: pointer.clientX, y: pointer.clientY };
      cancelAnimationFrame(frame.current);
      track(false);
    }
    const drag = finish();
    if (!drag?.moved || !drag.drop || !drag.event.start) return;
    const previous = Date.parse(drag.event.start);
    const start = Date.parse(
      calendarSlot(drag.drop.day, drag.drop.minute, zone),
    );
    if (start === previous) return;
    const end = drag.event.end
      ? new Date(start + Date.parse(drag.event.end) - previous).toISOString()
      : null;
    onMove(drag.event, new Date(start).toISOString(), end);
  }

  return {
    scroller,
    preview,
    pointerDown,
    pointerMove,
    pointerUp,
    cancel: finish,
    suppressClick: () => Date.now() < ignoreClickUntil.current,
  };
}
