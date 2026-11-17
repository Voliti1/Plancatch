import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlalchemy import select

from app.api.dependencies import CurrentUser, DatabaseSession
from app.api.routes.deadlines import get_owned_deadline
from app.models import TaskProposal
from app.schemas.task_plan import DependencyEdit, GeneratePlan, PlanDecision, ReviewPlan
from app.services import task_dependencies as dependencies
from app.services import task_plans as plans

router = APIRouter(tags=["task-plans"])


@router.post("/api/deadlines/{deadline_id}/task-proposals", status_code=201)
def generate(deadline_id: uuid.UUID, payload: GeneratePlan, current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return plans.generate(db, current_user.id, deadline_id, payload)


@router.get("/api/deadlines/{deadline_id}/task-proposals")
def history(deadline_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession, response: Response,
            offset: Annotated[int, Query(ge=0, le=100000)] = 0):
    response.headers["Cache-Control"] = "no-store"
    get_owned_deadline(deadline_id, current_user.id, db)
    rows = list(db.scalars(select(TaskProposal).where(TaskProposal.user_id == current_user.id,
        TaskProposal.deadline_id == deadline_id).order_by(TaskProposal.created_at.desc(), TaskProposal.id.desc()).offset(offset).limit(21)))
    return {"entries": [plans.response(row) for row in rows[:20]], "has_more": len(rows) > 20}


@router.get("/api/task-proposals/{proposal_id}")
def read(proposal_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return plans.response(plans.owned(db, current_user.id, proposal_id))


@router.patch("/api/task-proposals/{proposal_id}")
def review(proposal_id: uuid.UUID, payload: ReviewPlan, current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return plans.review(db, current_user.id, proposal_id, payload)


@router.post("/api/task-proposals/{proposal_id}/approve")
def approve(proposal_id: uuid.UUID, payload: PlanDecision, current_user: CurrentUser, db: DatabaseSession):
    return plans.decide(db, current_user.id, proposal_id, payload.revision)


@router.post("/api/task-proposals/{proposal_id}/reject")
def reject(proposal_id: uuid.UUID, payload: PlanDecision, current_user: CurrentUser, db: DatabaseSession):
    return plans.decide(db, current_user.id, proposal_id, payload.revision, reject=True)


@router.get("/api/tasks/{task_id}/dependencies")
def read_dependencies(task_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return dependencies.read(db, current_user.id, task_id)


@router.put("/api/tasks/{task_id}/dependencies")
def edit_dependencies(task_id: uuid.UUID, payload: DependencyEdit, current_user: CurrentUser, db: DatabaseSession):
    return dependencies.replace(db, current_user.id, task_id, payload)
