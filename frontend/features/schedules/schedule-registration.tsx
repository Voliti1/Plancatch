"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { PageHeading } from "@/components/page-heading";
import { SourceForm } from "@/features/sources/source-form";
import { TaskForm } from "@/features/tasks/task-form";
import { tasksApi } from "@/features/tasks/api";
import { deadlinesApi } from "@/features/deadlines/api";
import "./manual-registration.css";

type RegistrationMode = "source" | "manual";

export function ScheduleRegistration({
  initialMode = "source",
  deadlineId,
}: {
  initialMode?: RegistrationMode;
  deadlineId?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [mode, setMode] = useState<RegistrationMode>(initialMode);
  const [manualOpened, setManualOpened] = useState(initialMode === "manual");
  const [saving, setSaving] = useState(false);
  const sourceTab = useRef<HTMLButtonElement>(null);
  const manualTab = useRef<HTMLButtonElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  function selectMode(next: RegistrationMode) {
    if (saving) return;
    if (next === "manual") setManualOpened(true);
    setMode(next);
  }

  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    if (
      saving ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "source"
        : event.key === "End"
          ? "manual"
          : mode === "source"
            ? "manual"
            : "source";
    selectMode(next);
    (next === "source" ? sourceTab : manualTab).current?.focus();
  }

  return (
    <>
      <Link
        className="back-link"
        href="/dashboard"
        aria-disabled={saving || undefined}
        onClick={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        ← 대시보드
      </Link>
      <PageHeading
        eyebrow="NEW SCHEDULE"
        title="새 일정 등록"
        description="자료에서 일정을 정리하거나, 필요한 내용을 직접 입력해 등록하세요."
      />
      <div
        className="schedule-registration-modes"
        role="tablist"
        aria-label="일정 등록 방식"
        onKeyDown={navigateTabs}
      >
        <button
          ref={sourceTab}
          id={`${id}-source-tab`}
          type="button"
          role="tab"
          aria-selected={mode === "source"}
          aria-controls={`${id}-source-panel`}
          tabIndex={mode === "source" ? 0 : -1}
          disabled={saving}
          className={mode === "source" ? "selected" : "secondary"}
          onClick={() => selectMode("source")}
        >
          자료로 등록
        </button>
        <button
          ref={manualTab}
          id={`${id}-manual-tab`}
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          aria-controls={`${id}-manual-panel`}
          tabIndex={mode === "manual" ? 0 : -1}
          disabled={saving}
          className={mode === "manual" ? "selected" : "secondary"}
          onClick={() => selectMode("manual")}
        >
          수동 일정 등록
        </button>
      </div>
      <div
        id={`${id}-source-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-source-tab`}
        hidden={mode !== "source"}
      >
        <SourceForm embedded onBusyChange={setSaving} />
      </div>
      <div
        id={`${id}-manual-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-manual-tab`}
        hidden={mode !== "manual"}
      >
        {manualOpened && (
          <section className="card source-registration manual-registration-card">
            <div className="manual-registration-heading">
              <h2>수동 일정 등록</h2>
              <Link
                className="text-button"
                href="/tasks"
                aria-disabled={saving || undefined}
                onClick={(event) => {
                  if (saving) event.preventDefault();
                }}
              >
                등록한 일정 보기 →
              </Link>
            </div>
            <p className="small muted">
              일정명과 시간을 입력하세요. 필요한 내용은 나중에 수정할 수
              있습니다.
            </p>
            <TaskForm
              deadlineId={deadlineId}
              variant="calendar"
              submitLabel="일정 등록"
              disabled={saving}
              onSaveDeadline={async (payload) => {
                setSaving(true);
                try {
                  const deadline = await deadlinesApi.create(payload);
                  if (active.current)
                    router.push(
                      `/deadlines/${encodeURIComponent(deadline.id)}`,
                    );
                } catch (error) {
                  if (!active.current) return;
                  setSaving(false);
                  throw error;
                }
              }}
              onCancel={() => selectMode("source")}
              onSave={async (payload) => {
                setSaving(true);
                try {
                  const task = await tasksApi.create(payload);
                  // The sidebar can mount a fresh registration during this save.
                  if (active.current)
                    router.push(`/tasks/${encodeURIComponent(task.id)}`);
                } catch (error) {
                  if (!active.current) return;
                  setSaving(false);
                  throw error;
                }
              }}
            />
          </section>
        )}
      </div>
    </>
  );
}
