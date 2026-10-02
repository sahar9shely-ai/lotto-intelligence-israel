from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.models.auth import User
from app.schemas.tutorials import TutorialCatalogueOut
from app.security.auth import get_current_user, is_manager
from app.services import tutorial_service as tutorials

router = APIRouter(prefix="/api/v1/tutorials", tags=["investor-tutorials"])


def require_investor(user: User = Depends(get_current_user)) -> User:
    if is_manager(user) or not user.investor:
        raise HTTPException(status_code=403, detail="ההדרכה מיועדת למשקיעים")
    return user


@router.get("", response_model=TutorialCatalogueOut)
def catalogue(_: User = Depends(require_investor)):
    lessons = tutorials.published_lessons()
    return TutorialCatalogueOut(available=bool(lessons), lessons=list(lessons))


@router.get("/media/{lesson_id}/{asset}")
def media(lesson_id: str, asset: str, _: User = Depends(require_investor)):
    lessons = tutorials.published_lessons()
    if asset not in {"video", "poster", "captions"} or lesson_id not in {lesson.id for lesson in lessons}:
        raise HTTPException(status_code=404, detail="סרטון לא זמין")
    path = tutorials.asset_path(tutorials.media_root(), lesson_id, asset)
    return FileResponse(path, media_type=tutorials.ASSET_TYPES[asset][2], headers={
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
    })
