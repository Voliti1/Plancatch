"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { PageHeading } from "@/components/page-heading";
import { SourceForm } from "@/features/sources/source-form";
import { tasksApi } from "@/features/tasks/api";
import { TaskForm } from "@/features/tasks/task-form";
import { deadlinesApi } from "@/features/deadlines/api";
import { googleCalendarApi } from "@/features/google-calendar/api";
import { useResource } from "@/lib/api/use-resource";
import { NaturalSchedule } from "./natural-schedule";
import type { TaskInput } from "@/types/task";
import type { DeadlineInput } from "@/types/api";
import type { NaturalScheduleDraft } from "@/types/natural-schedule";
import "./manual-registration.css";

type RegistrationMode = "source" | "manual";
type ManualMethod = "direct" | "sentence";

function RegistrationTabs<T extends string>({
  id,
  label,
  tabs,
  selected,
  onSelect,
  disabled,
  className,
}: {
  id: string;
  label: string;
  tabs: readonly { value: T; label: string; hint?: string }[];
  selected: T;
  onSelect: (value: T) => void;
  disabled: boolean;
  className: string;
}) {
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const index = tabs.findIndex(({ value }) => value === selected);
    const target = {
      Home: 0,
      End: tabs.length - 1,
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    onSelect(tabs[target].value);
    event.currentTarget.querySelectorAll("button")[target]?.focus();
  }
  return (
    <div
      className={className}
      role="tablist"
      aria-label={label}
      onKeyDown={navigate}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          id={`${id}-${tab.value}-tab`}
          type="button"
          role="tab"
          aria-label={tab.label}
          aria-describedby={tab.hint ? `${id}-${tab.value}-hint` : undefined}
          aria-selected={selected === tab.value}
          aria-controls={`${id}-${tab.value}-panel`}
          tabIndex={selected === tab.value ? 0 : -1}
          disabled={disabled}
          className="secondary"
          onClick={() => onSelect(tab.value)}
        >
          <span>{tab.label}</span>
          {tab.hint && <small id={`${id}-${tab.value}-hint`}>{tab.hint}</small>}
        </button>
      ))}
    </div>
  );
}

function ManualRegistration({
  initialMethod,
  enabled,
  manualDraft,
  deadlineId,
  saving,
  onCancel,
  onSave,
  onSaveDeadline,
}: {
  initialMethod: ManualMethod;
  enabled: boolean;
  manualDraft?: NaturalScheduleDraft;
  deadlineId?: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: TaskInput) => Promise<void>;
  onSaveDeadline: (payload: DeadlineInput) => Promise<void>;
}) {
  const id = useId();
  const [method, setMethod] = useState(initialMethod);
  const [directOpened, setDirectOpened] = useState(initialMethod === "direct");
  const status = useResource(googleCalendarApi.status);
  const googleNotice = status.loading
    ? "Google 캘린더 연결을 확인하고 있어요."
    : !status.data
      ? "Google 캘린더 연결 상태를 확인할 수 없어요."
      : !status.data.configured
        ? "현재 Google 캘린더 연동을 사용할 수 없어요."
        : status.data.reconnect_required
          ? "알림을 받으려면 Google 계정을 다시 연결해 권한을 허용해 주세요."
          : status.data.connected
            ? "연결된 Google 캘린더에 알림 설정이 반영됩니다."
            : "Google 계정이 연결되어 있지 않아요. 알림 설정은 일정과 함께 저장됩니다.";

  function selectMethod(next: ManualMethod) {
    if (next === "direct") setDirectOpened(true);
    setMethod(next);
  }

  const reminderNotice = (
    <p className="registration-google-notice small muted">
      {googleNotice}{" "}
      {!status.loading &&
        !status.data?.connected &&
        status.data?.configured !== false && (
          <Link
            href="/settings/google-calendar"
            aria-disabled={saving || undefined}
            onClick={(event) => {
              if (saving) event.preventDefault();
            }}
          >
            연결 설정
          </Link>
        )}
    </p>
  );
  const formProps = {
    deadlineId,
    onCancel,
    onSave,
    onSaveDeadline,
    reminderNotice,
  };

  return (
    <section className="card source-registration manual-registration-card">
      <div className="manual-registration-heading">
        <h2>수동 일정 등록</h2>
        <Link
          className="text-button"
          href="/deadlines"
          aria-disabled={saving || undefined}
          onClick={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          등록한 일정 보기 →
        </Link>
      </div>
      <RegistrationTabs<ManualMethod>
        id={id}
        label="수동 입력 방식"
        tabs={[
          { value: "direct", label: "직접 입력" },
          { value: "sentence", label: "문장으로 등록" },
        ]}
        selected={method}
        onSelect={selectMethod}
        disabled={saving}
        className="registration-methods"
      />
      <div
        id={`${id}-direct-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-direct-tab`}
        hidden={method !== "direct"}
      >
        {directOpened && (
          <TaskForm
            {...formProps}
            draft={manualDraft}
            variant="calendar"
            submitLabel="일정 등록"
            disabled={saving}
            cancelPreservesInput
          />
        )}
      </div>
      <div
        id={`${id}-sentence-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-sentence-tab`}
        hidden={method !== "sentence"}
      >
        <NaturalSchedule
          {...formProps}
          enabled={enabled && method === "sentence"}
          saving={saving}
          onDirectInput={() => {
            selectMethod("direct");
            document.getElementById(`${id}-direct-tab`)?.focus();
          }}
        />
      </div>
    </section>
  );
}

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
    <div className="schedule-registration">
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
        description="자료에서 마감일을 찾거나 할 일과 마감일을 직접 등록하세요."
      />
      <RegistrationTabs<RegistrationMode>
        id={id}
        label="일정 등록 방식"
        tabs={[
          {
            value: "source",
            label: "자료로 등록",
            hint: "PDF, 이미지, 링크 또는 원문",
          },
          {
            value: "manual",
            label: "수동 일정 등록",
            hint: "직접 입력 또는 한 문장으로 시작",
          },
        ]}
        selected={mode}
        onSelect={selectMode}
        disabled={saving}
        className="schedule-registration-modes"
      />
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
          <ManualRegistration
            enabled={mode === "manual"}
            initialMethod={initialMode === "natural" ? "sentence" : "direct"}
            manualDraft={manualDraft}
            deadlineId={deadlineId}
            saving={saving}
            onCancel={() => {
              selectMode("source");
              document.getElementById(`${id}-source-tab`)?.focus();
            }}
            onSave={saveTask}
            onSaveDeadline={saveDeadline}
          />
        )}
      </div>
    </div>
  );
}
