"""
Pydantic schemas for Drishti — the AI Construction Intelligence Assistant.

Drishti is a read-only conversational layer over the existing construction
progress system. These schemas define the contract between the LLM's
structured JSON answer, server-side validation, and the frontend renderer.

`DrishtiAnswer` is the single most important model here: every LLM response
MUST validate against it before reaching the frontend (see drishti_service.py)
so a malformed/hallucinated shape from the model can never bypass the backend.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class DrishtiProjectListItem(BaseModel):
    project_id: str = Field(..., alias="projectId")
    project_name: str = Field(..., alias="projectName")
    tower_count: int = Field(0, alias="towerCount")
    floor_count: int = Field(0, alias="floorCount")
    overall_progress_pct: Optional[float] = Field(None, alias="overallProgressPct")
    floors_analyzed: int = Field(0, alias="floorsAnalyzed")
    floors_not_yet_analyzed: int = Field(0, alias="floorsNotYetAnalyzed")
    last_analyzed_at: Optional[datetime] = Field(None, alias="lastAnalyzedAt")

    model_config = {"populate_by_name": True}


class DrishtiScope(BaseModel):
    tower_id: Optional[str] = Field(None, alias="towerId")
    tower_name: Optional[str] = Field(None, alias="towerName")
    floor_id: Optional[str] = Field(None, alias="floorId")
    floor_name: Optional[str] = Field(None, alias="floorName")
    flat_name: Optional[str] = Field(None, alias="flatName")
    room_name: Optional[str] = Field(None, alias="roomName")

    model_config = {"populate_by_name": True}


class DrishtiMetric(BaseModel):
    label: str
    value: str
    trend: Optional[Literal["up", "down", "flat"]] = None

    model_config = {"populate_by_name": True}


class DrishtiEvidenceRef(BaseModel):
    floor_id: Optional[str] = Field(None, alias="floorId")
    flat_name: Optional[str] = Field(None, alias="flatName")
    room_name: Optional[str] = Field(None, alias="roomName")
    snapshot_id: Optional[str] = Field(None, alias="snapshotId")
    note: str = ""

    model_config = {"populate_by_name": True}


class DrishtiAnswer(BaseModel):
    """The strict structured shape every LLM answer must validate against.

    `facts` must come only from supplied data; `insights` and
    `recommendations` are the model's interpretation, kept in separate
    fields precisely so a reader (and the frontend renderer) can always
    tell measured fact apart from AI judgment.
    """

    answer: str
    scope: DrishtiScope = Field(default_factory=DrishtiScope)
    facts: list[str] = Field(default_factory=list)
    insights: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    metrics: list[DrishtiMetric] = Field(default_factory=list)
    evidence: list[DrishtiEvidenceRef] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list, alias="followUpQuestions")

    model_config = {"populate_by_name": True}


class DrishtiMessage(BaseModel):
    message_id: str = Field(..., alias="messageId")
    role: Literal["user", "assistant"]
    content: str
    structured_payload: Optional[DrishtiAnswer] = Field(None, alias="structuredPayload")
    created_at: datetime = Field(..., alias="createdAt")

    model_config = {"populate_by_name": True}


class DrishtiConversationSummary(BaseModel):
    conversation_id: str = Field(..., alias="conversationId")
    project_id: str = Field(..., alias="projectId")
    project_name: str = Field(..., alias="projectName")
    title: str
    updated_at: datetime = Field(..., alias="updatedAt")

    model_config = {"populate_by_name": True}


class DrishtiConversationDetail(DrishtiConversationSummary):
    scope: DrishtiScope = Field(default_factory=DrishtiScope)
    messages: list[DrishtiMessage] = Field(default_factory=list)
    created_at: datetime = Field(..., alias="createdAt")

    model_config = {"populate_by_name": True}


class AskDrishtiRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    conversation_id: Optional[str] = Field(None, alias="conversationId")

    model_config = {"populate_by_name": True}


class AskDrishtiResponse(BaseModel):
    conversation_id: str = Field(..., alias="conversationId")
    message: DrishtiMessage

    model_config = {"populate_by_name": True}


class SuggestedQuestionsResponse(BaseModel):
    questions: list[str]
