"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { PageHeading } from "@/components/page-heading";
import { SourceForm } from "@/features/sources/source-form";
import { tasksApi } from "@/features/tasks/api";
import { deadlinesApi } from "@/features/deadlines/api";
import { NaturalSchedule } from "./natural-schedule";
import type { TaskInput } from "@/types/task";
import type { DeadlineInput } from "@/types/api";
import type { NaturalScheduleDraft } from "@/types/natural-schedule";
import "./manual-registration.css";

type RegistrationMode = "source" | "manual";

export function ScheduleRegistration({
  initialMode = "source",
  deadlineId,
  manualDraft,
}: {
  initialMode?: RegistrationMode | "natural";
  deadlineId?: string;
  manualDraft?: NaturalScheduleDraft;
}) {
  const router = useRouter();
  const id = useId();
  const [mode, setMode] = useState<RegistrationMode>(
    initialMode === "natural" ? "manual" : initialMode,
  );
  const [manualOpened, setManualOpened] = useState(initialMode !== "source");
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
    const modes: RegistrationMode[] = ["source", "manual"];
    const next =
      event.key === "Home"
        ? "source"
        : event.key === "End"
          ? "manual"
          : modes[(modes.indexOf(mode) + 1) % modes.length];
    selectMode(next);
    ({ source: sourceTab, manual: manualTab })[next].current?.focus();
  }

  async function saveTask(payload: TaskInput) {
    setSaving(true);
    try {
      const task = await tasksApi.create(payload);
      if (active.current) router.push(`/tasks/${encodeURIComponent(task.id)}`);
    } catch (error) {
      if (!active.current) return;
      setSaving(false);
      throw error;
    }
  }

  async function saveDeadline(payload: DeadlineInput) {
    setSaving(true);
    try {
      const deadline = await deadlinesApi.create(payload);
      if (active.current)
        router.push(`/deadlines/${encodeURIComponent(deadline.id)}`);
    } catch (error) {
      if (!active.current) return;
      setSaving(false);
      throw error;
    }
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
          <NaturalSchedule
            enabled={mode === "manual"}
            initialDraft={manualDraft}
            deadlineId={deadlineId}
            onCancel={() => selectMode("source")}
            onBusyChange={setSaving}
            onSave={saveTask}
            onSaveDeadline={saveDeadline}
          />
        )}
      </div>
    </>
  );
}
