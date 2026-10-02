from pydantic import BaseModel


class TutorialLessonOut(BaseModel):
    id: str
    title: str
    summary: str
    duration_seconds: float
    transcript: str


class TutorialCatalogueOut(BaseModel):
    available: bool
    lessons: list[TutorialLessonOut]
