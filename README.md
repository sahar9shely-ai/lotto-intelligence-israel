# GOT URS

אפליקציית מובייל (PWA) בעברית — חדרים בהפתעה, פרופיל, נקודות, פרימיום, צ'אט והזמנת חברים.

## למה זה עובד גם בטלפון אחר

1. פותחים את הכתובת בדפדפן של כל טלפון (או מוסיפים למסך הבית כ־PWA).
2. נרשמים / מתחברים עם אותו אימייל וסיסמה.
3. הנתונים (נקודות, חדרים, מועדפים, פרימיום, צ'אט) מסונכרנים דרך ה־API.

אורחים יכולים להשתמש מקומית בלי חשבון; לסנכרון בין מכשירים צריך התחברות.

## הרצה מקומית

```bash
# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (טרמינל שני)
cd frontend
npm install
npm run dev
```

פתחו בדפדפן:

- מחשב: http://localhost:5173
- טלפון באותה רשת: `http://<IP-של-המחשב>:5173`

## מסכים עיקריים

| מסך | נתיב | פעולות |
| --- | --- | --- |
| פתיחה | `/` | התחל עכשיו / התחבר / אורח |
| בית | `/app/home` | בחירת קטגוריה / הפתעה |
| הפתעה | `/app/surprise` | הפתיעי אותי / בחירה ידנית |
| חדר | `/app/room/:id` | מועדף / התחל חוויה |
| הצלחה | `/app/success` | חזרה לבית |
| פרופיל / נקודות / פרימיום / צ'אט / הזמנות | `/app/...` | סנכרון עם חשבון |

## API לסנכרון

- `POST /api/v1/goturs/register`
- `POST /api/v1/goturs/login`
- `GET /api/v1/goturs/me`
- `PATCH /api/v1/goturs/me`
- `GET|POST /api/v1/goturs/chat`
