"use client";
import { useId, useRef, useState } from "react";
import { useAuth } from "@/features/auth/provider";
import { ErrorNotice } from "@/components/feedback";
import { errorMessage } from "@/lib/api/client";
import { ThemeToggle } from "./theme";

export function AccountControls({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const heading = useId();
  const { changePassword, updateProfile, user } = useAuth();
  const [profileName, setProfileName] = useState(user?.display_name ?? "");
  const [profileBusy, setProfileBusy] = useState(false);
  const profilePending = useRef(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  function clear() {
    setCurrent("");
    setNext("");
    setConfirmation("");
    setError("");
    setSuccess(false);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    setError("");
    setSuccess(false);
    if (!current) {
      setError("현재 비밀번호를 입력해 주세요.");
      return;
    }
    if (next.length < 8 || next.length > 128) {
      setError("새 비밀번호는 8자 이상 128자 이하로 입력해 주세요.");
      return;
    }
    if (next !== confirmation) {
      setError("새 비밀번호가 일치하지 않아요.");
      return;
    }
    if (next === current) {
      setError("현재와 다른 새 비밀번호를 입력해 주세요.");
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirmation("");
      setSuccess(true);
    } catch (err) {
      const message = errorMessage(err);
      setError(
        message === "current_password_incorrect"
          ? "현재 비밀번호가 맞지 않아요. 다시 확인해 주세요."
          : message === "new_password_unchanged"
            ? "현재와 다른 새 비밀번호를 입력해 주세요."
            : message,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="account-row">
        <strong title={name}>{name}</strong>
        <ThemeToggle />
        <button
          type="button"
          className="account-icon"
          aria-label="설정 열기"
          title="설정"
          aria-haspopup="dialog"
          onClick={() => {
            setProfileName(user?.display_name ?? "");
            setProfileMessage("");
            setProfileError("");
            dialog.current?.showModal();
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9.5 3-.6 2.1-2 .9-2-.5-2 3.5L4.4 11v2l-1.5 2 2 3.5 2-.5 2 .9.6 2.1h5l.6-2.1 2-.9 2 .5 2-3.5-1.5-2v-2l1.5-2-2-3.5-2 .5-2-.9L14.5 3Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
      <dialog
        ref={dialog}
        className="account-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        onClose={clear}
        onCancel={(event) => {
          if (pending.current || profilePending.current) event.preventDefault();
        }}
        onClick={(event) => {
          if (pending.current || profilePending.current || event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            dialog.current?.close();
        }}
      >
        <div className="account-settings-heading">
          <h2 id={heading}>설정</h2>
          <button
            type="button"
            className="account-icon"
            aria-label="설정 닫기"
            disabled={busy || profileBusy}
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        <div className="account-settings-body">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (profilePending.current) return;
              profilePending.current = true;
              setProfileBusy(true);
              setProfileError("");
              setProfileMessage("");
              try {
                await updateProfile({
                  display_name: profileName.trim() || null,
                });
                setProfileMessage("이름을 저장했어요.");
              } catch (error) {
                setProfileError(errorMessage(error));
              } finally {
                profilePending.current = false;
                setProfileBusy(false);
              }
            }}
          >
            <fieldset disabled={profileBusy}>
              <label>
                프로필 이름
                <input
                  value={profileName}
                  maxLength={100}
                  autoComplete="name"
                  onChange={(event) => setProfileName(event.target.value)}
                />
              </label>
              <button type="submit">이름 저장</button>
            </fieldset>
            {profileMessage && <p role="status">{profileMessage}</p>}
            {profileError && <p role="alert">{profileError}</p>}
          </form>
          <dl className="settings-profile">
            <div>
              <dt>이름</dt>
              <dd>{name}</dd>
            </div>
            <div>
              <dt>이메일</dt>
              <dd>{email}</dd>
            </div>
          </dl>
          {user?.password_enabled !== false && (
            <>
              <h3>비밀번호 변경</h3>
              <p className="small muted">
                현재 비밀번호를 확인한 뒤 새 비밀번호로 변경해요.
              </p>
              <form onSubmit={submit} noValidate>
                <fieldset disabled={busy}>
                  <label>
                    현재 비밀번호
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={current}
                      maxLength={128}
                      onChange={(event) => setCurrent(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    새 비밀번호
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={next}
                      minLength={8}
                      maxLength={128}
                      onChange={(event) => setNext(event.target.value)}
                      placeholder="8자 이상"
                      required
                    />
                  </label>
                  <label>
                    새 비밀번호 확인
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmation}
                      maxLength={128}
                      onChange={(event) => setConfirmation(event.target.value)}
                      required
                    />
                  </label>
                  {error && <ErrorNotice message={error} />}
                  {success && (
                    <p className="success" role="status">
                      비밀번호를 변경했어요.
                    </p>
                  )}
                  <div className="form-actions">
                    <button type="submit">
                      {busy ? "변경 중…" : "비밀번호 변경"}
                    </button>
                  </div>
                </fieldset>
              </form>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
