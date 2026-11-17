"""Bounded DAG validation and scheduling constraints; every node is owner-checked."""
import hashlib
import json
from datetime import UTC, datetime
from itertools import pairwise

from fastapi import HTTPException
from sqlalchemy import delete, select

from app.models import ScheduledEvent, Task, TaskDependency
from app.schemas.task_plan import validate_graph
from app.services.google_sync import lock_owner
from app.services.recurrence import utc

MAX_EDGES = 1000


def edges(db, owner):
    rows = db.execute(select(TaskDependency.task_id, TaskDependency.predecessor_id).where(
        TaskDependency.user_id == owner).order_by(TaskDependency.task_id, TaskDependency.predecessor_id).limit(MAX_EDGES + 1)).all()
    if len(rows) > MAX_EDGES:
        raise HTTPException(409, "작업 순서가 너무 많습니다. 불필요한 연결을 정리해 주세요.")
    return [(a, b) for a, b in rows]


def revision(rows):
    return hashlib.sha256(json.dumps(sorted((str(a), str(b)) for a, b in rows)).encode()).hexdigest()


def owned(db, owner, identity):
    task = db.scalar(select(Task).where(Task.user_id == owner, Task.id == identity))
    if not task:
        raise HTTPException(404, "할 일을 찾을 수 없습니다.")
    return task


def simple(task):
    return task.schedule_type == "flexible" and not task.recurrence and not task.series_id


def read(db, owner, identity):
    owned(db, owner, identity)
    rows = edges(db, owner)
    return {"predecessor_ids": [b for a, b in rows if a == identity], "revision": revision(rows)}


def replace(db, owner, identity, payload):
    lock_owner(db, owner)
    task = owned(db, owner, identity)
    rows = edges(db, owner)
    if revision(rows) != payload.revision:
        raise HTTPException(409, "작업 순서가 변경됐습니다. 다시 불러온 뒤 저장해 주세요.")
    if not simple(task) or any(not simple(owned(db, owner, parent)) for parent in payload.predecessor_ids):
        raise HTTPException(422, "반복하지 않는 유동 작업끼리만 순서를 연결할 수 있습니다.")
    proposed = [(a, b) for a, b in rows if a != identity] + [(identity, b) for b in payload.predecessor_ids]
    if len(proposed) > MAX_EDGES:
        raise HTTPException(422, "작업 순서가 너무 많습니다.")
    graph = {key: [] for pair in proposed for key in pair}
    for a, b in proposed:
        graph[a].append(b)
    try:
        validate_graph(graph)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    db.execute(delete(TaskDependency).where(TaskDependency.user_id == owner, TaskDependency.task_id == identity))
    db.add_all([TaskDependency(user_id=owner, task_id=identity, predecessor_id=b) for b in payload.predecessor_ids])
    db.commit()
    return read(db, owner, identity)


def order(tasks, mapping, key):
    pending = {t.id: set(mapping.get(t.id, [])) & {t.id for t in tasks} for t in tasks}
    by_id = {t.id: t for t in tasks}
    result = []
    while pending:
        ready = sorted((i for i, parents in pending.items() if not parents), key=lambda i: key(by_id[i]))
        if not ready:
            raise HTTPException(409, "작업 순서가 서로 맞물려 있습니다. 연결을 확인해 주세요.")
        # Select one node at a time so a newly-ready urgent task wins over later deadlines.
        identity = ready[0]
        result.append(by_id[identity]); del pending[identity]
        for parents in pending.values():
            parents.discard(identity)
    return result


def context(db, owner, selected):
    rows = edges(db, owner)
    mapping = {}
    for a, b in rows:
        mapping.setdefault(a, []).append(b)
    closure, stack = {t.id for t in selected}, [t.id for t in selected]
    while stack:
        for parent in mapping.get(stack.pop(), []):
            if parent not in closure:
                closure.add(parent); stack.append(parent)
    related = [(a, b) for a, b in rows if a in closure]
    if not related:
        return {}, {}, None
    tasks = list(db.scalars(select(Task).where(Task.user_id == owner, Task.id.in_(closure))))
    if len(tasks) != len(closure) or any(not simple(t) for t in tasks):
        raise HTTPException(409, "작업 순서에 연결된 할 일을 확인해 주세요.")
    ids = {t.id for t in selected}
    placed = list(db.scalars(select(ScheduledEvent).where(ScheduledEvent.user_id == owner,
        ScheduledEvent.task_id.in_(closure - ids), ScheduledEvent.status.in_(["approved", "synced"]))
        .order_by(ScheduledEvent.start_at, ScheduledEvent.id).limit(1001)))
    if len(placed) > 1000:
        raise HTTPException(409, "먼저 할 작업의 배치를 모두 확인하지 못했습니다.")
    finishes = {}
    for task in order(tasks, mapping, lambda t: str(t.id)):
        if task.is_completed:
            finishes[task.id] = utc(task.completed_at) if task.completed_at else datetime.now(UTC)
        elif task.id not in ids:
            blocks = [e for e in placed if e.task_id == task.id]
            parents = mapping.get(task.id, [])
            if (blocks and task.estimated_minutes and all(p in finishes for p in parents)
                and all(utc(e.end_at) > utc(e.start_at) for e in blocks)
                and all(utc(a.end_at) <= utc(b.start_at) for a, b in pairwise(blocks))
                and sum((utc(e.end_at)-utc(e.start_at)).total_seconds() for e in blocks) == task.estimated_minutes * 60
                and all(utc(blocks[0].start_at) >= finishes[p] for p in parents)):
                finishes[task.id] = max(utc(e.end_at) for e in blocks)
    state = {"edges": sorted((str(a), str(b)) for a, b in related),
        "tasks": sorted([{"id": str(t.id), "updated": utc(t.updated_at).isoformat(),
            "completed": t.is_completed, "completed_at": utc(t.completed_at).isoformat() if t.completed_at else None,
            "minutes": t.estimated_minutes} for t in tasks], key=lambda t: t["id"]),
        "placements": [(str(e.id), str(e.task_id), utc(e.start_at).isoformat(), utc(e.end_at).isoformat(), e.status) for e in placed]}
    return mapping, finishes, state
