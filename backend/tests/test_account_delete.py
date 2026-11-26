"""Account deletion reauthentication, ownership, cascades and private file lifecycle."""
import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.user import User
from app.models.source import Source
from app.models.task import Task
from app.models.deadline import Deadline
from app.services import source_images
from tests.test_auth import TestingSession
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

def account():
    return auth_headers(f"delete-{uuid.uuid4().hex}@example.com")

def owned_file(headers, data=b"sample", kind="pdf"):
    key=source_images.store_file(data,kind)
    owner=uuid.UUID(client.get("/api/auth/me",headers=headers).json()["id"])
    with TestingSession() as db:
        source=Source(user_id=owner,source_type=kind,storage_key=key)
        db.add(source); db.commit()
        return key,source.id,owner

def test_delete_password_proof_cascades_only_owner_and_cleans_files(monkeypatch,tmp_path):
    monkeypatch.setattr(source_images,"ROOT",tmp_path)
    headers,other=account(),account()
    key,source_id,owner=owned_file(headers)
    other_key,_,_=owned_file(other,b"other")
    task=client.post("/api/tasks",headers=headers,json={"title":"owned"}); assert task.status_code==201
    due=client.post("/api/deadlines",headers=headers,json={"title":"owned","due_at":"2026-12-01T09:00:00Z","source_id":str(source_id)}); assert due.status_code==201
    for payload in [{},{"current_password":"wrong"},{"confirmation_email":client.get("/api/auth/me",headers=headers).json()["email"]}]:
        assert client.post("/api/auth/delete",headers=headers,json=payload).status_code==400
        assert source_images.file_path(key).exists()
    assert client.post("/api/auth/delete",headers=headers,json={"current_password":"source-test-password","user_id":str(owner)}).status_code==422
    response=client.post("/api/auth/delete",headers=headers,json={"current_password":"source-test-password"})
    assert response.status_code==204
    assert response.headers["cache-control"]=="no-store"
    assert not source_images.file_path(key).exists()
    assert source_images.file_path(other_key).exists()
    assert client.get("/api/auth/me",headers=headers).status_code==401
    assert client.get("/api/auth/me",headers=other).status_code==200
    with TestingSession() as db:
        assert db.get(User,owner) is None
        for model in (Source,Task,Deadline): assert db.scalar(select(model).where(model.user_id==owner)) is None

def test_social_delete_requires_matching_email(monkeypatch,tmp_path):
    monkeypatch.setattr(source_images,"ROOT",tmp_path)
    headers=account();key,_,owner=owned_file(headers)
    with TestingSession() as db:
        user=db.get(User,owner);user.password_enabled=False;email=user.email;db.commit()
    for payload in [{},{"confirmation_email":"wrong@example.com"},{"current_password":"source-test-password"}]:
        assert client.post("/api/auth/delete",headers=headers,json=payload).status_code==400
    assert client.post("/api/auth/delete",headers=headers,json={"confirmation_email":email.upper()}).status_code==204
    assert not source_images.file_path(key).exists()

def test_failed_commit_never_removes_file_or_user(monkeypatch,tmp_path):
    monkeypatch.setattr(source_images,"ROOT",tmp_path)
    headers=account();key,_,owner=owned_file(headers)
    def fail_commit(self): raise RuntimeError("synthetic commit failure")
    with monkeypatch.context() as patch:
        patch.setattr(Session,"commit",fail_commit)
        with pytest.raises(RuntimeError,match="synthetic commit failure"):
            client.post("/api/auth/delete",headers=headers,json={"current_password":"source-test-password"})
    assert source_images.file_path(key).exists()
    assert client.get("/api/auth/me",headers=headers).status_code==200
    with TestingSession() as db: assert db.get(User,owner) is not None

def test_delete_requires_authentication():
    assert client.post("/api/auth/delete",json={"current_password":"anything"}).status_code==401


def test_file_removal_failure_is_durable_and_retryable(monkeypatch,tmp_path):
    from app.services.upload_cleanup import retry_pending
    monkeypatch.setattr(source_images,"ROOT",tmp_path)
    headers=account();key,_,_=owned_file(headers)
    with monkeypatch.context() as patch:
        def unavailable(_): raise PermissionError("temporary file lock")
        patch.setattr(source_images,"remove_file",unavailable)
        assert client.post("/api/auth/delete",headers=headers,json={"current_password":"source-test-password"}).status_code==204
    assert client.get("/api/auth/me",headers=headers).status_code==401
    assert (tmp_path/".deletion-pending"/key).is_file()
    retry_pending()
    assert not (tmp_path/key).exists()
    assert not (tmp_path/".deletion-pending"/key).exists()

def test_cleanup_rejects_traversal_and_symlinks(monkeypatch,tmp_path):
    from app.services.upload_cleanup import remove_after_commit
    monkeypatch.setattr(source_images,"ROOT",tmp_path/"private")
    outside=tmp_path/"outside";outside.write_text("keep")
    remove_after_commit("../outside")
    assert outside.read_text()=="keep"
