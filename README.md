# תזרים — מעקב השקעות שותפים

דשבורד בעברית (RTL) למעקב אחרי משקיעים, מסלולים עם אחוז חודשי קבוע, תשלומים, עמלת ניהול נפרדת והצעות למשקיעים חדשים.

## מה יש באפליקציה

- **לוח בקרה** — סך קרן, תשלומים חודשיים, עמלות ניהול, סיכום שנתי
- **משקיעים ומסלולים** — בר, אופק, אלמוג, שושי + מנהלת; עריכת קרן / אחוזים / משך
- **תשלומים** — היסטוריה, סימון «שולם», סינון לפי שנה/משקיע
- **הצעות** — סיכום ל־12+ חודשים והמרה למשקיע חדש
- **הגדרות** — ברירות מחדל גלובליות לאחוזים ולמשך

עמלת הניהול מתווספת **בנוסף** לתשואה של המשקיע — לא נגזרת ממנו.

## הרצה

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

הנתונים נשמרים ב־SQLite (`backend/app/data/investments.db`) ומסונכרנים דרך ה־API — אותו מצב מכל מכשיר שמחובר לשרת.

## API עיקרי

- `GET /api/v1/investments/dashboard`
- `GET|POST /api/v1/investments/investors`
- `GET|POST|PATCH /api/v1/investments/plans`
- `GET|PATCH /api/v1/investments/payments`
- `GET|POST /api/v1/investments/quotes` + `POST .../convert`
- `GET|PATCH /api/v1/investments/settings`
